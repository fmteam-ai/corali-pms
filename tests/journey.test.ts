import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { evalClimate, evalHkReady, evalInstructions, evalTvWelcome, stepsFor, journeySummary, type JourneyBooking } from "../scripts/journey-core.mjs";
import { confirmJourneyStep, recordAutomation, runJourney } from "../scripts/journey-worker.mjs";
import { hotelMs } from "../scripts/room-ready-core.mjs";

const today = "2026-07-15", checkInMs = hotelMs(today, "13:00");
const b = (x: Partial<JourneyBooking> = {}): JourneyBooking => ({ id: 1, status: "confirmed", checkIn: today, checkOut: "2026-07-18", guestName: "Anna Müller", lang: "de", roomId: 5, email: "a@x.de", phone: "", ...x });

test("steps follow the real state of the stay", () => {
  assert.deepEqual(stepsFor(b(), today), ["msg_instructions", "hk_ready", "climate_comfort"]);
  assert.deepEqual(stepsFor(b({ checkIn: "2026-07-16" }), today), ["msg_instructions"]);
  assert.deepEqual(stepsFor(b({ status: "checked_in" }), today), ["hk_ready", "climate_comfort", "tv_welcome"]);
  assert.deepEqual(stepsFor(b({ status: "checked_in", checkIn: "2026-07-13" }), today), ["tv_welcome"]);
  assert.equal(journeySummary([{ status: "succeeded" }, { status: "unconfirmed" }, { status: "failed" }]), "failed");
});

test("housekeeping readiness: ready, on time, late, unknown, out of service", () => {
  const now = checkInMs - 4 * 3_600_000;
  assert.equal(evalHkReady({ booking: b(), now, today, checkInMs, room: { code: "112", state: "ready", eta: null } }).status, "succeeded");
  assert.equal(evalHkReady({ booking: b(), now, today, checkInMs, room: { code: "112", state: "preparing", eta: checkInMs - 3_600_000 } }).status, "pending");
  const late = evalHkReady({ booking: b(), now, today, checkInMs, room: { code: "112", state: "preparing", eta: checkInMs + 3_600_000 } });
  assert.equal(late.status, "failed"); assert.equal(late.alert, "housekeeping");
  assert.equal(evalHkReady({ booking: b(), now, today, checkInMs, room: { code: "112", state: "preparing", eta: null } }).status, "pending", "early in the day: waiting");
  assert.equal(evalHkReady({ booking: b(), now: checkInMs - 3_600_000, today, checkInMs, room: { code: "112", state: "preparing", eta: null } }).status, "failed", "close to check-in without a time");
  assert.equal(evalHkReady({ booking: b(), now, today, checkInMs, room: { code: "112", state: "out_of_service", eta: null } }).alert, "reception");
  assert.equal(evalHkReady({ booking: b({ roomId: null }), now, today, checkInMs, room: null }).status, "failed");
});

test("messaging: sent, failed → 2 automatic retries → failed, automations off → unconfirmed", () => {
  const now = checkInMs - 3_600_000, base = { booking: b(), now, today, checkInMs, arrivalAutomationOn: true };
  assert.equal(evalInstructions({ ...base, deliveries: [{ event: "pre_arrival", channel: "email", status: "sent", error: "", sentAt: now }] }).status, "succeeded");
  const f = { event: "checkin", channel: "email", status: "failed", error: "SMTP 550", sentAt: null };
  assert.equal(evalInstructions({ ...base, deliveries: [f] }).action?.type, "retry_deliveries");
  assert.equal(evalInstructions({ ...base, deliveries: [f], prev: { status: "pending", detail: "", result: { retries: 2 } } }).status, "failed");
  assert.equal(evalInstructions({ ...base, arrivalAutomationOn: false, deliveries: [] }).status, "unconfirmed");
  assert.equal(evalInstructions({ ...base, booking: b({ email: "", phone: "" }), deliveries: [] }).status, "skipped");
});

test("climate: no sensor → unconfirmed; hot room → A/C pre-conditioning → still hot after 45′ → failed", () => {
  const now = checkInMs - 3_600_000, base = { booking: b(), now, today, checkInMs };
  assert.equal(evalClimate({ ...base, climate: null }).status, "unconfirmed");
  assert.equal(evalClimate({ ...base, climate: { temp: 23, readAt: now - 60_000 } }).status, "succeeded");
  const hot = evalClimate({ ...base, climate: { temp: 29, readAt: now }, ac: { device: true, enabled: true, occupied: false } });
  assert.equal(hot.action?.type, "ac_precondition");
  assert.equal(evalClimate({ ...base, climate: { temp: 28, readAt: now }, ac: { device: true, enabled: true, occupied: false }, prev: { status: "pending", detail: "", result: { acStartedAt: now - 20 * 60_000 } } }).status, "pending");
  assert.equal(evalClimate({ ...base, climate: { temp: 28, readAt: now }, ac: { device: true, enabled: true, occupied: false }, prev: { status: "pending", detail: "", result: { acStartedAt: now - 50 * 60_000 } } }).status, "failed");
  assert.equal(evalClimate({ ...base, now: checkInMs - 3 * 3_600_000, climate: { temp: 29, readAt: checkInMs - 3 * 3_600_000 } }).status, "pending", "before the window");
});

test("TV welcome: send → seen = succeeded; TV offline → wake → failed; online but never shown → unconfirmed", () => {
  const now = checkInMs + 3_600_000, base = { booking: b({ status: "checked_in" }), now, today, checkInMs };
  assert.equal(evalTvWelcome({ ...base, tv: null }).status, "skipped");
  assert.equal(evalTvWelcome({ ...base, tv: { lastSeenAt: now, seenAt: null } }).action?.type, "tv_send");
  assert.equal(evalTvWelcome({ ...base, tv: { lastSeenAt: now, seenAt: now }, prev: { status: "pending", detail: "", result: { messageId: 9, sentAt: now } } }).status, "succeeded");
  const off = evalTvWelcome({ ...base, tv: { lastSeenAt: now - 3_600_000, seenAt: null }, prev: { status: "pending", detail: "", result: { messageId: 9, sentAt: now } } });
  assert.equal(off.action?.wake, true);
  assert.equal(evalTvWelcome({ ...base, tv: { lastSeenAt: now - 3_600_000, seenAt: null }, prev: { status: "pending", detail: "", result: { messageId: 9, sentAt: now, wokeAt: now } } }).status, "failed");
  assert.equal(evalTvWelcome({ ...base, tv: { lastSeenAt: now, seenAt: null }, prev: { status: "pending", detail: "", result: { messageId: 9, sentAt: now - 5 * 3_600_000 } } }).status, "unconfirmed");
});

test("orchestrator on the real schema: actions, history, one alert, manual confirmation, automation health", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
    const o = "hotel-corali", now = checkInMs - 3_600_000;
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','double',2,1,1,'dirty')`, [o]);
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,guest_email,guest_language,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna Müller','a@x.de','de',$2,'2026-07-18','confirmed',5,1,0,1)`, [o, today]);
    await db.query(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,checklist_json,inspection_status,due_at,expected_ready_at) VALUES($1,5,'departure_clean','in_progress','{}','pending',1,$2)`, [o, checkInMs + 3_600_000]);
    await db.query(`INSERT INTO room_climate(owner_id,room_id,device_id,temp,read_at,updated_at) VALUES($1,5,'d',29.5,$2,$2)`, [o, now - 60_000]);
    await db.query(`INSERT INTO room_ac_devices(owner_id,room_id,device_id,updated_at) VALUES($1,5,'ac',1)`, [o]);
    await db.query(`INSERT INTO tv_power_settings(owner_id,settings_json,updated_at) VALUES($1,'{"acEnabled":true}',1)`, [o]).catch(async () => db.query(`INSERT INTO tv_power_settings(owner_id,settings_json) VALUES($1,'{"acEnabled":true}')`, [o]));
    await db.query(`INSERT INTO message_deliveries(owner_id,booking_id,event_key,channel,scheduled_at,status,last_error,created_at,updated_at) VALUES($1,1,'checkin','email',1,'failed','SMTP 550',1,1)`, [o]);
    const r1 = await runJourney({ pool, owner: o, now, });
    assert.deepEqual(r1.actions.map((a) => a.action).sort(), ["ac_precondition", "retry_deliveries"]);
    const rows = Object.fromEntries((await db.query<{ step: string; status: string }>(`SELECT step,status FROM journey_actions`)).rows.map((r) => [r.step, r.status]));
    assert.deepEqual(rows, { hk_ready: "failed", msg_instructions: "pending", climate_comfort: "pending" });
    assert.equal((await db.query<{ status: string }>(`SELECT status FROM message_deliveries`)).rows[0].status, "pending", "the failed message was queued again");
    assert.equal((await db.query<{ override_on: number }>(`SELECT override_on FROM room_ac_devices`)).rows[0].override_on, 1, "A/C pre-conditioning");
    const alerts = async () => Number((await db.query<{ n: number }>(`SELECT count(*)::int n FROM pms_notifications WHERE link='/pms/journey'`)).rows[0].n);
    assert.equal(await alerts(), 1, "housekeeping alerted once (room late for check-in)");
    await runJourney({ pool, owner: o, now: now + 6 * 60_000 });
    assert.equal(await alerts(), 1, "no repeated alert while still failing");
    const hk = (await db.query<{ id: number }>(`SELECT id FROM journey_actions WHERE step='hk_ready'`)).rows[0].id;
    await confirmJourneyStep({ pool, owner: o, actionId: hk, userId: 3, userName: "Maria", note: "έλεγχος στο δωμάτιο", now: now + 7 * 60_000 });
    await runJourney({ pool, owner: o, now: now + 20 * 60_000 });
    assert.equal((await db.query<{ status: string }>(`SELECT status FROM journey_actions WHERE id=$1`, [hk])).rows[0].status, "succeeded", "a manual confirmation is kept");
    const history = (await db.query<{ status: string; actor: string }>(`SELECT status,actor FROM journey_events WHERE step='hk_ready' ORDER BY id`)).rows;
    assert.deepEqual(history.map((h) => h.status), ["failed", "succeeded"]);
    assert.equal(history[1].actor, "user:3");
    // Check-in → TV welcome sent, then confirmed when the TV reports it shown.
    await db.query(`UPDATE bookings SET status='checked_in' WHERE id=1`);
    await db.query(`INSERT INTO tv_screens(owner_id,room_id,token,last_seen_at,created_at) VALUES($1,5,'tok',$2,1)`, [o, now + 21 * 60_000]);
    await runJourney({ pool, owner: o, now: now + 22 * 60_000 });
    const msg = (await db.query<{ message_id: number }>(`SELECT message_id FROM tv_message_rooms`)).rows[0];
    assert.ok(msg, "welcome sent to the room TV");
    assert.match(String((await db.query<{ body_json: string }>(`SELECT body_json FROM tv_messages`)).rows[0].body_json), /Willkommen, Anna/);
    await db.query(`UPDATE tv_message_rooms SET seen_at=$1`, [now + 23 * 60_000]);
    await runJourney({ pool, owner: o, now: now + 30 * 60_000, force: true });
    assert.equal((await db.query<{ status: string }>(`SELECT status FROM journey_actions WHERE step='tv_welcome'`)).rows[0].status, "succeeded");
    // Automation health: 3 failures in a row → one notification; success resets.
    for (let i = 0; i < 4; i++) await recordAutomation(pool, o, "Room climate", "failed", "TUYA_TIMEOUT", 120, now + i);
    assert.equal(Number((await db.query<{ n: number }>(`SELECT count(*)::int n FROM pms_notifications WHERE link LIKE '/pms/journey?tab=automations'`)).rows[0].n), 1);
    await recordAutomation(pool, o, "Room climate", "ok", "", 80, now + 10);
    const st = (await db.query<{ consecutive_failures: number; failures: number; last_status: string }>(`SELECT consecutive_failures,failures,last_status FROM automation_status`)).rows[0];
    assert.deepEqual([st.consecutive_failures, Number(st.failures), st.last_status], [0, 4, "ok"]);
    assert.equal(Number((await db.query<{ n: number }>(`SELECT count(*)::int n FROM automation_failures`)).rows[0].n), 4);
  } finally { await db.close(); }
});
