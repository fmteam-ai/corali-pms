import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { checkReliability, runReliabilityAlerts } from "../scripts/reliability-core.mjs";
import { deliverAlerts, raiseAlert, resolveAlerts, ALERT_EMAILS_PER_HOUR } from "../scripts/alert-core.mjs";
import { findingsFrom } from "../scripts/sentinel-core.mjs";
import { buildIncidents, channelIncident, formatAlertMessage } from "../scripts/alert-intel-core.mjs";
import { activateIntegration, activationReadiness, integrationState, recordIntegrationCheck, sealSecrets } from "../scripts/integration-state-core.mjs";

process.env.PMS_DOCUMENT_KEY = "test-document-key-0123456789abcdef0123456789abcdef";
const SEALED = sealSecrets({ apiKey: "channex-test-key" }, process.env.PMS_DOCUMENT_KEY);
const OK = { ok: true, missing: [], reason: "OK" };

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
  await db.query(`INSERT INTO provider_connections(owner_id,provider_key,active,secrets_encrypted,updated_by,updated_at) VALUES($1,'channelManager',$2,$4,'qa',$3)`, [o, active, t0, SEALED]);
  await db.query(`UPDATE provider_connections SET settings_json=$2 WHERE owner_id=$1`, [o, JSON.stringify({ propertyCode: "prop-1" })]);
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
    assert.equal(integrationState({ row: { active: 1, secrets_encrypted: "s" }, credentials: OK, activation: { activated_at: t0 }, healthy: true }), "ACTIVE");
    assert.equal(integrationState({ row: { active: 1, secrets_encrypted: "s" }, credentials: OK, activation: { activated_at: t0 } }), "UNVERIFIED", "v203: unknown health is not ACTIVE");
    assert.equal(integrationState({ row: { active: 1, secrets_encrypted: "s" }, credentials: OK, activation: { activated_at: t0 }, healthy: false }), "DEGRADED");
    assert.equal(integrationState({ row: { active: 0, secrets_encrypted: "s" }, credentials: OK, activation: { activated_at: t0 } }), "DISABLED");
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
  assert.equal(integrationState({ row, credentials: OK, activation: act }), "UNVERIFIED", "healthy omitted");
  assert.equal(integrationState({ row, credentials: OK, activation: act, healthy: null }), "UNVERIFIED", "healthy null");
  assert.equal(integrationState({ row, credentials: OK, activation: act, healthy: true }), "ACTIVE");
  assert.equal(integrationState({ row, credentials: OK, activation: act, healthy: false }), "DEGRADED");
  assert.equal(integrationState({ row: null, healthy: null }), "NOT_CONFIGURED");
  assert.equal(integrationState({ row: { active: 0, secrets_encrypted: "s" }, credentials: OK, activation: act, healthy: null }), "DISABLED");
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

test("v204 P1: the Channex health follows the LATEST run — a recent success does not hide a failure after it", async () => {
  const { channelSyncHealthy } = await import("../scripts/integration-state-core.mjs");
  // The reported case: success 2′ ago, failed run 1′ ago with HTTP 401 → was true.
  assert.equal(channelSyncHealthy({ last_run_at: t0 - MIN, last_ok_at: t0 - 2 * MIN, last_error: "HTTP 401" }, t0), false);
  assert.equal(channelSyncHealthy({ last_run_at: t0 - MIN, last_ok_at: t0 - 2 * MIN, last_error: null }, t0), false, "latest run after the last success = failed, even without an error text");
  assert.equal(channelSyncHealthy({ last_run_at: t0 - MIN, last_ok_at: t0 - MIN, last_error: "restrictions double: 422" }, t0), false, "an error recorded after the success");
  assert.equal(channelSyncHealthy({ last_run_at: t0 - MIN, last_ok_at: t0 - MIN, last_error: null }, t0), true);
  // On the real schema: activated Channex, latest run failed → DEGRADED and one critical incident.
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, true);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at,last_error) VALUES($1,$2,$3,'HTTP 401')`, [o, t0 - MIN, t0 - 2 * MIN]);
    assert.equal((await checkReliability({ pool, owner: o, now: t0 })).integrations?.channelManager, "DEGRADED");
  } finally { await db.close(); }
});

test("v204 P1: without its required credentials a connection is never TESTING/ACTIVE; an ACTIVATED one that lost them is DEGRADED and alerted; activation refused", async () => {
  const { credentialsStatus } = await import("../scripts/integration-state-core.mjs");
  const key = process.env.PMS_DOCUMENT_KEY!;
  // The reported case: active=1, secrets_encrypted=null, an old activation, healthy → was TESTING / ACTIVE.
  const empty = { active: 1, secrets_encrypted: null, settings_json: "{}" };
  const cred = credentialsStatus("channelManager", empty, key);
  assert.deepEqual([cred.ok, cred.reason], [false, "NO_SECRETS"]);
  // Never activated → simply not configured (no alerts).
  assert.equal(integrationState({ row: empty, credentials: cred, healthy: true }), "NOT_CONFIGURED");
  assert.equal(integrationState({ row: empty, healthy: true }), "NOT_CONFIGURED", "credentials not checked → not trusted");
  // The reported case — an old activation: never TESTING / ACTIVE. Review finding: it must not go silent either →
  // DEGRADED (alerted); if this process cannot check credentials at all → UNVERIFIED.
  assert.equal(integrationState({ row: empty, credentials: cred, activation: { activated_at: t0 - DAY }, healthy: true }), "DEGRADED");
  assert.equal(integrationState({ row: empty, credentials: { ok: false, missing: [], reason: "CANNOT_VERIFY" }, activation: { activated_at: t0 - DAY }, healthy: true }), "UNVERIFIED");
  assert.equal(integrationState({ row: empty, credentials: cred, activation: { activated_at: t0 - DAY, deactivated_at: t0 }, healthy: true }), "NOT_CONFIGURED", "returned to testing earlier → not activated");
  // Sealed but incomplete, unreadable, complete.
  assert.deepEqual(credentialsStatus("channelManager", { secrets_encrypted: sealSecrets({ apiKey: " " }, key), settings_json: "{}" }, key).missing, ["apiKey", "propertyCode"]);
  assert.equal(credentialsStatus("channelManager", { secrets_encrypted: sealSecrets({ apiKey: "k" }, "another-key-0123456789abcdef0123456789"), settings_json: '{"propertyCode":"p"}' }, key).reason, "SECRETS_UNREADABLE");
  assert.equal(credentialsStatus("channelManager", { secrets_encrypted: "x", settings_json: "{}" }, key).ok, false, "no artificial placeholder");
  assert.equal(credentialsStatus("channelManager", { secrets_encrypted: SEALED, settings_json: '{"propertyCode":"p"}' }, key).ok, true);
  assert.equal(credentialsStatus("someNewProvider", { secrets_encrypted: SEALED }, key).reason, "NO_REQUIREMENTS_DEFINED", "an unknown provider is not assumed configured");
  for (const p of ["viva", "whatsapp", "tuya", "stripe", "mydata", "meta", "omada"]) assert.equal(credentialsStatus(p, { secrets_encrypted: SEALED, settings_json: "{}" }, key).ok, false, p);
  // On the database: active, no secrets, old activation, healthy sync → NOT_CONFIGURED; activation refused.
  const { db, pool } = await fresh();
  try {
    await db.query(`INSERT INTO provider_connections(owner_id,provider_key,active,secrets_encrypted,settings_json,updated_by,updated_at) VALUES($1,'channelManager',1,'','{}','qa',$2)`, [o, t0 - DAY]);
    await db.query(`INSERT INTO integration_activation(owner_id,provider_key,activated_at,activated_by) VALUES($1,'channelManager',$2,'qa')`, [o, t0 - 10 * DAY]);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - MIN]);
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,'2026-12-24','2026-12-26','qa','pending',$2,$2)`, [o, t0 - 2 * HOUR]);
    const r = await checkReliability({ pool, owner: o, now: t0 });
    assert.equal(r.integrations?.channelManager, "DEGRADED", "activated, credentials gone → a failure");
    assert.ok(r.areas.find((a) => a.key === "channel")!.items.some((i) => i.key === "integration:channelManager:credentials" && i.level === "fail"));
    const res = await runReliabilityAlerts({ pool, owner: o, now: t0, emails: ADMIN });
    assert.deepEqual(res.incidents.filter((i) => i.key === "sync:ota").map((i) => i.priority), ["critical"]);
    assert.match(JSON.parse((await db.query<{ details_json: string }>(`SELECT details_json FROM alerts WHERE alert_key='rel:sync:ota'`)).rows[0].details_json).rootCause, /NO_SECRETS/);
    assert.equal(await emails(db), 1, "one e-mail for the incident");
    // Never activated + no credentials → not configured, silent.
    await db.query(`DELETE FROM integration_activation`);
    await db.query(`UPDATE alerts SET resolved_at=$1`, [t0]);
    const r2 = await checkReliability({ pool, owner: o, now: t0 + MIN });
    assert.equal(r2.integrations?.channelManager, "NOT_CONFIGURED");
    assert.match(r2.areas.find((a) => a.key === "channel")!.info.join(" "), /ελλιπής \(NO_SECRETS\)/);
    await db.query(`INSERT INTO integration_checks(owner_id,provider_key,check_key,ok,detail,checked_at) VALUES($1,'channelManager','room_rate_mapping',1,'ok',$2),($1,'channelManager','initial_reconciliation',1,'ok',$2)`, [o, t0 - MIN]);
    const a = await activateIntegration({ pool, owner: o, provider: "channelManager", by: "QA", now: t0 });
    assert.deepEqual([a.ok, a.error], [false, "CREDENTIALS_MISSING"]);
  } finally { await db.close(); }
});

test("v204 review: incident and reliability judge the LATEST run too, after 10′ of continuous failure (no wrong root cause)", async () => {
  const { channelIncident } = await import("../scripts/alert-intel-core.mjs");
  const base = { connection: "DEGRADED", credentials: "OK", live: 3, oldestAt: t0 - HOUR, lastRunAt: t0 - MIN, lastError: "HTTP 503" };
  // The reviewer's scenario: success 5′ ago, failed run 1′ ago → inside the grace: no incident without a backlog;
  // with an hour-old backlog it is reported with the FAILING RUN as its cause — never «sync succeeds but rows stay».
  assert.equal(channelIncident({ ...base, live: 0, oldestAt: null, lastOkAt: t0 - 5 * MIN }, t0), null);
  const early = channelIncident({ ...base, lastOkAt: t0 - 5 * MIN }, t0)!;
  assert.match(early.problem, /απέτυχε/);
  assert.doesNotMatch(early.rootCause!, /λανθασμένη κατάσταση outbox/);
  const inc = channelIncident({ ...base, lastOkAt: t0 - 11 * MIN }, t0)!;
  assert.equal(inc.priority, "high");
  assert.match(inc.problem, /η τελευταία εκτέλεση απέτυχε/);
  assert.equal(channelIncident({ ...base, lastOkAt: t0 - 7 * HOUR }, t0)!.priority, "critical");
  // Failed run without error text (a run after the last success) counts too.
  assert.match(channelIncident({ ...base, lastError: null, lastOkAt: t0 - 20 * MIN }, t0)!.problem, /απέτυχε/);
  // Activated and failing with an EMPTY queue is still an incident (OTA bookings come through the same sync).
  assert.ok(channelIncident({ ...base, live: 0, oldestAt: null, lastOkAt: t0 - 20 * MIN }, t0));
  // Latest run succeeded but rows stay → the outbox diagnosis.
  assert.match(channelIncident({ ...base, lastError: null, lastOkAt: t0 - MIN }, t0)!.rootCause!, /λανθασμένη κατάσταση outbox/);
  // On the database: the reliability item follows the same rule.
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, true);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at,last_error) VALUES($1,$2,$3,'HTTP 503')`, [o, t0 - MIN, t0 - 12 * MIN]);
    const r = await checkReliability({ pool, owner: o, now: t0 });
    assert.equal(r.integrations?.channelManager, "DEGRADED");
    assert.ok(r.areas.find((a) => a.key === "channel")!.items.some((i) => i.key === "sync:stale" && /τελευταία εκτέλεση/.test(i.text)));
  } finally { await db.close(); }
});

test("v204 review 2: grace from the START of the current failure; an open incident is never «recovered» during the grace; one incident; TESTING never alerts", async () => {
  const { channelIncident } = await import("../scripts/alert-intel-core.mjs");
  const b = { connection: "DEGRADED", credentials: "OK", live: 3, oldestAt: t0 - 3 * HOUR, soon: 2, lastRunAt: t0 - MIN, lastError: "HTTP_503" };
  // (1) success 5′ ago, failing since 4′, incident already open → stays open (no false recovery).
  assert.ok(channelIncident({ ...b, lastOkAt: t0 - 5 * MIN, failingSince: t0 - 4 * MIN, incidentOpen: true }, t0));
  // … not open yet, but a 3-hour-old backlog → still reported (with the failing run as cause).
  assert.match(channelIncident({ ...b, lastOkAt: t0 - 5 * MIN, failingSince: t0 - 4 * MIN, incidentOpen: false }, t0)!.problem, /απέτυχε/);
  // … no backlog, not open, inside the grace → nothing yet.
  assert.equal(channelIncident({ ...b, live: 0, oldestAt: null, lastOkAt: t0 - 5 * MIN, failingSince: t0 - 4 * MIN }, t0), null);
  // (2) first failure of a newly activated connection (never succeeded) → grace, not an immediate critical.
  assert.equal(channelIncident({ ...b, live: 0, oldestAt: null, lastOkAt: null, failingSince: t0 - MIN }, t0), null);
  assert.equal(channelIncident({ ...b, live: 0, oldestAt: null, lastOkAt: null, failingSince: t0 - 11 * MIN }, t0)!.priority, "high");
  assert.equal(channelIncident({ ...b, live: 0, oldestAt: null, lastOkAt: null, failingSince: t0 - 7 * HOUR }, t0)!.priority, "critical");
  // Full flow on the database: the alert opened, then a single success and new failures — no recovery notice.
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, true);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at,last_error,failing_since) VALUES($1,$2,$3,'HTTP_503',$4)`, [o, t0 - MIN, t0 - 2 * HOUR, t0 - 2 * HOUR]);
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,'2026-12-24','2026-12-26','qa','pending',$2,$2)`, [o, t0 - 3 * HOUR]);
    await runReliabilityAlerts({ pool, owner: o, now: t0, emails: ADMIN });
    await deliverAlerts({ pool, owner: o, send, now: t0 + MIN });
    // One success at t0+5′, then failing again from t0+6′; checked at t0+10′ (inside the grace).
    await db.query(`UPDATE channel_sync_state SET last_run_at=$2,last_ok_at=$3,last_error='HTTP_503',failing_since=$2 WHERE owner_id=$1`, [o, t0 + 9 * MIN, t0 + 5 * MIN]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 10 * MIN, emails: ADMIN });
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE alert_key='rel:sync:ota' AND resolved_at IS NULL`), 1, "still open");
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE purpose='recovery'`), 0, "no false «recovered»");
    // (3) cron stopped > 30′ on an activated connection → exactly ONE incident for the OTA sync.
    await db.query(`INSERT INTO cron_heartbeat(owner_id,job,last_start_at,last_finish_at,runs,last_status) VALUES($1,'channel-sync',$2,$2,10,'ok') ON CONFLICT DO NOTHING`, [o, t0 - 2 * HOUR]);
    await db.query(`UPDATE channel_sync_state SET last_run_at=$2 WHERE owner_id=$1`, [o, t0 - 2 * HOUR]);
    const r = await runReliabilityAlerts({ pool, owner: o, now: t0 + 20 * MIN, emails: ADMIN });
    assert.deepEqual(r.incidents.filter((i) => i.key.includes("sync") || i.key.includes("cron:channel")).map((i) => i.key), ["sync:ota"]);
  } finally { await db.close(); }
  // (4) TESTING connection with a stopped cron and failures → no push / e-mail incident at all.
  const t = await fresh();
  try {
    await connection(t.db, 1, false);
    await t.db.query(`INSERT INTO cron_heartbeat(owner_id,job,last_start_at,last_finish_at,runs,last_status) VALUES($1,'channel-sync',$2,$2,10,'ok') ON CONFLICT DO NOTHING`, [o, t0 - 2 * HOUR]);
    await t.db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_error) VALUES($1,$2,'HTTP_401')`, [o, t0 - 2 * HOUR]);
    const r = await runReliabilityAlerts({ pool: t.pool, owner: o, now: t0, emails: ADMIN });
    assert.ok(r.incidents.filter((i) => ["critical", "high", "medium"].includes(i.priority)).every((i) => !["channel"].includes(i.key.split(":")[0]) && !/sync|cron:channel|ota/.test(i.key)), JSON.stringify(r.incidents));
    assert.equal(await t.db.query(`SELECT count(*)::int AS n FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id WHERE a.area='channel'`).then((x) => Number((x.rows[0] as { n: number }).n)), 0, "nothing pushed or e-mailed for a TESTING channel");
  } finally { await t.db.close(); }
  // (5) Sentinel still sees the «unverified» / «revalidate» warnings.
  const { findingsFrom } = await import("../scripts/sentinel-core.mjs");
  const f = findingsFrom({ areas: [{ key: "channel", el: "Channel", items: [{ key: "integration:channelManager:unverified", level: "warn", text: "x" }, { key: "integration:channelManager:revalidate", level: "warn", text: "y" }] }] }, { at: t0, components: {} }, t0);
  assert.deepEqual(f.map((x) => x.key).sort(), ["integration:channelManager:revalidate", "integration:channelManager:unverified"]);
  // (9) credentials as the workers need them.
  const { REQUIRED_CREDENTIALS } = await import("../scripts/integration-state-core.mjs");
  // One table with the save form (review 3): Omada needs omadacId (and the form's profile / ssid); Viva needs no
  // merchantId (not used) but the environment the form requires; myDATA what the queue sends.
  assert.deepEqual(REQUIRED_CREDENTIALS.omada.settings, ["interfaceUrl", "omadacId", "profile", "ssid"]);
  assert.deepEqual(REQUIRED_CREDENTIALS.viva.settings, ["environment"]);
  assert.deepEqual(REQUIRED_CREDENTIALS.mydata.secrets, ["username", "subscriptionKey"]);
  const route = readFileSync("app/api/pms/provider-connections/route.ts", "utf8");
  assert.match(route, /\.\.\.REQUIRED_CREDENTIALS/, "the save form uses the same table");
});

test("v204 review 3: stale failure start ignored; a «low» from TESTING does not skip the grace; switching off closes silently; one incident when the whole cron stops; OTA ranges grouped", async () => {
  const { channelIncident, buildIncidents } = await import("../scripts/alert-intel-core.mjs");
  const b = { connection: "DEGRADED", credentials: "OK", live: 0, oldestAt: null, lastRunAt: t0 - MIN, lastError: "HTTP_503" };
  // A failing_since older than the last success (left from an earlier failure / a rollback) is not the start.
  assert.equal(channelIncident({ ...b, lastOkAt: t0 - 3 * MIN, failingSince: t0 - 3 * DAY }, t0), null, "inside the grace of the CURRENT failure");
  // Legacy rows: no failing_since, last success 8 h ago → still critical (the start is bounded by the last success).
  assert.equal(channelIncident({ ...b, lastOkAt: t0 - 8 * HOUR, failingSince: null }, t0)!.priority, "critical");
  const { db, pool } = await fresh();
  try {
    // TESTING with a backlog stores a LOW alert (no deliveries)…
    await connection(db, 1, false);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - MIN]);
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,'2026-12-24','2026-12-26','qa','pending',$2,$2)`, [o, t0 - HOUR]);
    await runReliabilityAlerts({ pool, owner: o, now: t0, emails: ADMIN });
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE alert_key='rel:sync:ota' AND priority='low' AND resolved_at IS NULL`), 1);
    // … activated; the first failed run (inside the grace, empty queue) → no «worsened» push / e-mail.
    await db.query(`INSERT INTO integration_activation(owner_id,provider_key,activated_at,activated_by) VALUES($1,'channelManager',$2,'qa')`, [o, t0 + MIN]);
    await db.query(`UPDATE channel_sync_outbox SET status='sent'`);
    await db.query(`UPDATE channel_sync_state SET last_run_at=$2,last_error='HTTP_401',failing_since=$2 WHERE owner_id=$1`, [o, t0 + 2 * MIN]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 3 * MIN, emails: ADMIN });
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox`), 0, "nothing sent inside the grace");
    // Failing past the grace → one high incident, delivered; then the connection is switched back to testing:
    // the alert closes WITHOUT a «recovered» notice (nothing was fixed).
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 15 * MIN, emails: ADMIN });
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE alert_key='rel:sync:ota' AND priority='high' AND resolved_at IS NULL`), 1);
    await deliverAlerts({ pool, owner: o, send, now: t0 + 16 * MIN });
    await db.query(`UPDATE integration_activation SET deactivated_at=$1`, [t0 + 17 * MIN]);
    await runReliabilityAlerts({ pool, owner: o, now: t0 + 18 * MIN, emails: ADMIN });
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE alert_key='rel:sync:ota' AND resolved_at IS NULL`), 0);
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE purpose='recovery'`), 0, "no false «recovered»");
  } finally { await db.close(); }
  // Review 4: no cron correlation (it practically never applies to alerts — they run inside that cron — and made the
  // Sentinel «verify» a recovery that did not happen). 12 OTA ranges are still ONE incident.
  const rel = { integrations: { channelManager: "ACTIVE" }, channelStats: { connection: "ACTIVE", credentials: "OK", live: 2, oldestAt: t0 - HOUR, lastRunAt: t0 - 2 * HOUR, lastOkAt: t0 - 2 * HOUR },
    areas: [{ key: "automations", el: "Cron", items: [{ key: "cron:stopped", level: "fail", text: "Το cron έχει σταματήσει" }] }, { key: "channel", el: "Channel", items: Array.from({ length: 12 }, (_, i) => ({ key: `ota:double:2026-12-${String(i + 1).padStart(2, "0")}`, level: "fail", text: `range ${i}` })) }] };
  const inc = buildIncidents(rel, t0).map((i) => i.key).sort();
  assert.deepEqual(inc, ["cron:stopped", "ota:*", "sync:ota"], "12 OTA ranges = one incident; no correlation filter");
});

test("v204 review 4/5: switching off closes every channel alert silently; items absorbed into the OTA group close silently; schema-fallback grace", async () => {
  const { channelIncident } = await import("../scripts/alert-intel-core.mjs");
  // Schema update not run (failingSince undefined) and never succeeded → no endless grace, and no invented duration.
  const unk = channelIncident({ connection: "DEGRADED", credentials: "OK", live: 0, lastRunAt: t0 - MIN, lastOkAt: null, lastError: "HTTP_401", failingSince: undefined }, t0)!;
  assert.equal(unk.priority, "high");
  assert.match(unk.rootCause!, /δεν είναι γνωστό/);
  const { db, pool } = await fresh();
  try {
    await connection(db, 1, true);
    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$2)`, [o, t0 - MIN]);
    // An open per-range OTA alert from an earlier version, already e-mailed (sent).
    const id = Number((await db.query<{ id: number }>(`INSERT INTO alerts(owner_id,alert_key,area,severity,priority,details_json,title,link,created_at) VALUES($1,'rel:ota:double:2026-12-01','channel','fail','high','{"problem":"x"}','x','/',$2) RETURNING id`, [o, t0 - HOUR])).rows[0].id);
    await db.query(`INSERT INTO alert_outbox(owner_id,alert_id,occurrence,channel,recipient,purpose,status,created_at,updated_at) VALUES($1,$2,1,'email',$3,'alert','sent',$4,$4)`, [o, id, ADMIN[0], t0 - HOUR]);
    // Switched off → the alert closes, no «recovered».
    await db.query(`UPDATE provider_connections SET active=0`);
    await runReliabilityAlerts({ pool, owner: o, now: t0, emails: ADMIN });
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE resolved_at IS NULL AND area='channel'`), 0);
    assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE purpose='recovery'`), 0, "no false «recovered» on switch-off");
    // Activated again with an OTA difference: an old per-range alert is absorbed into «ota:*» — closed silently.
    await db.query(`UPDATE provider_connections SET active=1`);
    await db.query(`UPDATE alerts SET resolved_at=NULL WHERE id=$1`, [id]);
    await db.query(`INSERT INTO channel_room_mappings(owner_id,room_type,external_room_type_id,updated_at) VALUES($1,'double','rt',$2)`, [o, t0 - 40 * DAY]);
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(9,$1,'201','double',2,1,1,'clean')`, [o]);
    await db.query(`INSERT INTO channel_availability_state(owner_id,room_type,date,available,pushed_at) VALUES($1,'double',to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD'),5,$2)`, [o, t0 - DAY]);
    const res = await runReliabilityAlerts({ pool, owner: o, now: t0 + MIN, emails: ADMIN });
    assert.ok(res.incidents.some((i) => i.key === "ota:*"), `the OTA difference must form the group: ${JSON.stringify(res.incidents)}`);
    {
      assert.equal(await n(db, `SELECT count(*)::int AS n FROM alerts WHERE id=$1 AND resolved_at IS NOT NULL`, [id]), 1);
      assert.equal(await n(db, `SELECT count(*)::int AS n FROM alert_outbox WHERE purpose='recovery'`), 0, "absorbed into the group: no «recovered»");
    }
  } finally { await db.close(); }
});
