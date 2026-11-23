import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { checkReliability, recoverReliability, runReliabilityAlerts } from "../scripts/reliability-core.mjs";

test("v188 reliability center: unfinished work per area, recovery, one alert per problem, a stopped cron", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
    const o = "hotel-corali", now = Date.parse("2026-07-15T10:00:00Z");
    // Nothing yet: everything OK, channel manager inactive.
    let r = await checkReliability({ pool, owner: o, now });
    assert.equal(r.status, "ok");
    assert.equal(r.areas.find((a) => a.key === "channel")?.status, "inactive");

    await db.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at) VALUES($1,$2,$3)`, [o, now - 60_000, now - 3 * 3_600_000]);
    await db.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,attempts,last_error,created_at,updated_at) VALUES($1,'2026-08-01','2026-08-03','direct_booking','failed',4,'Channex 503',$2,$2)`, [o, now - 45 * 60_000]);
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
