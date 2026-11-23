import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ROOM_READY_SQL, etaOnComplete, etaOnStart, expectedReadyAt, hotelMs, roomReady, roomState, sameDayDeadline, sellableToday } from "../scripts/room-ready-core.mjs";
import { AVAILABILITY_SQL } from "../scripts/channel-core.mjs";
import { eventOn, balanceTemplates } from "../scripts/automation-core.mjs";

test("v186: ready = not dirty / out of order and no open housekeeping task; only today's arrivals are affected", () => {
  assert.equal(roomReady({ operationalStatus: "clean", openTaskStatus: null }), true);
  assert.equal(roomReady({ operationalStatus: "available" }), true);
  for (const t of ["todo", "in_progress", "cleaned", "repaired", "out_of_order"]) assert.equal(roomReady({ operationalStatus: "clean", openTaskStatus: t }), false, t);
  assert.equal(roomReady({ operationalStatus: "dirty" }), false);
  assert.equal(sellableToday({ operationalStatus: "dirty" }, "2026-07-15", "2026-07-15"), false);
  assert.equal(sellableToday({ operationalStatus: "dirty" }, "2026-07-16", "2026-07-15"), true, "a later arrival is sold: it will be cleaned by then");
  assert.equal(sellableToday({ operationalStatus: "dirty" }, "2026-07-15", "2026-07-15", false), true, "switched off");
});

test("v187: three states and the expected ready time", () => {
  assert.equal(roomState({ operationalStatus: "out_of_order" }), "out_of_service");
  assert.equal(roomState({ operationalStatus: "clean", openTasks: [{ status: "out_of_order", expectedReadyAt: null }] }), "out_of_service");
  assert.equal(roomState({ operationalStatus: "dirty", openTasks: [] }), "preparing");
  assert.equal(roomState({ operationalStatus: "clean", openTasks: [] }), "ready");
  const now = hotelMs("2026-07-15", "09:00"), deadline = sameDayDeadline("2026-07-15", "13:00", now);
  assert.equal(deadline, hotelMs("2026-07-15", "13:00"));
  assert.equal(sameDayDeadline("2026-07-15", "13:00", hotelMs("2026-07-15", "18:00")), hotelMs("2026-07-15", "19:00"), "after check-in time: an hour from now");
  const onTime = { operationalStatus: "dirty", openTasks: [{ status: "in_progress", expectedReadyAt: hotelMs("2026-07-15", "12:00") }] };
  const late = { operationalStatus: "dirty", openTasks: [{ status: "in_progress", expectedReadyAt: hotelMs("2026-07-15", "14:00") }] };
  const unknown = { operationalStatus: "dirty", openTasks: [{ status: "todo", expectedReadyAt: null }] };
  assert.equal(sellableToday(onTime, "2026-07-15", "2026-07-15", true, deadline), true, "ready before check-in: sold for today");
  assert.equal(sellableToday(late, "2026-07-15", "2026-07-15", true, deadline), false);
  assert.equal(sellableToday(unknown, "2026-07-15", "2026-07-15", true, deadline), false);
  assert.equal(sellableToday({ operationalStatus: "out_of_order" }, "2026-07-20", "2026-07-15"), false, "out of service: never sold");
  assert.equal(expectedReadyAt({ operationalStatus: "dirty", openTasks: [{ status: "cleaned", expectedReadyAt: 5 }, { status: "todo", expectedReadyAt: 9 }] }), 9);
  assert.equal(etaOnStart("departure_clean", 0), (45 + 30) * 60_000);
  assert.equal(etaOnComplete(0), 30 * 60_000);
});

test("v186: OTA availability and check-in use the same rule on the real schema", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const o = "hotel-corali";
    const today = (await db.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Europe/Athens')::date::text AS d`)).rows[0].d;
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(1,$1,'112','double',2,1,1,'dirty'),(2,$1,'113','double',2,1,1,'clean')`, [o]);
    await db.query(`INSERT INTO channel_room_mappings(owner_id,room_type,external_room_type_id,updated_at) VALUES($1,'double','x',1)`, [o]);
    await db.query(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,checklist_json,inspection_status,due_at) VALUES($1,1,'departure_clean','cleaned','{}','pending',1)`, [o]);
    const free = async () => Object.fromEntries((await db.query<{ date: string; free: number }>(AVAILABILITY_SQL, [o, today, tomorrow, Date.now()])).rows.map((r) => [r.date, Number(r.free)]));
    assert.deepEqual(await free(), { [today]: 1, [tomorrow]: 2 }, "the room waiting for approval is not sold for tonight, but is for tomorrow");
    // v187: an expected ready time before the deadline (check-in time or an hour from now) sells it for tonight.
    await db.query(`UPDATE housekeeping_tasks SET expected_ready_at=$1`, [Date.now() + 30 * 60_000]);
    assert.deepEqual(await free(), { [today]: 2, [tomorrow]: 2 }, "ready in time: sold for tonight");
    await db.query(`UPDATE housekeeping_tasks SET expected_ready_at=$1`, [Date.now() + 30 * 3_600_000]);
    assert.deepEqual(await free(), { [today]: 1, [tomorrow]: 2 }, "too late for tonight");
    await db.query(`UPDATE housekeeping_tasks SET expected_ready_at=NULL`);
    await db.query(`INSERT INTO room_readiness_settings(owner_id,block_same_day,block_checkin,updated_at) VALUES($1,0,1,1)`, [o]);
    assert.deepEqual(await free(), { [today]: 2, [tomorrow]: 2 }, "rule switched off");
    await db.query(`UPDATE room_readiness_settings SET block_same_day=1`);
    await db.query(`UPDATE housekeeping_tasks SET status='ready'`);
    await db.query(`UPDATE rooms SET operational_status='clean' WHERE id=1`);
    assert.deepEqual(await free(), { [today]: 2, [tomorrow]: 2 }, "approved: sold again for tonight");
    const ready = async (id: number) => (await db.query<{ ready: boolean }>(`SELECT ${ROOM_READY_SQL} AS ready FROM rooms r WHERE r.id=$1`, [id])).rows[0].ready;
    assert.equal(await ready(1), true);
    await db.query(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,checklist_json,inspection_status,due_at) VALUES($1,2,'departure_clean','todo','{}','pending',1)`, [o]);
    assert.equal(await ready(2), false);
  } finally { await db.close(); }
});

test("v186: the balance reminder goes out even with scheduled automations off, unless «balance» itself is off", () => {
  assert.equal(eventOn("balance", {}, false), true);
  assert.equal(eventOn("balance", { balance: true }, false), true);
  assert.equal(eventOn("balance", { balance: false }, true), false);
  assert.equal(eventOn("pre_departure", { pre_departure: true }, false), false, "other scheduled messages still need the main switch");
  assert.equal(eventOn("pre_departure", { pre_departure: true }, true), true);
  assert.equal(eventOn("payment_failed", {}, false), true);
  for (const l of ["el", "en", "fr", "de", "it", "es"]) assert.match(balanceTemplates[l].body, /\{\{amount\}\}[\s\S]*\{\{link\}\}/, l);
  const cron = readFileSync("scripts/run-message-automations.mjs", "utf8");
  assert.match(cron, /const bookings=\(scheduledOn\|\|isOn\("balance"\)\)\?/);
  assert.match(cron, /event==="balance"\?\{\.\.\.balanceTemplates\[lang\]/);
});

test("v186: the booking site, the open API, OTA room choice and check-in apply the rule", () => {
  assert.match(readFileSync("lib/public-rate.ts", "utf8"), /sellableForArrival\("\$2","\$7","\$5"\)/);
  assert.match(readFileSync("lib/open-api.ts", "utf8"), /sellableForArrival\("d\.day::date::text", "\$4", "\$5"\)/);
  assert.match(readFileSync("scripts/run-channel-sync.mjs", "utf8"), /ORDER BY \$\{ROOM_READY_SQL\} DESC/);
  const r = readFileSync("app/api/pms/reservations/[id]/route.ts", "utf8");
  assert.match(r, /throw new Error\("ROOM_NOT_READY"\)/);
  assert.match(r, /enqueueAvailability\(client,user\.ownerId,today,today,"room_ready"\)/);
  assert.match(readFileSync("app/api/pms/housekeeping/[id]/route.ts", "utf8"), /else if \(x\.action === "approve"\) \{ const today = hotelToday\(\); await enqueueAvailability\(c, u\.ownerId, today, today, "room_ready"\)/);
});
