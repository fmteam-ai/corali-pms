import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sealSecrets } from "../scripts/integration-state-core.mjs";
import { checkReliability, recoverReliability, runReliabilityAlerts } from "../scripts/reliability-core.mjs";

process.env.PMS_DOCUMENT_KEY = "test-document-key-0123456789abcdef0123456789abcdef";

test("v188 reliability center: unfinished work per area, recovery, one alert per problem, a stopped cron", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
    const o = "hotel-corali", now = Date.parse("2026-07-15T10:00:00Z");
    // Nothing yet: everything OK, channel manager inactive.
    let r = await checkReliability({ pool, owner: o, now });
    // Nothing yet: only «no backup / no rehearsal / no post-install check recorded» (warnings), channel inactive.
    assert.equal(r.status, "warn");
    assert.deepEqual(r.areas.filter((a) => a.status === "warn").map((a) => a.key), ["backups", "release"]);
    assert.equal(r.areas.find((a) => a.key === "channel")?.status, "inactive");

    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$3)`, [o, now - 60_000, now - 3 * 3_600_000]);
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,attempts,last_error,created_at,updated_at) VALUES($1,'2026-08-01','2026-08-03','direct_booking','failed',4,'Channex 503',$2,$2)`, [o, now - 45 * 60_000]);
    // v202: a sync that ran is not enough — without a saved, activated connection the channel stays «inactive».
    r = await checkReliability({ pool, owner: o, now });
    assert.equal(r.areas.find((a) => a.key === "channel")?.status, "inactive");
    await db.query(`INSERT INTO provider_connections(owner_id,provider_key,active,secrets_encrypted,updated_by,updated_at) VALUES($1,'channelManager',1,$3,'qa',$2)`, [o, now, sealSecrets({ apiKey: "k" }, process.env.PMS_DOCUMENT_KEY!)]);
    await db.query(`UPDATE provider_connections SET settings_json='{"propertyCode":"p"}'`);
    await db.query(`INSERT INTO integration_activation(owner_id,provider_key,activated_at,activated_by) VALUES($1,'channelManager',$2,'qa')`, [o, now - 86_400_000]);
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','double',2,1,1,'clean')`, [o]);
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna','2026-07-14','2026-07-18','checked_in',5,1,0,1)`, [o]);
    await db.query(`INSERT INTO message_deliveries(owner_id,booking_id,event_key,channel,scheduled_at,status,last_error,attempts,created_at,updated_at) VALUES($1,1,'checkin','email',$2,'failed','SMTP 550',3,$2,$2)`, [o, now - 3_600_000]);
    await db.query(`INSERT INTO fiscal_documents(owner_id,booking_id,payer,invoice_type,series,aa,issue_date,buckets_json,document_json,total_cents,status,attempts,last_error,created_by,created_at,updated_at) VALUES($1,1,'guest','11.1','A',7,'2026-07-15','[]','{}',12000,'failed',3,'AADE 101','system',$2,$2)`, [o, now - 3_600_000]);
    await db.query(`INSERT INTO tv_screens(owner_id,room_id,token,last_seen_at,created_at) VALUES($1,5,'t',$2,1)`, [o, now - 40 * 60_000]);
    await db.query(`INSERT INTO automation_status(owner_id,name,last_run_at,last_ok_at,last_status,last_error,consecutive_failures) VALUES($1,'Guest messages',$2,$2,'ok','',0)`, [o, now - 25 * 60_000]);

    r = await checkReliability({ pool, owner: o, now });
    const area = (k: string) => r.areas.find((a) => a.key === k)!;
    assert.equal(r.status, "fail");
    assert.equal(area("channel").status, "fail");
    assert.match(area("channel").items[0].text, /2026-08-01 → 2026-08-03 \(direct_booking\) δεν έχει συγχρονιστεί.*4 προσπάθειες.*Channex 503/);
    assert.deepEqual(area("channel").items.find((i) => i.key.startsWith("outbox:"))!.action, { type: "retry_outbox", id: 1 });
    assert.equal(area("messaging").status, "fail");
    assert.equal(area("mydata").items[0].action?.type, "retry_fiscal");
    assert.match(area("devices").items[0].text, /Τηλεόραση δωματίου 112 \(με πελάτη\)/);
    assert.match(area("automations").items[0].text, /Το cron δεν έχει τρέξει/);

    // Recovery: the stuck availability change, the message and the document are queued again.
    assert.equal(await recoverReliability({ pool, owner: o, type: "retry_outbox", id: 1, now }), 1);
    assert.equal((await db.query<{ status: string; attempts: number }>(`SELECT status,attempts FROM channel_sync_outbox`)).rows[0].status, "pending");
    assert.equal(await recoverReliability({ pool, owner: o, type: "retry_delivery", now }), 1);
    assert.equal(await recoverReliability({ pool, owner: o, type: "retry_fiscal", now }), 1);

    // Alerts: once per problem; a problem that clears and comes back is told again.
    const n = async () => Number((await db.query<{ n: number }>(`SELECT count(*)::int n FROM pms_notifications WHERE link='/pms/reliability'`)).rows[0].n);
    const a1 = await runReliabilityAlerts({ pool, owner: o, now });
    assert.ok(a1.told >= 3, `told ${a1.told}`);
    const before = await n();
    await runReliabilityAlerts({ pool, owner: o, now: now + 10 * 60_000 });
    assert.equal(await n(), before, "no repeated alerts");
    await db.query(`UPDATE automation_status SET last_run_at=$1`, [now + 20 * 60_000]);
    await db.query(`UPDATE tv_screens SET last_seen_at=$1`, [now + 20 * 60_000]);
    const cleared = await runReliabilityAlerts({ pool, owner: o, now: now + 21 * 60_000 });
    assert.equal(cleared.told, 0);
    await db.query(`UPDATE tv_screens SET last_seen_at=$1`, [now]);
    const back = await runReliabilityAlerts({ pool, owner: o, now: now + 40 * 60_000 });
    assert.ok(back.told >= 1, "the TV problem came back and was told again");
  } finally { await db.close(); }
});

test("v189 reliability center: heartbeat, devices never connected, backups, release check, reconciliations, undelivered alerts", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
    const o = "hotel-corali", now = Date.parse("2026-07-15T10:00:00Z"), H = 3_600_000;
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','double',2,1,1,'clean'),(6,$1,'113','double',2,1,1,'clean')`, [o]);
    // The cron's last start was 12 minutes ago (it stopped), and an earlier run never ended.
    await db.query(`INSERT INTO cron_heartbeat(owner_id,job,last_start_at,last_finish_at,running_since,last_status,runs) VALUES($1,'automations',$2,$3,NULL,'ok',500)`, [o, now - 12 * 60_000, now - 11 * 60_000]);
    // A TV paired yesterday that never opened; an A/C set up two hours ago that never answered.
    await db.query(`INSERT INTO tv_screens(owner_id,room_id,token,last_seen_at,created_at) VALUES($1,6,'tv-never',NULL,$2)`, [o, now - 24 * H]);
    await db.query(`INSERT INTO room_ac_devices(owner_id,room_id,device_id,updated_at) VALUES($1,6,'ac-1',$2)`, [o, now - 2 * H]);
    // Backup 30 hours old, rehearsal only partial.
    await db.query(`INSERT INTO backup_runs(owner_id,kind,started_at,finished_at,status,file,size_bytes) VALUES($1,'backup',$2,$2,'ok','corali-db-x.dump.enc',1048576)`, [o, now - 30 * H]);
    await db.query(`INSERT INTO backup_runs(owner_id,kind,started_at,finished_at,status,file,details_json) VALUES($1,'rehearsal',$2,$2,'partial','corali-db-x.dump.enc','{"tables":120,"checks":[{"name":"x","ok":true}]}')`, [o, now - 2 * H]);
    // The installed version's post-install check failed on an ON CONFLICT.
    await db.query(`INSERT INTO release_checks(version,ran_at,status,checks_json,qa_json) VALUES('v189',$1,'failed',$2,'{"verdict":"PASS","passed":14,"total":14,"at":"2026-07-14","commit":"abc"}')`, [now - H, JSON.stringify([{ name: "ON CONFLICT στη βάση παραγωγής", status: "fail", detail: "payment_transactions(provider,provider_reference) 42P10" }])]);
    // Stripe reconciliation found a payment the PMS never recorded.
    await db.query(`INSERT INTO reconciliation_runs(owner_id,kind,ran_at,status,issues_json) VALUES($1,'stripe',$2,'fail',$3)`, [o, now - H, JSON.stringify([{ kind: "stripe_not_recorded", level: "fail", reference: "CR-9", amountCents: 12000, providerRef: "pi_missing", detail: "Το Stripe χρέωσε €120.00 (pi_missing) αλλά το PMS δεν το κατέγραψε" }])]);
    // An alert whose e-mail could not be delivered.
    await db.query(`INSERT INTO alerts(id,owner_id,alert_key,title,created_at) VALUES(1,$1,'rel:x','Πρόβλημα Χ',$2)`, [o, now - 2 * H]);
    await db.query(`INSERT INTO alert_outbox(owner_id,alert_id,channel,recipient,status,attempts,last_error,created_at,updated_at) VALUES($1,1,'email','maria@hotel.gr','failed',6,'550 mailbox',$2,$2)`, [o, now - 2 * H]);

    const r = await checkReliability({ pool, owner: o, now, version: "v189" });
    const items = (k: string) => r.areas.find((a) => a.key === k)!.items;
    const text = (k: string) => items(k).map((i) => `${i.level}:${i.text}`).join("\n");
    assert.match(text("automations"), /fail:Το cron δεν έχει ξεκινήσει/);
    assert.match(text("automations"), /fail:Η ειδοποίηση «Πρόβλημα Χ» δεν παραδόθηκε \(email maria@hotel\.gr\).*550/);
    assert.deepEqual(items("automations").find((i) => i.key.startsWith("alertdelivery:"))!.action, { type: "retry_alert", id: 1 });
    assert.match(text("devices"), /warn:Τηλεόραση δωματίου 113: ρυθμίστηκε .* αλλά δεν συνδέθηκε ποτέ/);
    assert.match(text("devices"), /warn:Κλιματισμός 113: ρυθμίστηκε αλλά δεν έχει απαντήσει ποτέ/);
    assert.match(text("backups"), /fail:Τελευταίο αντίγραφο ασφαλείας .* το ημερήσιο δεν έγινε/);
    assert.match(text("backups"), /warn:Δοκιμή .* δεν επαναφέρθηκε σε βάση — ορίστε REHEARSAL_DATABASE_URL/);
    assert.match(text("release"), /fail:Έλεγχος εγκατάστασης v189: ON CONFLICT .*42P10/);
    assert.match(r.areas.find((a) => a.key === "release")!.info.join(" "), /QA 14\/14 PASS/);
    assert.match(text("payments"), /fail:Συμφωνία με Stripe: Το Stripe χρέωσε €120\.00/);

    // Recovery of the alert delivery: queued again from the start.
    assert.equal(await recoverReliability({ pool, owner: o, type: "retry_alert", id: 1, now }), 1);
    assert.equal((await db.query<{ status: string; attempts: number }>(`SELECT status,attempts FROM alert_outbox`)).rows[0].status, "pending");
    // A message being sent right now is not taken back (no double send); a stuck one (20 minutes) is.
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna','2026-07-14','2026-07-18','checked_in',5,1,0,1)`, [o]);
    await db.query(`INSERT INTO message_deliveries(id,owner_id,booking_id,event_key,channel,scheduled_at,status,attempts,created_at,updated_at) VALUES(10,$1,1,'checkin','email',$2,'processing',1,$2,$3),(11,$1,1,'review','email',$2,'processing',1,$2,$4)`, [o, now - H, now - 60_000, now - 20 * 60_000]);
    // v190: neither one is taken back automatically — «processing» may be sending right now or may have gone.
    assert.equal(await recoverReliability({ pool, owner: o, type: "retry_delivery", now }), 0);
    assert.deepEqual((await db.query<{ id: number; status: string }>(`SELECT id,status FROM message_deliveries ORDER BY id`)).rows.map((x) => `${x.id}:${x.status}`), ["10:processing", "11:processing"]);
    // The cron marks the stuck one «uncertain»; the center asks a person, with both choices.
    await db.query(`UPDATE message_deliveries SET status='uncertain' WHERE id IN (11,10)`);
    const r2 = await checkReliability({ pool, owner: o, now, version: "v190" });
    const unc = r2.areas.find((a) => a.key === "messaging")!.items.find((i) => i.key === "uncertain:11")!;
    assert.match(unc.text, /αβέβαιο αν στάλθηκε/);
    assert.deepEqual([unc.action, unc.altAction], [{ type: "resend_uncertain", id: 11 }, { type: "mark_sent", id: 11 }]);
    await assert.rejects(recoverReliability({ pool, owner: o, type: "resend_uncertain", now }), /ID_REQUIRED/, "never «all» for uncertain sends");
    assert.equal(await recoverReliability({ pool, owner: o, type: "resend_uncertain", id: 11, now }), 1);
    assert.equal(await recoverReliability({ pool, owner: o, type: "mark_sent", id: 10, now }), 1);
    assert.deepEqual((await db.query<{ id: number; status: string }>(`SELECT id,status FROM message_deliveries ORDER BY id`)).rows.map((x) => `${x.id}:${x.status}`), ["10:sent", "11:pending"]);
    // v190: the release check is installation-wide, read by its explicit scope.
    await db.query(`INSERT INTO release_checks(version,ran_at,status,checks_json,qa_json,scope) VALUES('v-other',$1,'ok','[]','{}','something-else')`, [now]);
    assert.match((await checkReliability({ pool, owner: o, now, version: "v189" })).areas.find((a) => a.key === "release")!.items.map((i) => i.text).join(" "), /v189/);
  } finally { await db.close(); }
});

test("v190→v202 every critical problem is alerted (none dropped) — as ONE aggregated incident per kind, not one per row", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
    const o = "hotel-corali", now = Date.parse("2026-07-15T10:00:00Z");
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna','2026-07-14','2026-07-18','checked_in',1,0,1)`, [o]);
    for (let i = 0; i < 45; i++) await db.query(`INSERT INTO fiscal_documents(owner_id,booking_id,payer,invoice_type,series,aa,issue_date,buckets_json,document_json,total_cents,status,attempts,last_error,created_by,created_at,updated_at) VALUES($1,1,'guest','11.1','A',$2,'2026-07-15','[]','{}',100,'failed',3,'AADE','system',$3,$3)`, [o, i + 1, now - 3_600_000]);
    const r = await runReliabilityAlerts({ pool, owner: o, now, emails: [] });
    // v202 Alert Intelligence: the 45 failing documents are ONE incident (none dropped: the count is in it).
    const alerts = (await db.query<{ alert_key: string; details_json: string }>(`SELECT alert_key,details_json FROM alerts WHERE alert_key LIKE 'rel:fiscal:%'`)).rows;
    assert.deepEqual(alerts.map((a) => a.alert_key), ["rel:fiscal:*"], "one alert for all 45 documents");
    assert.equal(JSON.parse(alerts[0].details_json).count, 45);
    assert.ok(r.failing >= 45 && r.alerts < r.failing);
    const notes = (await db.query<{ title_el: string }>(`SELECT title_el FROM pms_notifications ORDER BY id`)).rows;
    assert.ok(notes.length <= 11);
  } finally { await db.close(); }
});
