import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { GraphError, graphCall, publishDue, publishPost, claimDue, recoverExpired, resolveUncertain } from "../scripts/social-publish-core.mjs";

const o = "hotel-corali";
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  return { db, pool: { query } };
}
const now0 = Date.parse("2026-11-23T10:00:00Z");
async function post(q: (s: string, p?: unknown[]) => Promise<unknown>, channels: string[], extra: Row = {}) {
  const r = (await q(`INSERT INTO social_posts(owner_id,channels,caption,image_url,scheduled_at,status,created_by,approved_by,approved_at,results_json,attempts,created_at,updated_at) VALUES($1,$2,'Καλημέρα από το Corali','https://x/img.jpg',$3,'approved',1,2,$3,$4,$5,$3,$3) RETURNING id`, [o, JSON.stringify(channels), now0 - 1000, extra.results ?? "{}", extra.attempts ?? 0])) as { rows: { id: number }[] };
  return Number(r.rows[0].id);
}
const status = async (db: PGlite, id: number) => (await db.query<{ status: string; results_json: string; attempts: number; lease_owner: string | null }>(`SELECT status,results_json,attempts,lease_owner FROM social_posts WHERE id=$1`, [id])).rows[0];

test("v201 P1: overlapping runs publish each post once per platform (atomic claim + lease)", async () => {
  const { db, pool } = await fresh();
  try {
    const ids = [await post(pool.query, ["facebook", "instagram"]), await post(pool.query, ["facebook"])];
    const calls: string[] = [];
    const send = async (channel: string, p: Row) => { calls.push(`${p.id}:${channel}`); await new Promise((r) => setTimeout(r, 5)); return { id: `meta-${p.id}-${channel}` }; };
    // Two cron runs started at the same moment.
    const [a, b] = await Promise.all([publishDue({ pool, owner: o, send, workerId: "run-A", now: () => now0 }), publishDue({ pool, owner: o, send, workerId: "run-B", now: () => now0 })]);
    assert.equal(a.claimed + b.claimed, 2, "every post claimed by exactly one run");
    assert.deepEqual([...calls].sort(), [`${ids[0]}:facebook`, `${ids[0]}:instagram`, `${ids[1]}:facebook`].sort(), "no platform called twice");
    for (const id of ids) { const s = await status(db, id); assert.deepEqual([s.status, Number(s.attempts), s.lease_owner], ["published", 1, null]); }
    // A third run finds nothing to do.
    assert.equal((await publishDue({ pool, owner: o, send, workerId: "run-C", now: () => now0 + 60_000 })).claimed, 0);
    assert.equal(calls.length, 3);
  } finally { await db.close(); }
});

test("v201 P1: no reliable answer from Meta → UNCERTAIN, never re-sent automatically; a person resolves it", async () => {
  const { db, pool } = await fresh();
  try {
    const id = await post(pool.query, ["facebook", "instagram"]);
    let calls = 0;
    // Facebook: published but the connection dropped before the answer; Instagram: published.
    const send = async (channel: string) => { calls++; if (channel === "facebook") throw new GraphError("χωρίς απάντηση από το Meta (λήξη χρόνου)", "uncertain"); return { id: "ig-1" }; };
    const r = await publishDue({ pool, owner: o, send, workerId: "w1", now: () => now0 });
    assert.equal(r.results[0].status, "uncertain");
    let s = await status(db, id);
    assert.equal(JSON.parse(s.results_json).facebook.status, "uncertain");
    assert.equal(JSON.parse(s.results_json).instagram.status, "published");
    // Later runs never pick it up again.
    for (let i = 1; i <= 3; i++) await publishDue({ pool, owner: o, send, workerId: `w${i + 1}`, now: () => now0 + i * 300_000 });
    assert.equal(calls, 2, "no second Facebook call");
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int n FROM pms_notifications WHERE title_el LIKE '%ΑΒΕΒΑΙΟ%'`)).rows[0].n, 1);
    // Checked on Facebook: it is NOT there → only Facebook is sent again, once.
    assert.equal((await resolveUncertain({ pool, owner: o, id, channel: "instagram", outcome: "published", by: "Maria" })).error, "NOT_UNCERTAIN");
    const res = await resolveUncertain({ pool, owner: o, id, channel: "facebook", outcome: "not_published", by: "Maria", now: now0 + 2_000_000 });
    assert.deepEqual([res.ok, res.status], [true, "approved"]);
    const sent: string[] = [];
    await publishDue({ pool, owner: o, send: async (c: string) => { sent.push(c); return { id: "fb-2" }; }, workerId: "w9", now: () => now0 + 3_000_000 });
    assert.deepEqual(sent, ["facebook"], "Instagram (already published) is not sent again");
    s = await status(db, id);
    assert.equal(s.status, "published");
  } finally { await db.close(); }
});

test("v201: a Meta refusal is a plain failure (retried, only that platform, at most 3 attempts); a run that died mid-send leaves UNCERTAIN", async () => {
  const { db, pool } = await fresh();
  try {
    const id = await post(pool.query, ["facebook", "instagram"]);
    const calls: string[] = [];
    const send = async (c: string) => { calls.push(c); if (c === "instagram") throw new GraphError("Invalid image", "rejected"); return { id: "fb" }; };
    for (let i = 0; i < 5; i++) await publishDue({ pool, owner: o, send, workerId: `w${i}`, now: () => now0 + i * 600_000 });
    assert.deepEqual(calls, ["facebook", "instagram", "instagram", "instagram"], "Facebook once; Instagram retried up to 3 attempts in total");
    const s = await status(db, id);
    assert.deepEqual([s.status, Number(s.attempts)], ["partially_published", 3]);
    // A run claims a post and dies after writing «sending» (no answer recorded) → after the lease: UNCERTAIN.
    const id2 = await post(pool.query, ["facebook"]);
    const [claimed] = await claimDue({ pool, owner: o, workerId: "dead", now: now0, leaseMs: 60_000 });
    assert.equal(Number(claimed.id), id2);
    await pool.query(`UPDATE social_posts SET results_json=$1 WHERE id=$2`, [JSON.stringify({ facebook: { status: "sending", workerId: "dead" } }), id2]);
    assert.equal(await recoverExpired({ pool, owner: o, now: now0 + 30_000 }), 0, "lease still valid: untouched");
    await recoverExpired({ pool, owner: o, now: now0 + 120_000 });
    const s2 = await status(db, id2);
    assert.equal(s2.status, "uncertain");
    assert.equal(JSON.parse(s2.results_json).facebook.status, "uncertain");
    // A run that lost its lease sends nothing.
    const id3 = await post(pool.query, ["facebook"]);
    const [c3] = await claimDue({ pool, owner: o, workerId: "slow", now: now0 + 200_000 });
    await pool.query(`UPDATE social_posts SET lease_owner='other' WHERE id=$1`, [id3]);
    let sentByLoser = 0;
    assert.equal(await publishPost({ pool, owner: o, post: c3, send: async () => { sentByLoser++; return { id: "x" }; }, workerId: "slow", now: () => now0 + 200_000 }), "lease_lost");
    assert.equal(sentByLoser, 0);
  } finally { await db.close(); }
});

test("v201: Graph answers are classified — network/timeout/5xx = uncertain, 4xx with an error body = rejected", async () => {
  const call = (impl: typeof fetch) => graphCall({ fetchImpl: impl, version: "v21.0", path: "1/feed", token: "t", params: {} });
  await assert.rejects(call((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch), (e: GraphError) => e.kind === "uncertain");
  await assert.rejects(call((async () => new Response("bad gateway", { status: 502 })) as unknown as typeof fetch), (e: GraphError) => e.kind === "uncertain");
  await assert.rejects(call((async () => new Response(JSON.stringify({ error: { message: "Invalid parameter" } }), { status: 400 })) as unknown as typeof fetch), (e: GraphError) => e.kind === "rejected" && /Invalid parameter/.test(e.message));
  assert.deepEqual(await call((async () => new Response(JSON.stringify({ id: "123" }), { status: 200 })) as unknown as typeof fetch), { id: "123" });
});
