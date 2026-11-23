// v201 Social publisher core — at most one publication per post and platform, even with overlapping cron runs.
//
//  1. Atomic claim: approved + due posts move to «processing» in ONE statement (UPDATE … WHERE id IN (SELECT … FOR
//     UPDATE SKIP LOCKED)), with this run's worker id and a lease. A second run never sees them as «approved».
//  2. Per platform, write-ahead: before calling Meta the platform is recorded as «sending» (under the lease — a run
//     that lost its lease sends nothing). The answer is recorded immediately after.
//  3. Outcome per platform: published (with the post id) · failed (Meta answered with an error: nothing was posted —
//     retried on a later run, at most 3 attempts) · UNCERTAIN (no answer: timeout, network, 5xx — Meta may have posted
//     it). UNCERTAIN is never retried automatically: a person checks Facebook / Instagram and resolves it.
//  4. A run that died mid-way: its lease expires; platforms left «sending» become UNCERTAIN (not re-sent).
//  5. A platform already published / manual / uncertain is never sent again by a retry of the same post.
import { randomUUID } from "node:crypto";

export const SOCIAL_LEASE_MS = 10 * 60_000;
export const SOCIAL_MAX_ATTEMPTS = 3;
const DONE = new Set(["published", "manual", "uncertain"]);

/** An error from Meta: `rejected` = Meta answered and refused (nothing posted); `uncertain` = no reliable answer. */
export class GraphError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

/** One Graph API call, with the outcome classified. */
export async function graphCall({ fetchImpl = fetch, version, path, token, params, timeoutMs = 30_000 }) {
  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${version}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new URLSearchParams(params), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new GraphError(`χωρίς απάντηση από το Meta (${e?.name === "TimeoutError" ? "λήξη χρόνου" : "σύνδεση"})`, "uncertain");
  }
  const body = await response.json().catch(() => null);
  if (response.status >= 500 || body === null) throw new GraphError(`Meta HTTP ${response.status} χωρίς αξιόπιστη απάντηση`, "uncertain");
  if (!response.ok || body.error) throw new GraphError(String(body.error?.message ?? `HTTP ${response.status}`).slice(0, 300), "rejected");
  return body;
}

const parse = (s) => { try { return JSON.parse(String(s || "{}")) ?? {}; } catch { return {}; } };

/** Posts left «processing» by a run whose lease expired: «sending» platforms → UNCERTAIN; never re-sent. */
export async function recoverExpired({ pool, owner, now = Date.now() }) {
  const rows = (await pool.query(`SELECT id,results_json,attempts FROM social_posts WHERE owner_id=$1 AND status='processing' AND lease_until<$2 FOR UPDATE SKIP LOCKED`, [owner, now])).rows;
  for (const r of rows) {
    const results = parse(r.results_json);
    let uncertain = false;
    for (const [ch, v] of Object.entries(results)) if (v?.status === "sending") { results[ch] = { ...v, status: "uncertain", reason: "η εκτέλεση διακόπηκε κατά την αποστολή — άγνωστο αν δημοσιεύτηκε" }; uncertain = true; }
    const status = uncertain ? "uncertain" : Number(r.attempts) >= SOCIAL_MAX_ATTEMPTS ? "failed" : "approved";
    await pool.query(`UPDATE social_posts SET status=$1,results_json=$2,lease_owner=NULL,lease_until=NULL,updated_at=$3 WHERE id=$4 AND status='processing' AND lease_until<$3`, [status, JSON.stringify(results), now, r.id]);
    if (uncertain) await notify(pool, owner, r.id, "uncertain", now);
  }
  return rows.length;
}

/** The atomic claim. */
export async function claimDue({ pool, owner, workerId, now = Date.now(), leaseMs = SOCIAL_LEASE_MS, limit = 20 }) {
  return (await pool.query(
    `UPDATE social_posts SET status='processing',lease_owner=$3,lease_until=$4,attempts=attempts+1,updated_at=$2
     WHERE id IN (SELECT id FROM social_posts WHERE owner_id=$1 AND status='approved' AND approved_by IS NOT NULL AND scheduled_at<=$2 AND attempts<${SOCIAL_MAX_ATTEMPTS} ORDER BY scheduled_at LIMIT ${Number(limit)} FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [owner, now, workerId, now + leaseMs],
  )).rows;
}

async function notify(pool, owner, id, status, now) {
  const el = status === "uncertain" ? `Ανάρτηση social #${id}: ΑΒΕΒΑΙΟ αν δημοσιεύτηκε — ελέγξτε στο Facebook / Instagram` : `Ανάρτηση social #${id}: ${status}`;
  await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/social',$4)`, [owner, el, `Social post #${id}: ${status}`, now]).catch(() => undefined);
}

/**
 * Publishes one claimed post. `send(channel, post)` performs the platform call and returns { id }; it throws a
 * GraphError (rejected / uncertain) or anything else (= uncertain). Returns the final status.
 */
export async function publishPost({ pool, owner, post, send, workerId, now = () => Date.now(), leaseMs = SOCIAL_LEASE_MS }) {
  const results = parse(post.results_json);
  const save = async (extra = "") => (await pool.query(
    `UPDATE social_posts SET results_json=$1,lease_until=$2,updated_at=$3${extra} WHERE id=$4 AND lease_owner=$5 AND status='processing' RETURNING id`,
    [JSON.stringify(results), now() + leaseMs, now(), post.id, workerId],
  )).rows.length > 0;
  for (const channel of JSON.parse(post.channels)) {
    if (DONE.has(results[channel]?.status) || results[channel]?.id) continue;
    if (channel === "tiktok") { results.tiktok = { status: "manual", note: "Upload the video in the TikTok app" }; if (!(await save())) return "lease_lost"; continue; }
    // Write-ahead under the lease: no lease → nothing is sent.
    results[channel] = { status: "sending", workerId, at: now() };
    if (!(await save())) return "lease_lost";
    try {
      const r = await send(channel, post);
      results[channel] = { status: "published", id: r?.id ?? null, at: now() };
    } catch (e) {
      const kind = e instanceof GraphError ? e.kind : "uncertain";
      results[channel] = kind === "rejected" ? { status: "failed", error: String(e.message).slice(0, 300), at: now() } : { status: "uncertain", reason: String(e?.message ?? e).slice(0, 300), at: now() };
    }
    if (!(await save())) return "lease_lost";
  }
  const states = JSON.parse(post.channels).map((c) => results[c]?.status);
  const attempts = Number(post.attempts);
  const status = states.some((s) => s === "uncertain") ? "uncertain"
    : states.every((s) => s === "published" || s === "manual") ? "published"
    : attempts < SOCIAL_MAX_ATTEMPTS ? "approved"
    : states.some((s) => s === "published") ? "partially_published" : "failed";
  const ok = (await pool.query(
    `UPDATE social_posts SET status=$1,results_json=$2,lease_owner=NULL,lease_until=NULL,published_at=CASE WHEN $1 IN ('published','partially_published') THEN $3::bigint ELSE published_at END,updated_at=$3 WHERE id=$4 AND lease_owner=$5 AND status='processing' RETURNING id`,
    [status, JSON.stringify(results), now(), post.id, workerId],
  )).rows.length;
  if (!ok) return "lease_lost";
  if (status !== "approved") await notify(pool, owner, post.id, status, now());
  return status;
}

/** One run: recover expired leases, claim, publish. */
export async function publishDue({ pool, owner, send, workerId = randomUUID(), now = () => Date.now(), leaseMs = SOCIAL_LEASE_MS }) {
  await recoverExpired({ pool, owner, now: now() });
  const claimed = await claimDue({ pool, owner, workerId, now: now(), leaseMs });
  const out = [];
  for (const post of claimed) out.push({ id: Number(post.id), status: await publishPost({ pool, owner, post, send, workerId, now, leaseMs }) });
  return { workerId, claimed: claimed.length, results: out };
}

/**
 * A person resolves an UNCERTAIN platform after checking Facebook / Instagram: `published` (optionally with the post
 * id) or `not_published` (it may then be sent again — only that platform).
 */
export async function resolveUncertain({ pool, owner, id, channel, outcome, externalId = null, by, now = Date.now() }) {
  const row = (await pool.query(`SELECT status,results_json,channels,attempts FROM social_posts WHERE owner_id=$1 AND id=$2`, [owner, id])).rows[0];
  if (!row) return { ok: false, error: "NOT_FOUND" };
  const results = parse(row.results_json);
  if (results[channel]?.status !== "uncertain") return { ok: false, error: "NOT_UNCERTAIN" };
  results[channel] = outcome === "published" ? { status: "published", id: externalId, confirmedBy: by, at: now } : { status: "failed", error: `δεν δημοσιεύτηκε (επιβεβαίωσε ${by})`, at: now };
  const states = JSON.parse(row.channels).map((c) => results[c]?.status);
  const status = states.some((s) => s === "uncertain") ? "uncertain" : states.every((s) => s === "published" || s === "manual") ? "published" : Number(row.attempts) < SOCIAL_MAX_ATTEMPTS ? "approved" : states.some((s) => s === "published") ? "partially_published" : "failed";
  const r = await pool.query(`UPDATE social_posts SET status=$1,results_json=$2,published_at=CASE WHEN $1 IN ('published','partially_published') THEN $3::bigint ELSE published_at END,updated_at=$3 WHERE owner_id=$4 AND id=$5 AND status='uncertain'`, [status, JSON.stringify(results), now, owner, id]);
  return r.rowCount ? { ok: true, status } : { ok: false, error: "NOT_UNCERTAIN" };
}
