// v180: PMS → Security center: the Cloudflare origin lock, the counters of suspicious requests and the account checks.
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { edgeDecision, edgeSecretHash, eventHour, eventLabel, newEdgeSecret, type SecurityEventKind } from "../scripts/security-core.mjs";

type EdgeState = { hash: string; enforce: boolean; lastSeenAt: number | null };
const g = globalThis as typeof globalThis & { coraliEdge?: { state: EdgeState; at: number }; coraliEdgeSeen?: number };

/** The origin-lock state for proxy.ts, read from the database at most every 30 seconds per app process. */
export async function edgeState(): Promise<EdgeState> {
  const now = Date.now();
  if (g.coraliEdge && now - g.coraliEdge.at < 30_000) return g.coraliEdge.state;
  let state: EdgeState = { hash: "", enforce: false, lastSeenAt: null };
  try {
    const r = (await db().query(`SELECT edge_secret_hash,edge_enforce,edge_last_seen_at FROM security_settings WHERE owner_id=$1`, [env().PMS_OWNER_ID])).rows[0];
    if (r) state = { hash: String(r.edge_secret_hash ?? ""), enforce: Number(r.edge_enforce) === 1, lastSeenAt: r.edge_last_seen_at ? Number(r.edge_last_seen_at) : null };
  } catch {
    // Database unavailable (or the table not created yet): the lock never shuts the hotel out.
    state = { hash: "", enforce: false, lastSeenAt: null };
  }
  g.coraliEdge = { state, at: now };
  return state;
}

/** A request arrived with the right key: remember when (at most once a minute per process). */
export async function markEdgeSeen(): Promise<void> {
  const now = Date.now();
  if (g.coraliEdgeSeen && now - g.coraliEdgeSeen < 60_000) return;
  g.coraliEdgeSeen = now;
  if (g.coraliEdge) g.coraliEdge.state.lastSeenAt = now;
  await db().query(`UPDATE security_settings SET edge_last_seen_at=$2 WHERE owner_id=$1`, [env().PMS_OWNER_ID, now]).catch(() => undefined);
}

/** Count a suspicious request (kind × address × hour). Never throws, never slows the answer down much. */
export async function recordSecurityEvent(kind: SecurityEventKind, ip: string, detail = ""): Promise<void> {
  const now = Date.now();
  try {
    await db().query(
      `INSERT INTO security_events(owner_id,kind,ip,hour_at,count,detail,last_at) VALUES($1,$2,$3,$4,1,$5,$6)
       ON CONFLICT(owner_id,kind,ip,hour_at) DO UPDATE SET count=security_events.count+1,detail=$5,last_at=$6`,
      [env().PMS_OWNER_ID, kind, String(ip || "unknown").slice(0, 45), eventHour(now), String(detail).replace(/[^\w ./:@-]/g, "").slice(0, 80), now],
    );
  } catch { /* the counters are best effort */ }
}

/** A new origin-lock key: shown once. The lock is switched off until Cloudflare is seen sending the new key. */
export async function newEdgeKey(ownerId: string): Promise<string> {
  const secret = newEdgeSecret();
  const now = Date.now();
  await db().query(
    `INSERT INTO security_settings(owner_id,edge_secret_hash,edge_secret_created_at,edge_enforce,edge_last_seen_at,updated_at) VALUES($1,$2,$3,0,NULL,$3)
     ON CONFLICT(owner_id) DO UPDATE SET edge_secret_hash=$2,edge_secret_created_at=$3,edge_enforce=0,edge_last_seen_at=NULL,updated_at=$3`,
    [ownerId, edgeSecretHash(secret), now],
  );
  g.coraliEdge = undefined;
  return secret;
}

/** Switch the lock on (only once Cloudflare was seen sending the key in the last 10 minutes) or off. */
export async function setEdgeEnforce(ownerId: string, on: boolean): Promise<void> {
  const r = (await db().query(`SELECT edge_secret_hash,edge_last_seen_at FROM security_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  if (on && (!r?.edge_secret_hash)) throw Error("NO_KEY");
  if (on && !(r.edge_last_seen_at && Date.now() - Number(r.edge_last_seen_at) < 10 * 60_000)) throw Error("KEY_NOT_SEEN");
  await db().query(`UPDATE security_settings SET edge_enforce=$2,updated_at=$3 WHERE owner_id=$1`, [ownerId, on ? 1 : 0, Date.now()]);
  g.coraliEdge = undefined;
}

export type SecurityOverview = {
  edge: { configured: boolean; createdAt: number | null; enforce: boolean; lastSeenAt: number | null; status: "off" | "waiting" | "seen" | "locked" | "open" };
  users: { id: number; username: string; name: string; role: string; totp: boolean; active: boolean }[];
  failed24h: number;
  events: { kind: string; label: string; ip: string; count: number; lastAt: number; detail: string }[];
  totals24h: Record<string, number>;
};

export async function securityOverview(ownerId: string, lang: "el" | "en"): Promise<SecurityOverview> {
  const now = Date.now();
  const [s, users, failed, events, totals] = await Promise.all([
    db().query(`SELECT edge_secret_hash,edge_secret_created_at,edge_enforce,edge_last_seen_at FROM security_settings WHERE owner_id=$1`, [ownerId]),
    db().query(`SELECT id,username,display_name,COALESCE(NULLIF(role,''),'readonly') role,totp_confirmed_at,active FROM pms_staff_users WHERE owner_id=$1 ORDER BY active DESC,display_name`, [ownerId]),
    db().query(`SELECT count(*)::int n FROM audit_logs WHERE owner_id=$1 AND action IN ('security.login_failed','security.login_blocked') AND created_at>$2::bigint`, [ownerId, now - 86_400_000]),
    db().query(`SELECT kind,ip,sum(count)::int n,max(last_at) last_at,max(detail) detail FROM security_events WHERE owner_id=$1 AND hour_at>$2::bigint GROUP BY kind,ip ORDER BY n DESC LIMIT 40`, [ownerId, now - 7 * 86_400_000]),
    db().query(`SELECT kind,sum(count)::int n FROM security_events WHERE owner_id=$1 AND hour_at>$2::bigint GROUP BY kind`, [ownerId, now - 86_400_000]),
  ]);
  const r = s.rows[0];
  const configured = Boolean(r?.edge_secret_hash);
  const enforce = Number(r?.edge_enforce) === 1;
  const lastSeenAt = r?.edge_last_seen_at ? Number(r.edge_last_seen_at) : null;
  const status = !configured ? "off" : enforce ? (edgeDecision({ enforce, keyOk: false, lastSeenAt, now }) === "open" ? "open" : "locked") : lastSeenAt && now - lastSeenAt < 10 * 60_000 ? "seen" : "waiting";
  return {
    edge: { configured, createdAt: r?.edge_secret_created_at ? Number(r.edge_secret_created_at) : null, enforce, lastSeenAt, status },
    users: users.rows.map((u) => ({ id: Number(u.id), username: String(u.username), name: String(u.display_name ?? u.username), role: String(u.role), totp: Boolean(u.totp_confirmed_at), active: Number(u.active) === 1 })),
    failed24h: Number(failed.rows[0]?.n ?? 0),
    events: events.rows.map((e) => ({ kind: String(e.kind), label: eventLabel(String(e.kind), lang), ip: String(e.ip), count: Number(e.n), lastAt: Number(e.last_at), detail: String(e.detail ?? "") })),
    totals24h: Object.fromEntries(totals.rows.map((t) => [String(t.kind), Number(t.n)])),
  };
}
