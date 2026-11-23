import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { CLOCK_SKEW_MS, confirmEquipment, evaluateTurnover, predictReadiness, turnoverBoard, verifyTurnover } from "../scripts/turnover-core.mjs";
import { measuredOutcome, resolutionCases, resolutionState, rootCauses } from "../scripts/root-cause-core.mjs";
import { comfortBoard } from "../scripts/comfort-core.mjs";
import { checkReliability } from "../scripts/reliability-core.mjs";
import { clearDataUnavailable } from "../scripts/data-availability.mjs";

const o = "hotel-corali", MIN = 60_000, H = 3_600_000;
type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount: number }>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query: Q = async (sql, params = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  let chain: Promise<void> = Promise.resolve();
  const connect = async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => { release = r; }); await prev; return { query, release }; };
  return { db, pool: { query, connect }, query };
}
/** A pool whose reads of one table fail — to prove a failed read is never taken as «nothing there». */
const failing = (query: Q, table: RegExp) => ({ query: (sql: string, p?: unknown[]) => (table.test(sql) ? Promise.reject(Object.assign(new Error("relation is locked"), { code: "55P03" })) : query(sql, p)) });

const base = (out: number, tasks: Row[], extra: Row = {}) => ({ bookingId: 11, checkoutAt: out, hkTasks: tasks, faults: [], equipment: null, hasTv: false, wifi: null, cards: [], ...extra });

test("v196 P1: inspection/completion time in the future or not a real time is rejected (documented 2′ clock skew only)", () => {
  const out = Date.parse("2026-07-15T08:00:00Z"), now = out + 3 * H;
  const ev = (t: Row) => evaluateTurnover(base(out, [{ id: 1, bookingId: 11, status: "ready", inspection: "approved", ...t }]), now).steps.cleaning;
  assert.equal(CLOCK_SKEW_MS, 2 * MIN);
  // The reported case: approved with inspectedAt one hour ahead of now.
  const future = ev({ completedAt: out + H, inspectedAt: now + H });
  assert.equal(future.state, "failed");
  assert.match(future.detail, /χρόνος επιθεώρησης στο μέλλον/);
  assert.match(ev({ completedAt: now + 30 * MIN, inspectedAt: now + 31 * MIN }).detail, /χρόνος ολοκλήρωσης στο μέλλον/);
  assert.equal(ev({ completedAt: out + H, inspectedAt: now + MIN }).state, "done", "within the documented skew");
  assert.equal(ev({ completedAt: out + H, inspectedAt: now + CLOCK_SKEW_MS + 1 }).state, "failed", "just beyond the skew");
  for (const bad of ["abc", Infinity, -5, Number.NaN]) assert.match(ev({ completedAt: out + H, inspectedAt: bad }).detail, /μη έγκυρος χρόνος επιθεώρησης|χωρίς χρόνο επιθεώρησης/, String(bad));
  assert.match(ev({ completedAt: "2026-07-15", inspectedAt: out + 2 * H }).detail, /μη έγκυρος χρόνος ολοκλήρωσης/);
});

test("v196 P1: the evidence must be complete before the next guest checked in — also for a task bound to the booking", () => {
  const out = Date.parse("2026-07-15T08:00:00Z"), nextIn = out + 4 * H, now = out + 6 * H;
  const ev = (t: Row) => evaluateTurnover(base(out, [{ id: 1, bookingId: 11, status: "ready", inspection: "approved", ...t }], { nextCheckinAt: nextIn }), now).steps.cleaning;
  // The reported case: bookingId set, cleaned and approved after the next guest was already in the room.
  const late = ev({ completedAt: nextIn + H, inspectedAt: nextIn + 90 * MIN });
  assert.equal(late.state, "failed");
  assert.match(late.detail, /εγκρίθηκε αφού είχε ήδη μπει ο επόμενος πελάτης/);
  assert.equal(ev({ completedAt: out + H, inspectedAt: nextIn + MIN }).state, "failed", "inspection after the arrival");
  assert.equal(ev({ completedAt: out + H, inspectedAt: nextIn - MIN }).state, "done", "everything before the arrival");
});

test("v196 P2: several tasks — a task opened after the approval reopens the room; an inconsistent duplicate does not hide the valid clean", () => {
  const out = Date.parse("2026-07-15T08:00:00Z"), now = out + 8 * H;
  const ok = { id: 1, bookingId: 11, status: "ready", inspection: "approved", createdAt: out, completedAt: out + H, inspectedAt: out + 2 * H };
  const ev = (...more: Row[]) => evaluateTurnover(base(out, [ok, ...more]), now).steps.cleaning;
  // Re-clean opened after the approval (a problem found): needs its own approval.
  const reopened = ev({ id: 2, bookingId: 11, status: "todo", inspection: "pending", createdAt: out + 3 * H });
  assert.equal(reopened.state, "pending");
  assert.match(reopened.detail, /νέα εργασία #2 μετά την έγκριση της #1 — χρειάζεται νέα έγκριση/);
  assert.equal(reopened.taskId, 2);
  const reopenedApproved = ev({ id: 2, bookingId: 11, status: "ready", inspection: "approved", createdAt: out + 3 * H, completedAt: out + 4 * H, inspectedAt: out + 5 * H });
  assert.deepEqual([reopenedApproved.state, reopenedApproved.taskId], ["done", 2], "the newer approval is the evidence");
  assert.equal(ev({ id: 2, bookingId: 11, status: "ready", inspection: "rejected", createdAt: out + 3 * H, notes: "λεκέδες" }).state, "failed");
  // A duplicate record created BEFORE the approval with broken times: the valid clean stays the evidence; history kept.
  const dup = ev({ id: 2, bookingId: 11, status: "ready", inspection: "approved", createdAt: out + 30 * MIN, completedAt: null, inspectedAt: out + 2 * H });
  assert.equal(dup.state, "done");
  assert.equal(dup.taskId, 1);
  assert.match(dup.detail, /1 νεότερη\(ες\) εγγραφή\(ές\) με ασυνεπή στοιχεία στο ιστορικό/);
  assert.deepEqual(dup.history!.map((h: { taskId: number; state: string }) => [h.taskId, h.state]), [[1, "done"], [2, "failed"]]);
  // Unknown opening time (rows older than v196): treated as reopened work — the safe side.
  assert.equal(ev({ id: 2, bookingId: 11, status: "todo", inspection: "pending", createdAt: null }).state, "pending");
  // The newest task being an open re-clean is not «inconsistent data»: pending, not failed.
  assert.doesNotMatch(reopened.detail, /ασυνεπή/);
});

test("v196 predictive readiness: queue, own history, risk against the arrival", () => {
  const now = Date.parse("2026-07-15T09:00:00Z");
  const history = Array.from({ length: 6 }, (_, i) => ({ startedAt: now - (i + 2) * H, completedAt: now - (i + 2) * H + 30 * MIN, inspectedAt: now - (i + 2) * H + 40 * MIN }));
  const queued = predictReadiness({ now, cleaning: "pending", task: { status: "todo" }, queueAhead: 2, history, arrivalAt: now + 3 * H });
  assert.deepEqual([queued.cleanMin, queued.inspectMin, queued.basis], [30, 10, "history"]);
  assert.equal(queued.minutesLeft, 2 * 30 + 30 + 10);
  assert.equal(queued.risk, "on_time");
  const late = predictReadiness({ now, cleaning: "pending", task: { status: "todo" }, queueAhead: 4, history, arrivalAt: now + H });
  assert.equal(late.risk, "late");
  assert.ok(late.spareMinutes! < 0);
  const inProgress = predictReadiness({ now, cleaning: "pending", task: { status: "in_progress", startedAt: now - 20 * MIN }, history, arrivalAt: now + 25 * MIN });
  assert.equal(inProgress.minutesLeft, 10 + 10);
  assert.equal(inProgress.risk, "tight");
  const noData = predictReadiness({ now, cleaning: "pending", task: null, history: [], arrivalAt: null });
  assert.deepEqual([noData.basis, noData.risk, noData.minutesLeft], ["defaults", "unknown", 65]);
  assert.equal(predictReadiness({ now, cleaning: "done", otherPending: 1, history }).minutesLeft, 15);
});

test("v196 P2: a source that cannot be read is DATA_UNAVAILABLE — never n/a, blocks the confirmation, reported in the Reliability Center", async () => {
  const { db, pool, query } = await fresh();
  clearDataUnavailable();
  const errors: string[] = []; const orig = console.error; console.error = (m: unknown) => { errors.push(String(m)); };
  try {
    const now = Date.now(), out = now - 3 * H;
    await query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    await query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_out_at) VALUES(7,$1,'CR-7','A','2026-07-10','2026-07-14','checked_out',5,1,0,1,$2)`, [o, out]);
    await query(`INSERT INTO housekeeping_tasks(id,owner_id,room_id,task_type,status,booking_id,created_at,completed_at,inspection_status,inspected_at) VALUES(70,$1,5,'departure_clean','ready',7,$2,$3,'approved',$4)`, [o, out, out + H, out + 2 * H]);
    await query(`INSERT INTO guest_wifi(owner_id,booking_id,room_id,status,created_at) VALUES($1,7,5,'active',$2)`, [o, out - 86_400_000]).catch(() => undefined);
    await confirmEquipment({ pool, owner: o, bookingId: 7, roomId: 5, by: "N", now });
    const broken = { ...failing(query, /FROM guest_wifi/), connect: async () => { const c = await pool.connect(); return { ...c, query: failing(c.query, /FROM guest_wifi/).query }; } };
    const b = await turnoverBoard({ pool: broken, owner: o, now, bookingIds: [7] });
    const t = b.turnovers[0];
    assert.equal(t.steps.wifi.state, "unavailable", "not «δεν δόθηκε κωδικός»");
    assert.equal(t.steps.wifi.code, "DATA_UNAVAILABLE");
    assert.equal(t.status, "data_unavailable");
    assert.equal(t.current.state, "not_ready");
    assert.deepEqual(b.dataUnavailable!.map((d) => [d.area, d.source, d.cause]), [["turnover", "wifi", "55P03"]]);
    assert.ok(errors.some((e) => /"event":"data_unavailable".*"source":"wifi"/.test(e)), "structured log line");
    const v = await verifyTurnover({ pool: broken, owner: o, bookingId: 7, by: "M", now });
    assert.equal(v.ok, false);
    assert.match(v.blocking!.join(" "), /DATA_UNAVAILABLE/);
    const r = await checkReliability({ pool: broken, owner: o, now });
    const item = r.areas.find((a: { key: string }) => a.key === "turnover")!.items.find((i: { key: string }) => i.key === "data-unavailable:turnover:wifi");
    assert.ok(item, "Reliability Center item");
    assert.equal(item.level, "fail");
    // The same board with the source readable again: the step is evaluated normally.
    assert.notEqual((await turnoverBoard({ pool, owner: o, now, bookingIds: [7] })).turnovers[0].steps.wifi.state, "unavailable");
    // Comfort: a failed read is «άγνωστο (DATA_UNAVAILABLE)», not a perfect score.
    await query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(9,$1,'CR-9','C','2026-07-14','2026-07-18','checked_in',5,1,0,1)`, [o]);
    const c = await comfortBoard({ pool: failing(query, /FROM maintenance_notices/), owner: o, now });
    assert.equal(c.rooms[0].complete, false);
    assert.ok(c.rooms[0].unknown.some((u) => u.key === "data:faults" && /DATA_UNAVAILABLE/.test(u.detail)));
    assert.equal(c.dataUnavailable[0].source, "faults");
    const r2 = await checkReliability({ pool, owner: o, now });
    assert.ok(r2.areas.find((a: { key: string }) => a.key === "integrations")!.items.some((i: { key: string }) => i.key === "data-unavailable:comfort:faults"), "other screens' read failures reach the Reliability Center");
  } finally { console.error = orig; clearDataUnavailable(); await db.close(); }
});

test("v196 P2: repair follow-up with unreadable evidence is DATA_UNAVAILABLE, not «no recurrence»; analysis says it is incomplete", async () => {
  const { db, query } = await fresh();
  const orig = console.error; console.error = () => undefined;
  try {
    const now = Date.now();
    await query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    await query(`INSERT INTO maintenance_notices(id,owner_id,room_id,severity,description,reported_at,status,resolved_at,resolution_notes) VALUES(30,$1,5,'major','[Ανάλυση αιτιών] κλιματιστικό',$2,'resolved',$3,'αλλαγή αισθητήρα')`, [o, now - 20 * 86_400_000, now - 10 * 86_400_000]);
    await query(`INSERT INTO resolution_cases(owner_id,finding_key,room_id,category,title,maintenance_id,opened_at) VALUES($1,'room:5:ac',5,'ac','Κλιματιστικό 112',30,$2)`, [o, now - 20 * 86_400_000]);
    const seen: unknown[] = [];
    const cases = await resolutionCases({ pool: failing(query, /FROM tv_requests/), owner: o, now, onUnavailable: (u) => seen.push(u) });
    assert.equal(cases[0].state, "DATA_UNAVAILABLE");
    assert.equal(seen.length, 1);
    const all = await rootCauses({ pool: failing(query, /FROM review_requests/), owner: o, now });
    assert.equal(all.complete, false);
    assert.deepEqual(all.dataUnavailable.map((d) => d.source), ["ratings"]);
    const casesFail = await resolutionCases({ pool: failing(query, /FROM resolution_cases/), owner: o, now, onUnavailable: (u) => seen.push(u) });
    assert.deepEqual(casesFail, []);
    assert.equal(seen.length, 2, "the cases query failure is reported, not silent");
  } finally { console.error = orig; clearDataUnavailable(); await db.close(); }
});

test("v196 outcome verification: measured recovery vs absence of complaints", async () => {
  const resolvedAt = Date.parse("2026-07-10T10:00:00Z"), now = resolvedAt + 5 * 86_400_000, range = { min: 22, max: 26 };
  const r = (temp: number, h: number, occupied = true, acOn: boolean | null = true) => ({ temp, occupied, acOn, readAt: resolvedAt + h * H });
  const hourly = (temps: number[], acOn: boolean | null = true) => temps.map((t, i) => r(t, i + 1, true, acOn));
  assert.equal(measuredOutcome({ category: "wifi", resolvedAt, range, now }).state, "NOT_MEASURABLE");
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: [r(24, 1), r(24, 2)] }).state, "NO_MEASUREMENTS");
  // v197: 6 independent readings over ≥ 6 hours with the A/C confirmed on.
  const ok = measuredOutcome({ category: "ac", resolvedAt, range, now, readings: hourly([24, 25, 26.5, 23, 24, 25, 24]) });
  assert.deepEqual([ok.state, ok.readings, ok.spanHours], ["MEASURED_RECOVERED", 7, 6]);
  const hot = measuredOutcome({ category: "ac", resolvedAt, range, now, readings: hourly([29.5, 30, 24, 29, 30, 31, 29]) });
  assert.equal(hot.state, "MEASURED_NOT_RECOVERED");
  assert.match(hot.detail, /1\/7 ανεξάρτητες μετρήσεις/);
  // The reported case: near-simultaneous readings are ONE independent reading — no proof.
  const burst = Array.from({ length: 12 }, (_, i) => ({ temp: 24, occupied: true, acOn: true, readAt: resolvedAt + H + i * 60_000 }));
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: burst }).state, "NO_MEASUREMENTS");
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: burst }).readings, 1);
  // 6 readings but within 3 hours: not a stay's worth of observation.
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: [0, 0.5, 1, 1.5, 2, 2.5, 3].map((h) => r(24, 1 + h)) }).state, "NO_MEASUREMENTS");
  // A/C state unknown (no relay): never decides, in either direction.
  const unk = measuredOutcome({ category: "ac", resolvedAt, range, now, readings: hourly([24, 24, 24, 24, 24, 24, 24], null) });
  assert.deepEqual([unk.state, unk.readings, unk.unknownAcReadings], ["INCONCLUSIVE_AC_UNKNOWN", 0, 7]);
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: hourly([31, 31, 31, 31, 31, 31, 31], null) }).state, "INCONCLUSIVE_AC_UNKNOWN");
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: hourly([31, 31, 31, 31, 31, 31, 31], false) }).state, "NO_MEASUREMENTS", "A/C off: ignored");
  assert.equal(resolutionState({ resolvedAt, eventsAfter: 0, staysAfter: 0, measured: unk }).state, "MONITORING");
  // Unoccupied rooms, readings before the repair, or in the future are not evidence.
  assert.equal(measuredOutcome({ category: "ac", resolvedAt, range, now, readings: [r(24, 1, false), r(24, -2), r(24, 200)] }).state, "NO_MEASUREMENTS");
  // The resolution state: measurement outranks «no complaints».
  assert.equal(resolutionState({ resolvedAt, eventsAfter: 0, staysAfter: 3, measured: hot }).state, "MEASURED_NOT_RECOVERED");
  assert.equal(resolutionState({ resolvedAt, eventsAfter: 0, staysAfter: 3, measured: null }).state, "NO_RECURRENCE_OBSERVED");
  assert.match(resolutionState({ resolvedAt, eventsAfter: 0, staysAfter: 3, measured: null }).detail, /απουσία παραπόνων, όχι μέτρηση/);
  assert.equal(resolutionState({ resolvedAt, eventsAfter: 0, staysAfter: 0, measured: { state: "MEASURED_RECOVERED", detail: "x" } }).state, "MEASURED_RECOVERY");
  assert.equal(resolutionState({ resolvedAt, eventsAfter: 1, staysAfter: 0, measured: { state: "MEASURED_RECOVERED", detail: "x" } }).state, "RECURRED");

  // From the database: the climate worker's history decides.
  const { db, query, pool } = await fresh();
  try {
    const t0 = Date.now();
    await query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'clean')`, [o]);
    await query(`INSERT INTO maintenance_notices(id,owner_id,room_id,severity,description,reported_at,status,resolved_at,resolution_notes) VALUES(30,$1,5,'major','[Ανάλυση αιτιών] κλιματιστικό',$2,'resolved',$3,'καθαρισμός στοιχείου')`, [o, t0 - 3 * 86_400_000, t0 - 2 * 86_400_000]);
    await query(`INSERT INTO resolution_cases(owner_id,finding_key,room_id,category,title,maintenance_id,opened_at) VALUES($1,'room:5:ac',5,'ac','Κλιματιστικό 112',30,$2)`, [o, t0 - 3 * 86_400_000]);
    await query(`INSERT INTO comfort_policies(owner_id,settings_json,updated_by,updated_at) VALUES($1,$2,'x',1)`, [o, JSON.stringify({ rooms: { 5: { min: 22, max: 26 } } })]);
    for (const [temp, h] of [[24, 1], [25, 2], [23.5, 3], [26, 4], [24, 5], [24.5, 6], [25, 7]]) await query(`INSERT INTO climate_readings(owner_id,room_id,temp,occupied,ac_on,read_at) VALUES($1,5,$2,1,1,$3)`, [o, temp, t0 - 2 * 86_400_000 + h * H]);
    const c = (await resolutionCases({ pool, owner: o, now: t0 }))[0];
    assert.equal(c.measured.state, "MEASURED_RECOVERED");
    assert.equal(c.state, "MEASURED_RECOVERY", "measured, but still awaiting the technician");
  } finally { await db.close(); }
});

test("v196 end-to-end: check-out → cleaning → inspection → next arrival, with concurrent changes", async () => {
  const { db, pool, query } = await fresh();
  try {
    const now = Date.now(), out = now - 5 * H;
    await query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(5,$1,'112','d',2,1,1,'dirty'),(6,$1,'113','d',2,1,1,'dirty')`, [o]);
    // 1) Check-out: the departure clean is created bound to the booking (as the check-out route does).
    await query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_out_at) VALUES(1,$1,'CR-1','A','2026-07-10','2026-07-14','checked_out',5,1,0,1,$2),(3,$1,'CR-3','C','2026-07-10','2026-07-14','checked_out',6,1,0,1,$2)`, [o, out]);
    await query(`INSERT INTO housekeeping_tasks(id,owner_id,room_id,task_type,status,booking_id,created_at,inspection_status) VALUES(10,$1,5,'departure_clean','todo',1,$2,'pending'),(30,$1,6,'departure_clean','todo',3,$2,'pending')`, [o, out]);
    let t = (await turnoverBoard({ pool, owner: o, now, bookingIds: [1] })).turnovers[0];
    assert.equal(t.steps.cleaning.state, "pending");
    // 2) Cleaning finished, 3) inspection approved — both before any arrival.
    await query(`UPDATE housekeeping_tasks SET status='ready',started_at=$2,completed_at=$3,inspection_status='approved',inspected_at=$4 WHERE id=10 AND owner_id=$1`, [o, out + 30 * MIN, out + H, out + 90 * MIN]);
    await confirmEquipment({ pool, owner: o, bookingId: 1, roomId: 5, by: "N", now });
    t = (await turnoverBoard({ pool, owner: o, now, bookingIds: [1] })).turnovers[0];
    assert.equal(t.status, "ready");
    // Concurrent: the confirmation races a serious fault being opened. Either the fault lands first (blocked) or the
    // confirmation lands first and the room then shows «verified but NOT ready now» — never stored as ready with the fault.
    const [v] = await Promise.all([
      verifyTurnover({ pool, owner: o, bookingId: 1, by: "M", now }),
      query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,5,'major','Σπασμένο παράθυρο',$2)`, [o, now]),
    ]);
    t = (await turnoverBoard({ pool, owner: o, now, bookingIds: [1] })).turnovers[0];
    if (v.ok) { assert.equal(t.status, "verified"); assert.equal(t.regressed, true); assert.equal(t.current.state, "not_ready"); }
    else assert.match(v.blocking!.join(" "), /Σπασμένο παράθυρο/);
    // Two confirmations at once for the same turnover: one record.
    await query(`UPDATE maintenance_notices SET status='resolved',resolved_at=$2,resolution_notes='αντικαταστάθηκε' WHERE owner_id=$1`, [o, now]);
    const both = await Promise.all([verifyTurnover({ pool, owner: o, bookingId: 1, by: "M1", now }), verifyTurnover({ pool, owner: o, bookingId: 1, by: "M2", now })]);
    assert.ok(both.every((x) => x.ok));
    assert.equal((await query(`SELECT count(*)::int n FROM room_turnovers WHERE owner_id=$1 AND booking_id=1 AND status='verified'`, [o])).rows[0].n, 1);
    // 4) Room 113: the next guest arrived BEFORE the inspection; the late approval is not valid evidence.
    await query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_in_at) VALUES(4,$1,'CR-4','D','2026-07-14','2026-07-16','checked_in',6,1,0,1,$2)`, [o, out + 2 * H]);
    await query(`UPDATE housekeeping_tasks SET status='ready',completed_at=$2,inspection_status='approved',inspected_at=$3 WHERE id=30 AND owner_id=$1`, [o, out + 3 * H, out + 4 * H]);
    const t3 = (await turnoverBoard({ pool, owner: o, now, bookingIds: [3] })).turnovers[0];
    assert.equal(t3.steps.cleaning.state, "failed");
    assert.match(t3.steps.cleaning.detail, /επόμενος πελάτης/);
    assert.equal(t3.current.state, "occupied");
    await confirmEquipment({ pool, owner: o, bookingId: 3, roomId: 6, by: "N", now });
    assert.equal((await verifyTurnover({ pool, owner: o, bookingId: 3, by: "M", now })).ok, false, "never certified after the fact");
    // A re-clean opened after an approval reopens the room (room 112, booking 1 already verified → regressed).
    await query(`INSERT INTO housekeeping_tasks(id,owner_id,room_id,task_type,status,booking_id,created_at,inspection_status) VALUES(11,$1,5,'departure_clean','todo',1,$2,'pending')`, [o, now - MIN]);
    t = (await turnoverBoard({ pool, owner: o, now, bookingIds: [1] })).turnovers[0];
    assert.equal(t.steps.cleaning.state, "pending");
    assert.match(t.steps.cleaning.detail, /νέα εργασία #11/);
    assert.equal(t.regressed, true);
  } finally { await db.close(); }
});

test("v197 P2: task order follows real time (created_at), never the id — the reported case: valid #11, newer pending #10", () => {
  const out = Date.parse("2026-07-15T08:00:00Z"), now = out + 8 * H;
  const valid11 = { id: 11, bookingId: 11, status: "ready", inspection: "approved", createdAt: out, completedAt: out + H, inspectedAt: out + 2 * H };
  const ev = (...tasks: Row[]) => evaluateTurnover(base(out, tasks), now).steps.cleaning;
  const pending10 = { id: 10, bookingId: 11, status: "todo", inspection: "pending", createdAt: out + 3 * H };
  const c = ev(valid11, pending10);
  assert.equal(c.state, "pending", "#10 was opened after #11's approval: the room is reopened");
  assert.match(c.detail, /νέα εργασία #10 μετά την έγκριση της #11/);
  assert.deepEqual(c.history!.map((h: { taskId: number }) => h.taskId), [11, 10], "history in time order");
  // Same ids, but #10 opened BEFORE the approval with broken data: a remark, the valid clean stands.
  const dup10 = { id: 10, bookingId: 11, status: "ready", inspection: "approved", createdAt: out + 30 * MIN, completedAt: null, inspectedAt: out + 2 * H };
  assert.deepEqual([ev(valid11, dup10).state, ev(valid11, dup10).taskId], ["done", 11]);
  // Two valid cleans with inverted ids: the one approved last is the evidence.
  const later9 = { id: 9, bookingId: 11, status: "ready", inspection: "approved", createdAt: out + 3 * H, completedAt: out + 4 * H, inspectedAt: out + 5 * H };
  assert.equal(ev(valid11, later9).taskId, 9);
  // No created_at (pre-v196 rows): placed by its other real times — started after the approval → reopened.
  assert.equal(ev(valid11, { id: 10, bookingId: 11, status: "in_progress", inspection: "pending", createdAt: null, startedAt: out + 3 * H }).state, "pending");
  assert.equal(ev(valid11, { id: 12, bookingId: 11, status: "ready", inspection: "approved", createdAt: null, completedAt: null, startedAt: out + 20 * MIN, inspectedAt: out + 90 * MIN }).state, "done", "provably earlier: a remark");
});
