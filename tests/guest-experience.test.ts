import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { comfortBoard, normalizePolicy, rangeFor, saveComfortPolicy, scoreRoom } from "../scripts/comfort-core.mjs";
import { confirmEquipment, evaluateTurnover, turnoverBoard, verifyTurnover } from "../scripts/turnover-core.mjs";
import { actOnFinding, categorize, confirmRepair, findRootCauses, meaningfulReason, resolutionCases, resolutionState, rootCauses } from "../scripts/root-cause-core.mjs";

const o = "hotel-corali", MIN = 60_000, H = 3_600_000;
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  // One PGlite connection: transactions from connect() run one after another (separate PostgreSQL connections would
  // be serialised the same way by the row / advisory locks).
  let chain: Promise<void> = Promise.resolve();
  const connect = async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => { release = r; }); await prev; return { query, release }; };
  const pool = { query, connect };
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

test("v194 comfort: NULL / invalid / future readings are unknown, never 0 °C; seasonal and per-room limits", () => {
  const now = Date.parse("2026-07-15T12:00:00Z"), winter = Date.parse("2026-01-15T12:00:00Z");
  for (const temp of [null, undefined, "", "abc"]) {
    const r = scoreRoom({ roomId: 1, climate: { temp, humidity: null, readAt: now - MIN }, requests: [], wifiUsed: false }, now);
    assert.equal(r.score, 100, `temp=${String(temp)} must not count as 0 °C`);
    assert.match(r.unknown.map((u) => u.detail).join(" "), /δεν έχει έγκυρη θερμοκρασία/);
  }
  const future = scoreRoom({ roomId: 1, climate: { temp: 35, humidity: 50, readAt: now + 3 * H }, requests: [], wifiUsed: false }, now);
  assert.equal(future.score, 100);
  assert.match(future.unknown[0].detail, /μελλοντική ώρα/);
  const p = normalizePolicy({ cooling: { min: 23, max: 26 }, heating: { min: 20, max: 23 }, heatingMonths: [12, 1, 2], rooms: { "7": { min: 24, max: 27 } }, hardMargin: 1.5, humidMax: 65, staleMinutes: 60 });
  assert.deepEqual([rangeFor(p, 1, now).source, rangeFor(p, 1, winter).source, rangeFor(p, 7, winter).source], ["cooling", "heating", "room"]);
  assert.equal(scoreRoom({ roomId: 1, climate: { temp: 22.5, readAt: now - MIN }, requests: [], wifiUsed: false }, now, p).signals[0].penalty, 15, "summer: 22.5 below the cooling range");
  assert.equal(scoreRoom({ roomId: 1, climate: { temp: 22.5, readAt: winter - MIN }, requests: [], wifiUsed: false }, winter, p).score, 100, "winter: inside the heating range");
  assert.equal(scoreRoom({ roomId: 7, climate: { temp: 26.5, readAt: now - MIN }, requests: [], wifiUsed: false }, now, p).score, 100, "room 7 has its own limits");
  assert.match(scoreRoom({ roomId: 1, climate: { temp: 23, readAt: now - 2 * H }, requests: [], wifiUsed: false }, now, p).unknown[0].detail, /τελευταία μέτρηση/, "older than the policy's 60′");
  // Invalid policy values fall back to the defaults.
  const bad = normalizePolicy({ cooling: { min: 30, max: 20 }, humidMax: 5, heatingMonths: [0, 13, 2] });
  assert.deepEqual([bad.cooling, bad.humidMax, bad.heatingMonths], [{ min: 22, max: 26 }, 70, [2]]);
});

test("v194 turnover: a later stay's clean never proves an earlier departure; evidence used once; current vs verified readiness", async () => {
  const { db, pool } = await fresh();
  try {
    const now = Date.now(), out1 = now - 30 * H, in2 = now - 26 * H, out2 = now - 3 * H;
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    // Stay A left (out1), stay B arrived (in2) and left (out2). Only B's departure was cleaned and approved.
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_in_at,checked_out_at) VALUES(1,$1,'CR-A','A','2026-07-10','2026-07-14','checked_out',5,1,0,1,1,$2),(2,$1,'CR-B','B','2026-07-14','2026-07-15','checked_out',5,1,0,1,$3,$4)`, [o, out1, in2, out2]);
    await db.query(`INSERT INTO housekeeping_tasks(id,owner_id,room_id,task_type,status,booking_id,completed_at,inspection_status,inspected_at) VALUES(50,$1,5,'departure_clean','ready',2,$2,'approved',$3)`, [o, out2 + H, out2 + 2 * H]);
    let b = await turnoverBoard({ pool, owner: o, now, days: 3 });
    const A = b.turnovers.find((t) => t.bookingId === 1)!, B = b.turnovers.find((t) => t.bookingId === 2)!;
    assert.equal(A.steps.cleaning.state, "pending", "B's clean is not evidence for A's departure");
    assert.equal(B.steps.cleaning.state, "done");
    assert.equal(B.steps.cleaning.taskId, 50);
    // An unbound (older) task done after A left but before B arrived counts for A only.
    await db.query(`INSERT INTO housekeeping_tasks(id,owner_id,room_id,task_type,status,completed_at,inspection_status,inspected_at) VALUES(40,$1,5,'departure_clean','ready',$2,'approved',$2)`, [o, out1 + H]);
    b = await turnoverBoard({ pool, owner: o, now, days: 3 });
    assert.equal(b.turnovers.find((t) => t.bookingId === 1)!.steps.cleaning.taskId, 40);
    assert.equal(b.turnovers.find((t) => t.bookingId === 2)!.steps.cleaning.taskId, 50);
    // Verify B (transaction); the same cleaning can never be stored as evidence for another turnover.
    await confirmEquipment({ pool, owner: o, bookingId: 2, roomId: 5, by: "Nikos", now });
    const v = await verifyTurnover({ pool, owner: o, bookingId: 2, by: "Maria", now });
    assert.equal(v.ok, true);
    await assert.rejects(db.query(`INSERT INTO room_turnovers(owner_id,booking_id,room_id,status,hk_task_id,created_at,updated_at) VALUES($1,1,5,'verified',50,1,1)`, [o]), /duplicate key|unique/i);
    assert.equal((await verifyTurnover({ pool, owner: o, bookingId: 2, by: "Maria", now })).already, true);
    // A serious fault after the confirmation: still VERIFIED_AT, but NOT ready now (dynamic readiness).
    await db.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,5,'major','Διαρροή νερού στο μπάνιο',$2)`, [o, now]);
    b = await turnoverBoard({ pool, owner: o, now, days: 3 });
    const B2 = b.turnovers.find((t) => t.bookingId === 2)!;
    assert.equal(B2.status, "verified");
    assert.ok(B2.verifiedAt);
    assert.equal(B2.current.state, "not_ready");
    assert.equal(B2.regressed, true);
    assert.match(B2.current.detail, /Διαρροή νερού/);
    assert.equal(B2.verifiedSteps!.equipment.state, "done", "the stored evidence is kept as it was");
  } finally { await db.close(); }
});

test("v194 root cause actions: two clicks → one task; a dismissal needs a real reason; did the fix work?", async () => {
  const { db, pool } = await fresh();
  try {
    const day = 86_400_000, now = Date.now();
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    for (const id of [1, 2, 3]) await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES($2,$1,$3,'G','2026-06-01','2026-06-02','checked_out',5,1,0,1)`, [o, id, `CR-${id}`]);
    for (const b of [1, 2, 3]) await db.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,5,$2,'problem','done',$3,'{"problem":"ac"}')`, [o, b, now - (50 - b * 10) * day]);
    const key = "room:5:ac";
    const [a, b] = await Promise.all([actOnFinding({ pool, owner: o, key, action: "maintenance", userId: 1, now }), actOnFinding({ pool, owner: o, key, action: "maintenance", userId: 2, now })]);
    assert.equal(Number((await db.query<{ n: number }>(`SELECT count(*)::int n FROM maintenance_notices`)).rows[0].n), 1, "one task for one finding");
    assert.deepEqual([a.ok, b.ok], [true, true]);
    assert.equal([a.already, b.already].filter(Boolean).length, 1);
    assert.equal((await actOnFinding({ pool, owner: o, key: "systemic:wifi", action: "dismiss", reason: "ok", now })).error, "REASON_REQUIRED");
    assert.equal(meaningfulReason("........................"), false);
    assert.equal(meaningfulReason("Αλλάχτηκε ήδη η μονάδα τον Ιούνιο"), true);
    // v195 resolution: a lasting case, followed on its own; no stronger claim than the evidence.
    let f = (await rootCauses({ pool, owner: o, now })).findings.find((x) => x.key === key)!;
    assert.equal(f.action!.resolution!.state, "OPEN_TASK");
    const mid = f.action!.maintenanceId!, caseId = f.action!.caseId!;
    assert.equal((await confirmRepair({ pool, owner: o, caseId, by: "Tech", note: "Δοκιμή ψύξης 30′ OK, νέα φίλτρα" })).error, "NOT_RESOLVED_OR_CONFIRMED", "no confirmation before the repair is done");
    const fixedAt = now - 20 * day;
    await db.query(`UPDATE maintenance_notices SET status='resolved',resolved_at=$2,resolved_by=1,resolution_notes='αλλαγή φίλτρων',post_repair_state='clean' WHERE id=$1`, [mid, fixedAt]);
    f = (await rootCauses({ pool, owner: o, now })).findings.find((x) => x.key === key)!;
    assert.equal(f.action!.resolution!.state, "MONITORING");
    // A stay that began BEFORE the repair does not count, even though it ended after it.
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_in_at,checked_out_at) VALUES(9,$1,'CR-9','G','2026-06-20','2026-06-28','checked_out',5,1,0,1,$2,$3)`, [o, fixedAt - 3 * day, fixedAt + 2 * day]);
    for (const id of [10, 11]) await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_in_at,checked_out_at) VALUES($2,$1,$3,'G','2026-07-01','2026-07-02','checked_out',5,1,0,1,$4,$5)`, [o, id, `CR-${id}`, fixedAt + (id - 7) * day, fixedAt + (id - 6) * day]);
    let c = (await rootCauses({ pool, owner: o, now })).cases.find((x) => x.id === caseId)!;
    assert.equal(c.state, "NO_RECURRENCE_OBSERVED", "no complaints after 2 stays is NOT proof of a fix");
    assert.match(c.detail, /δεν αποδεικνύει τη διόρθωση/);
    // The case stays even when the finding is no longer detected (the old reports leave the window).
    await db.query(`DELETE FROM tv_requests`);
    const r2 = await rootCauses({ pool, owner: o, now });
    assert.equal(r2.findings.find((x) => x.key === key), undefined);
    assert.equal(r2.cases.find((x) => x.id === caseId)!.state, "NO_RECURRENCE_OBSERVED");
    // Technician confirmation → EFFECTIVE_CONFIRMED; a later report → RECURRED.
    assert.equal((await confirmRepair({ pool, owner: o, caseId, by: "Tech", note: "ok" })).error, "NOTE_REQUIRED");
    assert.equal((await confirmRepair({ pool, owner: o, caseId, by: "Tech", note: "Δοκιμή ψύξης 30′ OK, νέα φίλτρα" })).ok, true);
    c = (await resolutionCases({ pool, owner: o, now })).find((x) => x.id === caseId)!;
    assert.deepEqual([c.state, c.confirmedBy], ["EFFECTIVE_CONFIRMED", "Tech"]);
    await db.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,5,11,'problem','open',$2,'{"problem":"ac"}')`, [o, now - day]);
    c = (await resolutionCases({ pool, owner: o, now })).find((x) => x.id === caseId)!;
    assert.equal(c.state, "RECURRED");
    assert.equal(resolutionState({ resolvedAt: null, eventsAfter: 0, staysAfter: 0 }).state, "OPEN_TASK");
    const saved = await saveComfortPolicy({ pool, owner: o, settings: { cooling: { min: 23, max: 25 } }, by: "Maria" });
    assert.deepEqual(saved.cooling, { min: 23, max: 25 });
    assert.deepEqual((await comfortBoard({ pool, owner: o })).policy.cooling, { min: 23, max: 25 });
  } finally { await db.close(); }
});

test("v195 cleaning evidence must be consistent: finished after the check-out, inspected after finishing", () => {
  const out = Date.parse("2026-07-15T10:00:00Z"), now = out + 5 * H;
  const ev = (t: Record<string, unknown>) => evaluateTurnover({ bookingId: 11, checkoutAt: out, hkTasks: [{ id: 1, bookingId: 11, ...t }], faults: [], equipment: null, hasTv: false, wifi: null, cards: [] }, now).steps.cleaning;
  // The reported case: approved, no completion time, inspected before the check-out.
  const bad = ev({ status: "ready", inspection: "approved", completedAt: null, inspectedAt: out - H });
  assert.equal(bad.state, "failed");
  assert.match(bad.detail, /ασυνεπή στοιχεία — χωρίς χρόνο ολοκλήρωσης/);
  assert.match(ev({ status: "ready", inspection: "approved", completedAt: out - 10 * 60_000, inspectedAt: out + H }).detail, /πριν από το check-out/);
  assert.match(ev({ status: "ready", inspection: "approved", completedAt: out + H, inspectedAt: out + 30 * 60_000 }).detail, /επιθεώρηση καταγράφηκε πριν από την ολοκλήρωση/);
  assert.match(ev({ status: "cleaned", inspection: "approved", completedAt: out + H, inspectedAt: out + 2 * H }).detail, /δεν έχει ολοκληρωθεί/);
  assert.equal(ev({ status: "ready", inspection: "approved", completedAt: out + H, inspectedAt: out + 2 * H }).state, "done");
});

test("v195 verification fetches the booking itself (older than any dashboard window); readiness vs next arrival", async () => {
  const { db, pool } = await fresh();
  try {
    const now = Date.now(), out = now - 45 * 86_400_000;
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_out_at) VALUES(7,$1,'CR-OLD','Old','2026-01-01','2026-01-05','checked_out',5,1,0,1,$2)`, [o, out]);
    await db.query(`INSERT INTO housekeeping_tasks(id,owner_id,room_id,task_type,status,booking_id,completed_at,inspection_status,inspected_at) VALUES(70,$1,5,'departure_clean','ready',7,$2,'approved',$3)`, [o, out + 3_600_000, out + 7_200_000]);
    await confirmEquipment({ pool, owner: o, bookingId: 7, roomId: 5, by: "N", now });
    assert.equal((await turnoverBoard({ pool, owner: o, now })).turnovers.length, 0, "not in the 3-day dashboard");
    assert.equal((await verifyTurnover({ pool, owner: o, bookingId: 7, by: "M", now })).ok, true, "but verifiable by its id");
    // Next arrival in 90 minutes (pre-check-in time) and a serious fault: not ready, urgent.
    const arrive = new Date(now + 90 * 60_000), athens = (o2: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", ...o2 }).format(arrive);
    const date = athens({ year: "numeric", month: "2-digit", day: "2-digit" }), time = athens({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(8,$1,'CR-NEXT','Next',$2,$2,'confirmed',5,1,0,1)`, [o, date]);
    await db.query(`INSERT INTO guest_checkins(owner_id,booking_id,first_name,last_name,email,phone,arrival_time,document_number,status,created_at) VALUES($1,8,'N','X','n@x.gr','1',$2,'A1','submitted',1)`, [o, time]).catch(async () => { /* columns differ: fall back to hotel check-in time */ });
    await db.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,5,'major','Δεν ανάβει το κλιματιστικό',$2)`, [o, now]);
    const t = (await turnoverBoard({ pool, owner: o, now, bookingIds: [7] })).turnovers[0];
    assert.equal(t.current.state, "not_ready");
    assert.equal(t.current.nextReference, "CR-NEXT");
    assert.ok(t.current.minutesToArrival !== null);
    // A minor fault is a remark, not a reason to block the room.
    await db.query(`UPDATE maintenance_notices SET severity='minor'`);
    assert.equal((await turnoverBoard({ pool, owner: o, now, bookingIds: [7] })).turnovers[0].current.state, "ready_with_remarks");
  } finally { await db.close(); }
});

test("v195 comfort sensor validity is separate from room temperature and setpoint", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const r = (climate: Record<string, unknown>) => scoreRoom({ roomId: 1, climate, requests: [], wifiUsed: false }, now);
  assert.deepEqual([r({ temp: 85, humidity: 40, readAt: now - MIN }).sensor.state, r({ temp: 85, humidity: 40, readAt: now - MIN }).score], ["invalid", 100], "85°C is a broken sensor, not a hot room");
  assert.equal(r({ temp: 24, humidity: 140, readAt: now - MIN }).sensor.state, "invalid");
  const low = r({ temp: 24, humidity: 50, battery: 8, readAt: now - MIN });
  assert.deepEqual([low.sensor.state, low.roomTemp], ["low_battery", 24]);
  const sp = r({ temp: 24, humidity: 50, readAt: now - MIN, setpoint: 16 });
  assert.deepEqual([sp.roomTemp, sp.setpoint, sp.signals.map((s) => s.key)], [24, 16, ["setpoint"]]);
});
