import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { INVENTORY, RECOVERY_MIN_MS, buildReport, collectReadOnly, findingsFrom, readOnlyPool, reportMarkdown, runSentinel, sentinelIncidents, severityOf } from "../scripts/sentinel-core.mjs";
import { evaluateHealth, heartbeatPayload, signHeartbeat, verifyHeartbeat } from "../scripts/health-core.mjs";

const o = "hotel-corali", MIN = 60_000;
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  let chain: Promise<void> = Promise.resolve();
  const connect = async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => { release = r; }); await prev; return { query, release }; };
  return { db, pool: { query, connect } };
}

test("v201 Sentinel inventory: every packaged cron job and every critical subsystem has documented monitoring coverage", () => {
  const packaged = [...readFileSync("scripts/package-cpanel.sh", "utf8").matchAll(/scripts\/(run-[a-z-]+\.mjs)/g)].map((m) => m[1]);
  for (const script of new Set(packaged)) assert.ok(INVENTORY.some((i) => i.script === script), `${script} has no inventory entry`);
  for (const need of ["postgres", "payments", "ota", "guest-messaging", "housekeeping", "room-readiness", "tv", "climate", "cron-sentinel", "pms-app", "booking-app"]) assert.ok(INVENTORY.some((i) => i.id === need), need);
  assert.ok(INVENTORY.every((i) => i.checks.length > 0), "nothing without a check");
});

test("v201 Sentinel is read-only against production data: the statement guard and PostgreSQL both refuse writes", async () => {
  const { db, pool } = await fresh();
  try {
    const ro = readOnlyPool(pool);
    for (const sql of ["INSERT INTO rooms(owner_id,code) VALUES('x','1')", "UPDATE bookings SET status='x'", "DELETE FROM alerts", "WITH d AS (DELETE FROM alerts RETURNING id) SELECT * FROM d", "DROP TABLE rooms", "/* read */ TRUNCATE alerts"])
      await assert.rejects(ro.query(sql), /SENTINEL_READ_ONLY/, sql);
    assert.ok((await ro.query("SELECT 1 x")).rows.length === 1);
    // The second guard: the connection itself is read-only while the checks run.
    const c = await pool.connect();
    await c.query("SET default_transaction_read_only = on");
    await assert.rejects(c.query(`INSERT INTO alerts(owner_id,alert_key,area,severity,title,link,created_at) VALUES($1,'x','x','fail','x','/',1)`, [o]), /read-only/i);
    await c.query("RESET default_transaction_read_only"); c.release();
    // A full collection runs and leaves production tables exactly as they were.
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,attempts,last_error,created_at,updated_at) VALUES($1,'2026-12-01','2026-12-02','qa','failed',4,'Channex 503',$2,$2)`, [o, Date.now() - 45 * MIN]);
    const snapshot = async () => JSON.stringify((await db.query(`SELECT (SELECT count(*) FROM channel_sync_outbox) a,(SELECT count(*) FROM alerts) b,(SELECT count(*) FROM pms_notifications) c,(SELECT count(*) FROM alert_outbox) d,(SELECT max(updated_at) FROM channel_sync_outbox) e`)).rows);
    const before = await snapshot();
    const r = await collectReadOnly({ pool, owner: o, now: Date.now() });
    assert.ok(r.reliability.areas.length > 0 && r.health.components.database);
    assert.equal(await snapshot(), before, "nothing in production data changed");
  } finally { await db.close(); }
});

test("v201 incident engine: dedup, severity, evidence, three-question report, recovery verified only after clean checks over time", async () => {
  const { db, pool } = await fresh();
  try {
    const t0 = Date.now();
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(1,$1,'101','d',2,1,1,'clean')`, [o]);
    // A real fault: an availability change that failed to reach the OTAs 45′ ago.
    const outbox = (await db.query<{ id: number }>(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,attempts,last_error,created_at,updated_at) VALUES($1,'2026-12-01','2026-12-02','qa','failed',4,'Channex 503 Service Unavailable',$2,$2) RETURNING id`, [o, t0 - 45 * MIN])).rows[0].id;
    const r1 = await runSentinel({ pool, owner: o, now: t0, correlationId: "corr-1" });
    assert.equal(r1.status, "ok");
    let st = await sentinelIncidents({ pool, owner: o });
    const inc = st.incidents.find((i) => i.key === `outbox:${outbox}`)!;
    assert.ok(inc, `incident for the failed OTA sync: ${st.incidents.map((i) => i.key).join(", ")}`);
    assert.equal(inc.severity, "critical", "OTA sync failure = critical (overbooking risk)");
    assert.equal(inc.correlationId, "corr-1");
    assert.match(inc.report.confirmed.join(" "), /Channex 503/, "the confirmed part is the observed evidence");
    assert.ok(inc.report.probableCauses.every((c) => /δεν έχει επιβεβαιωθεί/.test(c)), "probable causes are labelled as such");
    assert.ok(inc.report.proposedFix.length && inc.report.validation.length && inc.report.risks.length);
    assert.match(inc.report.sentinelActions, /μόνο παρατηρεί/);
    const md = reportMarkdown(inc);
    for (const h of ["## 1. Τι δεν λειτουργεί", "## 2. Γιατί — αποδεικτικά", "## 3. Πώς διορθώνεται και πώς επιβεβαιώνεται", "ΔΕΝ έχουν επιβεβαιωθεί", "corr-1"]) assert.ok(md.includes(h), h);
    // Same fault next run → same incident (dedup), occurrences + 1.
    await runSentinel({ pool, owner: o, now: t0 + 5 * MIN, correlationId: "corr-2" });
    st = await sentinelIncidents({ pool, owner: o });
    assert.equal(st.incidents.filter((i) => i.key === `outbox:${outbox}`).length, 1);
    assert.equal(st.incidents.find((i) => i.key === `outbox:${outbox}`)!.occurrences, 2);
    // A person fixes it (the Sentinel never does): it is not «resolved» at the first clean check.
    await db.query(`UPDATE channel_sync_outbox SET status='sent' WHERE id=$1`, [outbox]);
    await runSentinel({ pool, owner: o, now: t0 + 10 * MIN });
    assert.equal((await sentinelIncidents({ pool, owner: o })).incidents.find((i) => i.key === `outbox:${outbox}`)!.status, "recovering");
    await runSentinel({ pool, owner: o, now: t0 + 5 * MIN + RECOVERY_MIN_MS + MIN });
    const done = (await sentinelIncidents({ pool, owner: o })).incidents.find((i) => i.key === `outbox:${outbox}`)!;
    assert.equal(done.status, "resolved");
    assert.ok(done.recoveryVerifiedAt);
    assert.match(done.report.recovery!.method, /2 διαδοχικούς ελέγχους/);
    // The fault comes back → a NEW incident (history kept).
    await db.query(`UPDATE channel_sync_outbox SET status='failed' WHERE id=$1`, [outbox]);
    await runSentinel({ pool, owner: o, now: t0 + 60 * MIN });
    assert.equal((await sentinelIncidents({ pool, owner: o })).incidents.filter((i) => i.key === `outbox:${outbox}`).length, 2);
    // The Sentinel's own failure is an incident too.
    const blind = await runSentinel({ pool, owner: o, now: t0 + 65 * MIN, collect: async () => { throw new Error("connection terminated"); } });
    assert.equal(blind.status, "check_failed");
    const f = (await sentinelIncidents({ pool, owner: o })).incidents.find((i) => i.key === "sentinel:check-failed")!;
    assert.match(f.report.confirmed.join(" "), /connection terminated/);
    assert.equal(severityOf({ key: "health:database", area: "health", level: "fail" }), "critical");
    assert.equal(severityOf({ key: "tv:1", area: "devices", level: "warn" }), "medium");
  } finally { await db.close(); }
});

test("v201 deep health: unknown is never ok; a stale Sentinel is a failure; the watchdog heartbeat is minimal and signed", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  const base = { dbMs: 5, channelOn: false, automations: { last_start_at: now - MIN, last_finish_at: now - MIN + 5000, runs: 100, last_status: "ok" }, channelSync: {}, steps: [], outboxOldest: 0, alertIssues: 0, socialStuck: 0, activeRooms: 12, lastBackup: now - 3_600_000, sentinel: { last: now - 3 * MIN, lastStatus: "ok", runs: 40, open: 0 } };
  assert.equal(evaluateHealth(base, now).status, "ok");
  assert.equal(evaluateHealth({ ...base, steps: null }, now).components.steps.status, "unknown");
  assert.notEqual(evaluateHealth({ ...base, steps: null }, now).status, "ok", "a source that cannot be read is never «ok»");
  assert.equal(evaluateHealth({ ...base, sentinel: { ...base.sentinel, last: now - 20 * MIN } }, now).components.sentinel.status, "fail");
  assert.equal(evaluateHealth({ ...base, dbMs: null }, now).status, "fail");
  assert.equal(evaluateHealth({ ...base, automations: { ...base.automations, last_start_at: now - 30 * MIN } }, now).components.automations.status, "fail");
  const deep = { at: now, ...evaluateHealth(base, now) };
  const payload = heartbeatPayload(deep, { service: "corali-pms", version: "v201" });
  const body = JSON.stringify(payload);
  assert.deepEqual(Object.keys(payload).sort(), ["at", "components", "progress", "service", "status", "version"]);
  assert.ok(Object.values(payload.components).every((v) => ["ok", "warn", "fail", "unknown"].includes(v)), "statuses only");
  assert.equal(payload.progress.sentinelRuns, 40);
  const secret = "s".repeat(40);
  const header = `t=${now},v1=${signHeartbeat(secret, now, body)}`;
  assert.equal(verifyHeartbeat(secret, header, body, now + 1000), true);
  assert.equal(verifyHeartbeat(secret, header, body.replace('"ok"', '"fail"'), now + 1000), false, "tampered body");
  assert.equal(verifyHeartbeat("x".repeat(40), header, body, now + 1000), false, "wrong secret");
  assert.equal(verifyHeartbeat(secret, header, body, now + 10 * MIN), false, "replayed old heartbeat");
  // Findings from health components keep their evidence.
  const fs = findingsFrom({ areas: [] }, { at: now, components: { database: { status: "fail", detail: "η βάση δεν απαντά" } } });
  assert.equal(fs[0].key, "health:database");
  assert.equal(buildReport({ key: "health:database", title: "x", severity: "critical", evidence: fs[0].evidence }, now).impact.length > 10, true);
});
