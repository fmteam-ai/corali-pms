import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { comfortBoard, scoreRoom } from "../scripts/comfort-core.mjs";
import { confirmEquipment, evaluateTurnover, turnoverBoard, verifyTurnover } from "../scripts/turnover-core.mjs";
import { actOnFinding, categorize, findRootCauses, rootCauses } from "../scripts/root-cause-core.mjs";

const o = "hotel-corali", MIN = 60_000, H = 3_600_000;
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
  return { db, pool };
}

test("v193 comfort score: conditions the hotel controls, with evidence; unknown is said, never guessed", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const good = scoreRoom({ climate: { temp: 23, humidity: 50, readAt: now - 10 * MIN }, requests: [], orders: [], faults: [], tv: { lastSeenAt: now - MIN }, wifiUsed: true, wifi: { status: "active" } }, now);
  assert.deepEqual([good.score, good.level, good.signals.length, good.unknown.length], [100, "ok", 0, 0]);
  const bad = scoreRoom({
    climate: { temp: 29.5, humidity: 75, readAt: now - 5 * MIN },
    requests: [{ id: 1, kind: "problem", problem: "ac", createdAt: now - 3 * H, label: "Πρόβλημα: Κλιματιστικό" }],
    orders: [], faults: [], tv: { lastSeenAt: now - 2 * H }, wifiUsed: true, wifi: { status: "failed", error: "Omada 500" },
  }, now);
  assert.equal(bad.level, "act");
  assert.deepEqual(bad.signals.map((s) => s.key), ["req:1", "temp", "wifi", "humidity", "tv"]);
  assert.match(bad.signals[0].detail, /Κλιματιστικό — ανοιχτό εδώ και 3 ώρ/);
  const stale = scoreRoom({ climate: { temp: 35, humidity: 40, readAt: now - 5 * H }, requests: [], tv: null, wifiUsed: false }, now);
  assert.equal(stale.score, 100, "an old reading is not used as a fact");
  assert.match(stale.unknown[0].detail, /τελευταία μέτρηση πριν/);
  assert.match(scoreRoom({ climate: null, requests: [], wifiUsed: false }, now).unknown[0].detail, /χωρίς αισθητήρα/);
});

test("v193 comfort board: occupied rooms only, worst first, from the live records", async () => {
  const { db, pool } = await fresh();
  try {
    const now = Date.now();
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(1,$1,'101','d',2,1,1,'clean'),(2,$1,'102','d',2,1,1,'clean'),(3,$1,'103','d',2,1,1,'clean')`, [o]);
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna Pappa','2026-07-14','2026-07-18','checked_in',1,1,0,1),(2,$1,'CR-2','Ben Ray','2026-07-14','2026-07-18','checked_in',2,1,0,1),(3,$1,'CR-3','Cleo','2026-07-20','2026-07-22','confirmed',3,1,0,1)`, [o]);
    await db.query(`INSERT INTO room_climate(owner_id,room_id,device_id,temp,humidity,read_at,updated_at) VALUES($1,2,'s',27.5,55,$2,$2)`, [o, now - 5 * MIN]);
    await db.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,2,2,'towels','open',$2,NULL)`, [o, now - 40 * MIN]);
    await db.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,2,'major','Δεν κρυώνει το κλιματιστικό',$2)`, [o, now - H]);
    const b = await comfortBoard({ pool, owner: o, now });
    assert.deepEqual(b.rooms.map((r) => r.code), ["102", "101"], "only occupied rooms, worst first");
    assert.equal(b.rooms[0].guest, "Ben", "first name only");
    assert.deepEqual(b.rooms[0].signals.map((s) => s.key).sort(), ["fault:1", "req:1", "temp"].sort());
    assert.equal(b.rooms[1].score, 100);
    assert.equal(b.summary.rooms, 2);
  } finally { await db.close(); }
});

test("v193 verified turnover: every step from its own record; confirmation only when all applicable steps are done", async () => {
  const { db, pool } = await fresh();
  try {
    const now = Date.now(), out = now - 2 * H;
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_out_at) VALUES(7,$1,'CR-7','Dora','2026-07-10','2026-07-15','checked_out',5,1,0,1,$2)`, [o, out]);
    await db.query(`INSERT INTO tv_screens(id,owner_id,room_id,token,created_at) VALUES(9,$1,5,'tok',1)`, [o]);
    await db.query(`INSERT INTO guest_wifi(owner_id,booking_id,room_id,psk_name,status,created_at) VALUES($1,7,5,'p','active',1)`, [o]);
    let t = (await turnoverBoard({ pool, owner: o, now })).turnovers[0];
    assert.equal(t.status, "failed", "two hours after check-out: Wi-Fi still active and no TV clearing → failed");
    assert.deepEqual(Object.fromEntries(Object.entries(t.steps).map(([k, v]) => [k, (v as { state: string }).state])), { cleaning: "pending", equipment: "pending", tv: "failed", wifi: "failed", access: "na" });
    let v = await verifyTurnover({ pool, owner: o, bookingId: 7, by: "Maria", now });
    assert.equal(v.ok, false);
    assert.equal(v.blocking!.length, 4);
    // The evidence arrives, step by step.
    await db.query(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,completed_at,inspection_status,inspected_at) VALUES($1,5,'departure_clean','ready',$2,'approved',$3)`, [o, out + 30 * MIN, out + 50 * MIN]);
    await db.query(`UPDATE guest_wifi SET status='removed',removed_at=$1`, [out + 5 * MIN]);
    await db.query(`INSERT INTO tv_privacy_jobs(owner_id,booking_id,room_id,tv_screen_id,checkout_at_ms,status,created_at_ms,staff_checked_at_ms) VALUES($1,7,5,9,$2,'CLEARED_LOCAL_NEEDS_REVIEW',$2,NULL)`, [o, out]);
    t = (await turnoverBoard({ pool, owner: o, now })).turnovers[0];
    assert.equal((t.steps.tv as { state: string }).state, "pending", "cleared but not checked by staff");
    await db.query(`UPDATE tv_privacy_jobs SET staff_checked_at_ms=$1`, [now - MIN]);
    await confirmEquipment({ pool, owner: o, bookingId: 7, roomId: 5, by: "Nikos", note: "τηλεχειριστήριο OK", now });
    t = (await turnoverBoard({ pool, owner: o, now })).turnovers[0];
    assert.equal(t.status, "ready");
    v = await verifyTurnover({ pool, owner: o, bookingId: 7, by: "Maria", now });
    assert.equal(v.ok, true);
    const rec = (await db.query<Row>(`SELECT status,verified_by,steps_json FROM room_turnovers WHERE booking_id=7`)).rows[0];
    assert.equal(rec.status, "verified");
    assert.match(String(rec.steps_json), /τηλεχειριστήριο OK/, "the documented result keeps the evidence");
    // A serious open fault blocks the equipment step.
    assert.equal(evaluateTurnover({ checkoutAt: out, hkTasks: [], faults: [{ severity: "major", description: "σπασμένο ντουλάπι" }], equipment: { ok: true, by: "x", at: now }, hasTv: false, wifi: null, cards: [] }, now).steps.equipment.state, "failed");
  } finally { await db.close(); }
});

test("v193 root causes: recurring room problem with rating association, shared cause, sample thresholds, action", async () => {
  const day = 86_400_000, now = Date.parse("2026-07-15T12:00:00Z");
  const ev = (roomId: number, code: string, bookingId: number, category: string, d: number) => ({ roomId, code, bookingId, category, at: now - d * day, source: "tv" });
  const events = [ev(5, "112", 1, "ac", 30), ev(5, "112", 2, "ac", 20), ev(5, "112", 2, "ac", 19), ev(5, "112", 3, "ac", 5), ev(6, "113", 4, "ac", 3), ...[7, 8, 9, 10].map((r) => ev(r, String(100 + r), 10 + r, "wifi", 2))];
  const ratings = [{ bookingId: 1, roomId: 5, code: "112", rating: 3 }, { bookingId: 2, roomId: 5, code: "112", rating: 3 }, { bookingId: 3, roomId: 5, code: "112", rating: 4 }, ...[20, 21, 22, 23, 24, 25].map((b) => ({ bookingId: b, roomId: 50, code: "150", rating: 5 }))];
  const f = findRootCauses({ events, ratings });
  const room = f.find((x) => x.key === "room:5:ac")!;
  assert.match(room.title, /Δωμάτιο 112: «Κλιματιστικό» 4 φορές σε 3 διαφορετικές διαμονές/);
  assert.match(room.evidence.join(" "), /3\.3\/5 .* έναντι 4\.4\/5 .* συσχέτιση, όχι απόδειξη/);
  assert.match(room.suggestion, /τεχνικός έλεγχος της μονάδας κλιματισμού/);
  assert.equal(room.severity, "high");
  assert.ok(!f.some((x) => x.key === "room:6:ac"), "one report is not a pattern");
  assert.ok(f.some((x) => x.key === "systemic:wifi"), "the same problem in 4 rooms: shared cause");
  assert.equal(categorize("Το A/C δεν κρυώνει"), "ac");
  assert.equal(categorize("Στάζει η βρύση"), "water_leak");
  assert.equal(categorize("Χαλασμένη κλειδαριά"), "door_lock");

  const { db, pool } = await fresh();
  try {
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    for (const [id, ci] of [[1, "2026-06-01"], [2, "2026-06-20"], [3, "2026-07-08"]] as const) await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES($2,$1,$3,'G',$4,$4,'checked_out',5,1,0,1)`, [o, id, `CR-${id}`, ci]);
    for (const b of [1, 2, 3]) await db.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,5,$2,'problem','done',$3,'{"problem":"ac"}')`, [o, b, now - (40 - b * 10) * day]);
    const r = await rootCauses({ pool, owner: o, now });
    const finding = r.findings.find((x) => x.key === "room:5:ac")!;
    assert.ok(finding);
    const a = await actOnFinding({ pool, owner: o, key: finding.key, action: "maintenance", userId: 1, now });
    assert.equal(a.ok, true);
    assert.match(String((await db.query<Row>(`SELECT description FROM maintenance_notices WHERE id=$1`, [a.maintenanceId])).rows[0].description), /\[Ανάλυση αιτιών\] Δωμάτιο 112/);
    assert.equal((await actOnFinding({ pool, owner: o, key: finding.key, action: "maintenance", userId: 1, now })).already, true, "only one task per finding");
    assert.equal((await rootCauses({ pool, owner: o, now })).findings.find((x) => x.key === "room:5:ac")!.action!.status, "maintenance");
  } finally { await db.close(); }
});
