import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { checkReliability, runReliabilityAlerts } from "../scripts/reliability-core.mjs";
import { deliverAlerts, raiseAlert, resolveAlerts, ALERT_EMAILS_PER_HOUR } from "../scripts/alert-core.mjs";
import { findingsFrom } from "../scripts/sentinel-core.mjs";
import { buildIncidents, channelIncident, formatAlertMessage } from "../scripts/alert-intel-core.mjs";
import { activateIntegration, activationReadiness, integrationState, recordIntegrationCheck } from "../scripts/integration-state-core.mjs";

const o = "hotel-corali", MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const t0 = Date.parse("2026-11-23T10:00:00Z");
const ADMIN = ["admin@hotel.invalid"];
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  return { db, pool: { query } };
}
const n = async (db: PGlite, sql: string, p: unknown[] = []) => Number((await db.query<{ n: number }>(sql, p)).rows[0].n);
const emails = (db: PGlite, extra = "") => n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE channel='email' AND status NOT IN ('cancelled','skipped')${extra}`);
/** The production picture: 60 queued availability changes 19–55 days old, the same ranges again and again. */
async function backlog(db: PGlite) {
  for (let i = 0; i < 60; i++) {
    const from = i % 3 === 0 ? "2026-10-29" : "2026-11-04";
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,$2,$3,$4,'pending',$5,$5)`, [o, i % 4 === 0 ? "2026-12-01" : from, "2027-10-29", i % 2 ? "room_changed" : "room_added", t0 - (19 + (i % 36)) * DAY]);
  }
}
const send = { push: async () => 1, email: async () => undefined };
async function connection(db: PGlite, active: number, activated: boolean) {
  await db.query(`INSERT INTO provider_connections(owner_id,provider_key,active,secrets_encrypted,updated_by,updated_at) VALUES($1,'channelManager',$2,'sealed','qa',$3)`, [o, active, t0]);
  if (activated) await db.query(`INSERT INTO integration_activation(owner_id,provider_key,activated_at,activated_by) VALUES($1,'channelManager',$2,'qa')`, [o, t0 - 30 * DAY]);
}

for (const [label, setup] of [
  ["NOT_CONFIGURED (no connection, a sync that ran once long ago)", async (db: PGlite) => { await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - 60 * DAY]); }],
  ["DISABLED (saved, switched off)", async (db: PGlite) => connection(db, 0, false)],
  ["TESTING (switched on, never activated)", async (db: PGlite) => connection(db, 1, false)],
] as const) {
  test(`v202 inactive provider — ${label}: 24 hours of cron runs, no alert storm, no e-mail, nothing deleted`, async () => {
    const { db, pool } = await fresh();
    try {
      await backlog(db);
      await setup(db);
      const before = await n(db, `SELECT count(*)::int AS n FROM channel_sync_outbox`);
      for (let t = t0; t < t0 + DAY; t += 10 * MIN) {
        await runReliabilityAlerts({ pool, owner: o, now: t, emails: ADMIN });
        await deliverAlerts({ pool, owner: o, send, now: t + MIN });
      }
      assert.equal(await emails(db), 0, "no e-mail at all");
      assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE area='channel' AND priority IN ('critical','high')`), 0, "no critical / high channel alert");
      assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE channel='push'`), 0, "no push either");
      assert.equal(await n(db, `SELECT count(*)::int AS n FROM channel_sync_outbox`), before, "the queued changes are kept (history), not deleted");
      const r = await checkReliability({ pool, owner: o, now: t0 });
      const ch = r.areas.find((a) => a.key === "channel")!;
      if (label.startsWith("TESTING")) {
        assert.equal(r.integrations?.channelManager, "TESTING");
        assert.ok(ch.items.every((i) => i.level !== "fail"), "TESTING: shown, never critical");
      } else {
        assert.equal(ch.status, "inactive");
        assert.deepEqual(ch.items, []);
        assert.match(ch.info.join(" "), label.startsWith("DISABLED") ? /Channel Manager disabled — OTA synchronization inactive/ : /Channel Manager not configured — OTA synchronization inactive/);
        assert.equal(ch.info.filter((x) => /OTA synchronization inactive/.test(x)).length, 1, "ONE informational notice");
      }
      // The Sentinel classifies it the same way: not a synchronization failure.
      const f = findingsFrom(r, { at: t0, components: {} }, t0);
      assert.ok(!f.some((x) => x.level === "fail" && x.area === "channel"), "no Sentinel failure for an inactive integration");
      assert.ok(!f.some((x) => /^outbox:\d+$/.test(x.key)), "never one finding per queued row");
    } finally { await db.close(); }
  });
}

test("v202 ACTIVE provider whose sync fails: ONE critical incident — initial e-mail, one reminder, one daily reminder; never one per row", async () => {
  const { db, pool } = await fresh();
  try {
    await backlog(db);
    await connection(db, 1, true);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at,last_error) VALUES($1,$2,$3,'Channex HTTP 401 Unauthorized')`, [o, t0 - MIN, t0 - 9 * HOUR]);
    for (let t = t0; t <= t0 + DAY + 40 * MIN; t += 10 * MIN) {
      await db.query(`UPDATE channel_sync_state SET last_run_at=$2 WHERE owner_id=$1`, [o, t - MIN]); // the sync runs, and fails
      if ((t - t0) % HOUR === 0) await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,'2026-12-24','2026-12-26','direct_booking','pending',$2,$2)`, [o, t - 20 * MIN]);
      await runReliabilityAlerts({ pool, owner: o, now: t, emails: ADMIN });
      await deliverAlerts({ pool, owner: o, send, now: t + MIN });
    }
    const alerts = (await db.query<{ alert_key: string; priority: string; details_json: string }>(`SELECT alert_key,priority,details_json FROM alerts WHERE area='channel'`)).rows;
    assert.deepEqual(alerts.map((a) => [a.alert_key, a.priority]), [["rel:sync:ota", "critical"]], "one incident, critical");
    const d = JSON.parse(alerts[0].details_json);
    assert.match(d.rootCause, /401 Unauthorized/, "the root cause is the observed error");
    assert.ok(d.count >= 60);
    const purposes = (await db.query<{ purpose: string }>(`SELECT purpose FROM alert_outbox WHERE channel='email' AND status='sent' ORDER BY id`)).rows.map((r) => r.purpose.replace(/:\d{4}-\d\d-\d\d$/, ""));
    assert.deepEqual(purposes, ["alert", "escalation", "reminder"], "initial, first reminder (30′), daily reminder — 3 e-mails in 24 h instead of thousands");
    // Acknowledged → no more reminders.
    await db.query(`UPDATE alerts SET acknowledged_at=$1`, [t0 + DAY]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 3 * DAY, emails: ADMIN });
    assert.equal(await emails(db), 3);
  } finally { await db.close(); }
});

test("v202 worsening is told again; recovery is told once; a flapping problem is not re-e-mailed", async () => {
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, true);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - MIN]);
    const row = Number((await db.query<{ id: number }>(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,'2026-12-24','2026-12-26','direct_booking','pending',$2,$2) RETURNING id`, [o, t0 - 2 * HOUR])).rows[0].id);
    // The sync succeeds but the row stays pending → HIGH (wrong outbox state).
    await runReliabilityAlerts({ pool, owner: o, now: t0, emails: ADMIN });
    await deliverAlerts({ pool, owner: o, send, now: t0 + MIN });
    let a = (await db.query<{ priority: string; occurrence: number }>(`SELECT priority,occurrence FROM alerts WHERE alert_key='rel:sync:ota'`)).rows[0];
    assert.deepEqual([a.priority, Number(a.occurrence)], ["high", 1]);
    assert.match(JSON.parse((await db.query<{ details_json: string }>(`SELECT details_json FROM alerts`)).rows[0].details_json).rootCause, /λανθασμένη κατάσταση outbox/);
    // The sync stops → CRITICAL: told again as «worsened» (a real change), not as a repeat.
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 40 * MIN, emails: ADMIN });
    await deliverAlerts({ pool, owner: o, send, now: t0 + 41 * MIN });
    a = (await db.query<{ priority: string; occurrence: number }>(`SELECT priority,occurrence FROM alerts WHERE alert_key='rel:sync:ota'`)).rows[0];
    assert.equal(a.priority, "critical");
    assert.equal(await emails(db, ` AND purpose='worsened'`), 1);
    // Fixed: row sent, sync running → resolved, ONE recovery notice to whoever was told.
    await db.query(`UPDATE channel_sync_outbox SET status='sent' WHERE id=$1`, [row]);
    await db.query(`UPDATE channel_sync_state SET last_run_at=$2,last_ok_at=$2 WHERE owner_id=$1`, [o, t0 + 49 * MIN]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 50 * MIN, emails: ADMIN });
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 60 * MIN, emails: ADMIN });
    assert.equal(await emails(db, ` AND purpose='recovery'`), 1);
    assert.match(formatAlertMessage({ ...(await db.query<Row>(`SELECT o.purpose,a.title,a.link,a.priority,a.details_json FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id WHERE o.purpose='recovery' AND o.channel='email'`)).rows[0] } as never).subject, /^\[Αποκατάσταση\]/);
    // It comes back an hour later (flapping): shown again, but NOT e-mailed again within 24 h — and no 2nd recovery.
    await db.query(`UPDATE channel_sync_outbox SET status='pending' WHERE id=$1`, [row]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 2 * HOUR, emails: ADMIN });
    const back = (await db.query<{ status: string; last_error: string }>(`SELECT status,last_error FROM alert_outbox WHERE channel='email' AND purpose='alert' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.deepEqual([back.status, /24 ώρες/.test(back.last_error)], ["skipped", true], "cooldown, with the reason recorded");
    await db.query(`UPDATE channel_sync_outbox SET status='sent' WHERE id=$1`, [row]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 3 * HOUR, emails: ADMIN });
    assert.equal(await emails(db, ` AND purpose='recovery'`), 1, "no recovery notice for an occurrence nobody was e-mailed about");
  } finally { await db.close(); }
});

test("v202 hourly cap per recipient; pre-v202 per-row alerts are cancelled by the migration and closed silently", async () => {
  const { db, pool } = await fresh();
  try {
    for (let i = 0; i < 10; i++) await raiseAlert({ pool, owner: o, key: `rel:test:${i}`, area: "payments", priority: "critical", title: `P${i}`, now: t0, emails: ADMIN, details: { problem: `P${i}` } });
    assert.equal(await emails(db), ALERT_EMAILS_PER_HOUR);
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE channel='email' AND status='skipped' AND last_error LIKE 'Όριο%'`), 10 - ALERT_EMAILS_PER_HOUR);
    // Legacy: one alert per queued row, e-mails pending.
    await db.query(`DELETE FROM alert_outbox`);
    await db.query(`DELETE FROM alerts`);
    for (let i = 1; i <= 5; i++) {
      const id = Number((await db.query<{ id: number }>(`INSERT INTO alerts(owner_id,alert_key,area,severity,title,link,created_at) VALUES($1,$2,'channel','fail','Booking & Channel Manager: Μεταβολή διαθεσιμότητας …','/pms/reliability',$3) RETURNING id`, [o, `rel:outbox:${i}`, t0])).rows[0].id);
      await db.query(`INSERT INTO alert_outbox(owner_id,alert_id,occurrence,channel,recipient,purpose,status,created_at,updated_at) VALUES($1,$2,1,'email',$3,'alert','pending',$4,$4),($1,$2,1,'email',$3,'escalation','sent',$4,$4)`, [o, id, ADMIN[0], t0]);
    }
    const migration = readFileSync("server/postgres-schema.sql", "utf8").split("\n").filter((l, i, all) => /^UPDATE alert_outbox SET status='cancelled',last_error='v202/.test(l) || /^ WHERE status='pending' AND alert_id IN \(SELECT id FROM alerts WHERE alert_key ~/.test(l) && /v202/.test(all[i - 1])).join("\n");
    await db.exec(migration);
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE status='pending'`), 0, "no pending legacy e-mail left");
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox`), 10, "history kept");
    assert.equal(await resolveAlerts({ pool, owner: o, activeKeys: [], now: t0 + MIN }), 5);
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE purpose='recovery'`), 0, "legacy alerts close without 5 «recovered» e-mails");
  } finally { await db.close(); }
});

test("v202 activation requires proven prerequisites (verified mapping + initial full reconciliation), recent enough", async () => {
  const { db, pool } = await fresh();
  try {
    assert.equal((await activateIntegration({ pool, owner: o, provider: "channelManager", by: "Maria", now: t0 })).error, "NOT_CONFIGURED");
    await connection(db, 1, false);
    let r = await activateIntegration({ pool, owner: o, provider: "channelManager", by: "Maria", now: t0 });
    assert.equal(r.error, "PREREQUISITES_NOT_MET");
    await recordIntegrationCheck({ pool, owner: o, provider: "channelManager", check: "room_rate_mapping", ok: true, detail: "3 αντιστοιχίσεις", now: t0 });
    await recordIntegrationCheck({ pool, owner: o, provider: "channelManager", check: "initial_reconciliation", ok: false, detail: "Διαφορές: double 2026-12-01", now: t0 });
    r = await activateIntegration({ pool, owner: o, provider: "channelManager", by: "Maria", now: t0 });
    assert.equal(r.error, "PREREQUISITES_NOT_MET", "a failed reconciliation blocks activation");
    await recordIntegrationCheck({ pool, owner: o, provider: "channelManager", check: "initial_reconciliation", ok: true, detail: "500 ημέρες χωρίς διαφορές", now: t0 + MIN });
    assert.equal((await activateIntegration({ pool, owner: o, provider: "channelManager", by: "Maria", now: t0 + 2 * MIN })).ok, true);
    assert.equal(integrationState({ row: { active: 1, secrets_encrypted: "s" }, activation: { activated_at: t0 }, healthy: true }), "ACTIVE");
    assert.equal(integrationState({ row: { active: 1, secrets_encrypted: "s" }, activation: { activated_at: t0 } }), "UNVERIFIED", "v203: unknown health is not ACTIVE");
    assert.equal(integrationState({ row: { active: 1, secrets_encrypted: "s" }, activation: { activated_at: t0 }, healthy: false }), "DEGRADED");
    assert.equal(integrationState({ row: { active: 0, secrets_encrypted: "s" }, activation: { activated_at: t0 } }), "DISABLED");
    assert.equal(integrationState({ row: null }), "NOT_CONFIGURED");
    // Evidence older than 30 days is not proof any more.
    const old = activationReadiness("channelManager", [{ check_key: "room_rate_mapping", ok: 1, checked_at: t0 }, { check_key: "initial_reconciliation", ok: 1, checked_at: t0 }], t0 + 31 * DAY);
    assert.equal(old.ready, false);
    // The same lifecycle exists for the other connections.
    for (const p of ["viva", "whatsapp", "tuya", "stripe", "mydata"]) assert.ok(activationReadiness(p, [], t0).items.length > 0, p);
  } finally { await db.close(); }
});

test("v202 incident message: Sentinel format with service, severity, problem, summary, root cause, action and policy", () => {
  const inc = channelIncident({ connection: "ACTIVE", live: 24, past: 3, soon: 2, failed: 0, oldestAt: t0 - 55 * DAY, oldestRange: "2026-10-29 → 2027-10-29, room_changed", lastRunAt: t0 - 2 * DAY, lastOkAt: t0 - 2 * DAY, lastError: null }, t0)!;
  assert.equal(inc.priority, "critical");
  assert.match(inc.summary, /24 εκκρεμή γεγονότα διαθεσιμότητας, με παλαιότερο πριν από 55 ημέρες/);
  const m = formatAlertMessage({ title: "x", purpose: "alert", priority: inc.priority, details_json: JSON.stringify({ ...inc }), link: "/pms/reliability", origin: "https://pms.example" });
  for (const s of ["Corali Sentinel — OTA Sync Incident", "Critical", "Πρόβλημα:", "Σύνοψη:", "Αιτία (από τα στοιχεία):", "Πιθανές αιτίες (δεν έχουν επιβεβαιωθεί):", "Προτεινόμενη ενέργεια:", "Ειδοποιήσεις: Μία αρχική ειδοποίηση", "https://pms.example/pms/reliability"]) assert.ok(m.text.includes(s), s);
  assert.equal(channelIncident({ connection: "NOT_CONFIGURED", live: 24 }, t0), null);
  // Generic aggregation: 30 failed documents → one incident.
  const items = Array.from({ length: 30 }, (_, i) => ({ key: `fiscal:${i + 1}`, level: "fail", text: `Παραστατικό ${i + 1}`, at: t0 - i * MIN }));
  const inc2 = buildIncidents({ areas: [{ key: "mydata", el: "myDATA", items }] }, t0);
  assert.deepEqual(inc2.map((x) => [x.key, x.count]), [["fiscal:*", 30]]);
});

test("v202 deep health / watchdog heartbeat: an inactive Channel Manager's old queue is not a failure; an activated one's is", async () => {
  const { evaluateHealth } = await import("../scripts/health-core.mjs");
  const now = t0;
  const base = { dbMs: 5, channelOn: false, automations: { last_start_at: now - MIN, last_finish_at: now - MIN + 5000, runs: 100, last_status: "ok" }, channelSync: {}, steps: [], outboxOldest: now - 30 * DAY, alertIssues: 0, socialStuck: 0, activeRooms: 12, lastBackup: now - HOUR, sentinel: { last: now - 3 * MIN, lastStatus: "ok", runs: 40, open: 0 } };
  for (const state of ["NOT_CONFIGURED", "DISABLED", "TESTING"]) {
    const h = evaluateHealth({ ...base, channelState: state }, now);
    assert.deepEqual([h.components.otaQueue.status, h.components.channelSync.status], ["ok", "ok"], state);
    assert.equal(h.status, "ok", state);
  }
  assert.equal(evaluateHealth({ ...base, channelOn: true, channelState: "ACTIVE" }, now).components.otaQueue.status, "fail");
});

test("v203 P1: an activated connection whose health is unknown is UNVERIFIED — never ACTIVE; intentionally inactive ones stay silent", async () => {
  const act = { activated_at: t0 };
  const row = { active: 1, secrets_encrypted: "s" };
  assert.equal(integrationState({ row, activation: act }), "UNVERIFIED", "healthy omitted");
  assert.equal(integrationState({ row, activation: act, healthy: null }), "UNVERIFIED", "healthy null");
  assert.equal(integrationState({ row, activation: act, healthy: true }), "ACTIVE");
  assert.equal(integrationState({ row, activation: act, healthy: false }), "DEGRADED");
  assert.equal(integrationState({ row: null, healthy: null }), "NOT_CONFIGURED");
  assert.equal(integrationState({ row: { active: 0, secrets_encrypted: "s" }, activation: act, healthy: null }), "DISABLED");
  // From the sync's own evidence.
  const { channelSyncHealthy } = await import("../scripts/integration-state-core.mjs");
  assert.equal(channelSyncHealthy(undefined, t0), null, "state unreadable → unknown");
  assert.equal(channelSyncHealthy(null, t0), false, "never ran → not working");
  assert.equal(channelSyncHealthy({ last_run_at: t0 - MIN, last_ok_at: t0 - MIN }, t0), true);
  assert.equal(channelSyncHealthy({ last_run_at: t0 - HOUR, last_ok_at: t0 - HOUR }, t0), false);
  assert.equal(channelSyncHealthy({ last_run_at: t0 - MIN, last_ok_at: t0 - 2 * HOUR, last_error: "HTTP 401" }, t0), false);
  // On the real schema: activated, sync ran a minute ago without error → ACTIVE; no sync state at all → DEGRADED.
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, true);
    assert.equal((await checkReliability({ pool, owner: o, now: t0 })).integrations?.channelManager, "DEGRADED", "activated but never synced is not «working»");
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - MIN]);
    assert.equal((await checkReliability({ pool, owner: o, now: t0 })).integrations?.channelManager, "ACTIVE");
  } finally { await db.close(); }
});

test("v203 P2: prerequisite checks dated in the future (or before the last configuration change) do not approve activation", async () => {
  const both = (at: number) => [{ check_key: "room_rate_mapping", ok: 1, checked_at: at }, { check_key: "initial_reconciliation", ok: 1, checked_at: at }];
  // The reported case: both Channex prerequisites one day after now → was ready = true.
  const r = activationReadiness("channelManager", both(t0 + DAY), t0);
  assert.equal(r.ready, false);
  assert.ok(r.items.every((i) => i.future && /στο μέλλον/.test(i.detail)));
  // Within the documented tolerance (5′) it is accepted; beyond it, not.
  assert.equal(activationReadiness("channelManager", both(t0 + 4 * MIN), t0).ready, true);
  assert.equal(activationReadiness("channelManager", both(t0 + 6 * MIN), t0).ready, false);
  // A configuration change after the checks → new verification required.
  const changed = activationReadiness("channelManager", both(t0 - HOUR), t0, t0 - 10 * MIN);
  assert.equal(changed.ready, false);
  assert.ok(changed.items.every((i) => i.stale && /νέα επαλήθευση/.test(i.detail)));
  // The activation itself re-checks validity against the database (mapping changed after the checks → refused).
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, false);
    await db.query(`UPDATE provider_connections SET updated_at=$1`, [t0 - DAY]); // the connection was saved yesterday
    await db.query(`INSERT INTO integration_checks(owner_id,provider_key,check_key,ok,detail,checked_at) VALUES($1,'channelManager','room_rate_mapping',1,'ok',$2),($1,'channelManager','initial_reconciliation',1,'ok',$2)`, [o, t0 + DAY]);
    assert.equal((await activateIntegration({ pool, owner: o, provider: "channelManager", by: "QA", now: t0 })).error, "PREREQUISITES_NOT_MET", "future-dated checks in the database");
    await db.query(`DELETE FROM integration_checks`);
    await db.query(`INSERT INTO integration_checks(owner_id,provider_key,check_key,ok,detail,checked_at) VALUES($1,'channelManager','room_rate_mapping',1,'ok',$2),($1,'channelManager','initial_reconciliation',1,'ok',$2)`, [o, t0 - HOUR]);
    await db.query(`INSERT INTO channel_room_mappings(owner_id,room_type,external_room_type_id,updated_at) VALUES($1,'double','rt-2',$2)`, [o, t0 - 5 * MIN]);
    assert.equal((await activateIntegration({ pool, owner: o, provider: "channelManager", by: "QA", now: t0 })).error, "PREREQUISITES_NOT_MET", "mapping changed after the checks");
    await db.query(`INSERT INTO integration_checks(owner_id,provider_key,check_key,ok,detail,checked_at) VALUES($1,'channelManager','room_rate_mapping',1,'ok',$2),($1,'channelManager','initial_reconciliation',1,'ok',$2)`, [o, t0 - MIN]);
    assert.equal((await activateIntegration({ pool, owner: o, provider: "channelManager", by: "QA", now: t0 })).ok, true, "re-verified after the change");
    // A later configuration change keeps the alerts on but asks for a new verification in the Reliability Center.
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - MIN]);
    await db.query(`UPDATE channel_room_mappings SET updated_at=$2 WHERE owner_id=$1`, [o, t0 + MIN]);
    const rel = await checkReliability({ pool, owner: o, now: t0 + 2 * MIN });
    assert.equal(rel.integrations?.channelManager, "ACTIVE");
    assert.ok(rel.areas.find((a) => a.key === "channel")!.items.some((i) => i.key === "integration:channelManager:revalidate"));
  } finally { await db.close(); }
});
