// v201 health in three levels (the basic /api/health proves only «the app runs and PostgreSQL answers»):
//   /api/health               app + PostgreSQL (unchanged; public, used by the installer)
//   /api/health/deep          internal (signed-in admin): every critical service and how fresh its work is
//   /api/monitoring/heartbeat for an external watchdog: the minimum safe facts (statuses, progress counters, no data),
//                             HMAC-signed with MONITORING_SECRET so the watchdog knows it came from this PMS.
// A component the PMS cannot read is «unknown» — never «ok».
import { createHmac, timingSafeEqual } from "node:crypto";
import { heartbeatState } from "./job-control-core.mjs";

const MIN = 60_000, HOUR = 60 * MIN;
const rank = { ok: 0, unknown: 1, warn: 2, fail: 3 };
const worst = (list) => list.reduce((w, s) => (rank[s] > rank[w] ? s : w), "ok");
const q = (pool, sql, p) => pool.query(sql, p).then((r) => r.rows).catch(() => null);

/** Pure: each component's status from the facts read (null = could not be read). */
export function evaluateHealth(f, now) {
  const c = {};
  c.database = f.dbMs === null ? { status: "fail", detail: "η βάση δεν απαντά" } : { status: f.dbMs > 2000 ? "warn" : "ok", latencyMs: f.dbMs };
  const job = (row, name, every) => {
    if (row === null) return { status: "unknown", detail: `${name}: δεν διαβάστηκε` };
    const h = heartbeatState(row, now, { everyMs: every });
    return { status: h.level === "ok" ? "ok" : h.level === "fail" ? "fail" : "warn", state: h.status, lastStartAgoS: row?.last_start_at ? Math.round((now - Number(row.last_start_at)) / 1000) : null, runs: Number(row?.runs ?? 0) };
  };
  c.automations = job(f.automations, "cron", 5 * MIN);
  c.channelSync = f.channelOn ? job(f.channelSync, "channel sync", 5 * MIN) : { status: "ok", state: "not_configured" };
  c.steps = f.steps === null ? { status: "unknown" } : (() => { const bad = f.steps.filter((s) => Number(s.consecutive_failures) >= 3); return { status: bad.length ? "fail" : f.steps.some((s) => !["ok", "skipped"].includes(s.last_status)) ? "warn" : "ok", failing: bad.map((s) => s.name) }; })();
  c.otaQueue = f.outboxOldest === null ? { status: "unknown" } : { status: f.outboxOldest && now - f.outboxOldest > 30 * MIN ? "fail" : f.outboxOldest && now - f.outboxOldest > 10 * MIN ? "warn" : "ok", oldestPendingAgoS: f.outboxOldest ? Math.round((now - f.outboxOldest) / 1000) : null };
  c.alerts = f.alertIssues === null ? { status: "unknown" } : { status: f.alertIssues > 0 ? "warn" : "ok", undelivered: f.alertIssues };
  c.social = f.socialStuck === null ? { status: "unknown" } : { status: f.socialStuck > 0 ? "warn" : "ok", needsAttention: f.socialStuck };
  // v201: the Sentinel itself (its cron every 5′): stale = the monitoring is blind → fail.
  c.sentinel = f.sentinel === null ? { status: "unknown" } : !f.sentinel.last ? { status: "warn", state: "never", runs: 0 } : { status: now - f.sentinel.last > 15 * MIN ? "fail" : f.sentinel.lastStatus !== "ok" ? "warn" : "ok", lastRunAgoS: Math.round((now - f.sentinel.last) / 1000), runs: f.sentinel.runs, openIncidents: f.sentinel.open };
  c.booking = f.activeRooms === null ? { status: "unknown" } : { status: f.activeRooms > 0 ? "ok" : "fail", activeRooms: f.activeRooms };
  c.backups = f.lastBackup === undefined ? { status: "unknown" } : { status: !f.lastBackup ? "warn" : now - f.lastBackup > 26 * HOUR ? "warn" : "ok", lastBackupAgoS: f.lastBackup ? Math.round((now - f.lastBackup) / 1000) : null };
  return { status: worst(Object.values(c).map((x) => x.status)), components: c };
}

/** Reads the facts (each source on its own: one failing source makes only its component «unknown»). */
export async function deepHealth({ pool, owner, now = Date.now() }) {
  const t0 = Date.now();
  const dbOk = await pool.query("SELECT 1").then(() => true, () => false);
  const dbMs = dbOk ? Date.now() - t0 : null;
  const [beats, steps, outbox, alerts, social, rooms, backup, channel, sentinel] = await Promise.all([
    q(pool, `SELECT * FROM cron_heartbeat WHERE owner_id=$1`, [owner]),
    q(pool, `SELECT name,last_status,consecutive_failures FROM automation_status WHERE owner_id=$1`, [owner]),
    q(pool, `SELECT min(created_at) m FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed','processing')`, [owner]),
    q(pool, `SELECT count(*)::int n FROM alert_outbox WHERE owner_id=$1 AND status IN ('failed','uncertain')`, [owner]),
    q(pool, `SELECT count(*)::int n FROM social_posts WHERE owner_id=$1 AND (status='uncertain' OR (status='processing' AND lease_until<$2::bigint))`, [owner, now]),
    q(pool, `SELECT count(*)::int n FROM rooms WHERE owner_id=$1 AND active=1`, [owner]),
    q(pool, `SELECT max(finished_at) m FROM backup_runs WHERE owner_id=$1 AND kind='backup' AND status='ok'`, [owner]),
    q(pool, `SELECT 1 FROM provider_connections WHERE owner_id=$1 AND provider_key IN ('channex','channelManager') AND active=1`, [owner]),
    q(pool, `SELECT (SELECT max(finished_at) FROM sentinel_runs WHERE owner_id=$1 AND finished_at IS NOT NULL) last,(SELECT status FROM sentinel_runs WHERE owner_id=$1 AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1) last_status,(SELECT count(*)::int FROM sentinel_runs WHERE owner_id=$1) runs,(SELECT count(*)::int FROM sentinel_incidents WHERE owner_id=$1 AND status='open') open`, [owner]),
  ]);
  const facts = {
    dbMs, channelOn: Boolean(channel?.length),
    automations: beats === null ? null : beats.find((b) => b.job === "automations") ?? {},
    channelSync: beats === null ? null : beats.find((b) => b.job === "channel-sync") ?? {},
    steps, outboxOldest: outbox === null ? null : outbox[0]?.m ? Number(outbox[0].m) : 0,
    alertIssues: alerts === null ? null : Number(alerts[0]?.n ?? 0), socialStuck: social === null ? null : Number(social[0]?.n ?? 0),
    sentinel: sentinel === null ? null : { last: sentinel[0]?.last ? Number(sentinel[0].last) : 0, lastStatus: String(sentinel[0]?.last_status ?? ""), runs: Number(sentinel[0]?.runs ?? 0), open: Number(sentinel[0]?.open ?? 0) },
    activeRooms: rooms === null ? null : Number(rooms[0]?.n ?? 0), lastBackup: backup === null ? undefined : backup[0]?.m ? Number(backup[0].m) : 0,
  };
  return { at: now, ...evaluateHealth(facts, now) };
}

/** The watchdog payload: statuses and progress counters only — no names, rooms, guests, errors or hosts. */
export function heartbeatPayload(deep, { service, version }) {
  const comp = Object.fromEntries(Object.entries(deep.components).map(([k, v]) => [k, v.status]));
  return { service, version, at: deep.at, status: deep.status, components: comp, progress: { automationsRuns: deep.components.automations.runs ?? 0, channelSyncRuns: deep.components.channelSync.runs ?? 0, sentinelRuns: deep.components.sentinel?.runs ?? 0, sentinelLastRunAgoS: deep.components.sentinel?.lastRunAgoS ?? null, openIncidents: deep.components.sentinel?.openIncidents ?? 0 } };
}
/** Signature over «timestamp.body» (the watchdog rejects old timestamps — no replay). */
export const signHeartbeat = (secret, at, body) => createHmac("sha256", String(secret)).update(`${at}.${body}`).digest("hex");
export function verifyHeartbeat(secret, header, body, now = Date.now(), maxAgeMs = 5 * MIN) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(header ?? ""));
  if (!m || Math.abs(now - Number(m[1])) > maxAgeMs) return false;
  const a = Buffer.from(signHeartbeat(secret, m[1], body), "hex"), b = Buffer.from(m[2], "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
