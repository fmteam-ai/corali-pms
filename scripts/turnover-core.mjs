// v193 Verified Room Turnover: after each check-out, one final confirmation that the room is really ready for the
// next guest — every step proven from its own record, never assumed:
//   cleaning    — a housekeeping task for the room finished after the check-out and approved at inspection;
//   equipment   — a person confirmed the equipment check (and no serious fault is open for the room);
//   tv          — the guest's accounts were cleared from the room TV (privacy job confirmed by staff);
//   wifi        — the guest's Wi-Fi password was removed from the network;
//   access      — the guest's access cards were revoked or have expired.
// A step that does not apply (no TV in the room, Wi-Fi not used) is «n/a». «Επιβεβαίωση» is possible only when every
// applicable step is done; it stores the documented result (each step's evidence and time) and who confirmed it.
import { DEFAULT_CHECKIN_TIME, hotelMs } from "./room-ready-core.mjs";
import { reportDataUnavailable } from "./data-availability.mjs";

/** Tolerance between the clocks that time the evidence (PMS server, staff devices): 2 minutes. */
export const CLOCK_SKEW_MS = 2 * 60_000;
const HOUR = 3_600_000, HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const STEPS = [
  { key: "cleaning", el: "Καθαρισμός & επιθεώρηση" },
  { key: "equipment", el: "Έλεγχος εξοπλισμού" },
  { key: "tv", el: "Αποσύνδεση λογαριασμών TV" },
  { key: "wifi", el: "Ανάκληση Wi-Fi" },
  { key: "access", el: "Ανάκληση καρτών πρόσβασης" },
];

const TV_FAILED = new Set(["FAILED", "PARTIAL", "BLOCKED_SECURITY", "BLOCKED_UNREGISTERED", "UNVERIFIED"]);

/** Pure: the state of each step from the facts of one check-out. */
export function evaluateTurnover(f, now = Date.now()) {
  const out = {};
  const at = Number(f.checkoutAt);
  // Cleaning (v194): only a clean that belongs to THIS departure — a task carrying this booking, or (older tasks
  // without a booking) one started/finished between this check-out and the next guest's check-in — and that no other
  // turnover has already used as its evidence.
  const until = f.nextCheckinAt ? Number(f.nextCheckinAt) : Infinity, used = new Set((f.usedTaskIds ?? []).map(Number));
  const mine = (f.hkTasks ?? []).filter((t) => !used.has(Number(t.id)) && (
    (t.bookingId !== null && t.bookingId !== undefined && Number(t.bookingId) === Number(f.bookingId)) ||
    ((t.bookingId === null || t.bookingId === undefined) && [t.completedAt, t.startedAt].some((x) => x && Number(x) >= at - 5 * 60_000 && Number(x) < until))
  ));
  // v196/v197: every candidate task is judged on its own evidence, and one rule decides — by REAL TIME, never by id
  // (ids do not follow time after imports, restores or unusual write sequences):
  //  • valid evidence = status «ready», finished after this check-out, inspected (approved) after finishing — and both
  //    times real (finite), not in the future (tolerance CLOCK_SKEW_MS) and BEFORE the next guest checked in; when
  //    several are valid, the one approved last is the evidence;
  //  • any other task OPENED (created_at) at or after that approval reopens the room: it needs its own approval;
  //  • a task with no known opening time (rows older than v196) is placed by its other times and, failing those, by id
  //    — and, unknown, is treated as reopened work when it is not provably earlier (the safe side);
  //  • a task opened before the approval (a duplicate / inconsistent record) never hides the valid one — it is a remark
  //    in the history.
  const ts = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : NaN);
  const judge = (t) => {
    const done = ts(t.completedAt), inspected = ts(t.inspectedAt);
    if (t.inspection === "rejected") return { ok: false, state: "failed", why: `απορρίφθηκε στην επιθεώρηση${t.notes ? `: ${String(t.notes).slice(0, 80)}` : ""}` };
    if (t.inspection !== "approved") return { ok: false, state: "pending", why: done ? "καθαρίστηκε — αναμένει επιθεώρηση" : "σε εξέλιξη" };
    const problem = t.status !== "ready" ? `η εργασία δεν έχει ολοκληρωθεί (κατάσταση «${t.status}»)`
      : done === null ? "χωρίς χρόνο ολοκλήρωσης" : Number.isNaN(done) ? "μη έγκυρος χρόνος ολοκλήρωσης"
      : done < at ? "ολοκληρώθηκε πριν από το check-out"
      : done > now + CLOCK_SKEW_MS ? "χρόνος ολοκλήρωσης στο μέλλον"
      : inspected === null ? "χωρίς χρόνο επιθεώρησης" : Number.isNaN(inspected) ? "μη έγκυρος χρόνος επιθεώρησης"
      : inspected < done ? "η επιθεώρηση καταγράφηκε πριν από την ολοκλήρωση"
      : inspected > now + CLOCK_SKEW_MS ? "χρόνος επιθεώρησης στο μέλλον"
      : inspected >= until ? "εγκρίθηκε αφού είχε ήδη μπει ο επόμενος πελάτης" : null;
    return problem ? { ok: false, state: "failed", why: `ασυνεπή στοιχεία — ${problem}`, inconsistent: true } : { ok: true, state: "done", inspected };
  };
  const real = (v) => { const x = ts(v); return x === null || Number.isNaN(x) ? null : x; };
  // When the task appeared: its opening time, else the earliest of its other real times (null = unknown).
  const openedAt = (t) => real(t.createdAt) ?? ([t.startedAt, t.completedAt, t.inspectedAt].map(real).filter((x) => x !== null).sort((x, y) => x - y)[0] ?? null);
  const chrono = (a, b) => { const x = openedAt(a.t), y = openedAt(b.t); return x !== null && y !== null && x !== y ? x - y : Number(a.t.id) - Number(b.t.id); };
  const ordered = mine.map((t) => ({ t, j: judge(t) })).sort(chrono);
  const valid = ordered.filter((x) => x.j.ok).sort((a, b) => a.j.inspected - b.j.inspected || chrono(a, b)).at(-1) ?? null;
  const others = valid ? ordered.filter((x) => x !== valid) : ordered;
  const isReopening = (x) => {
    const c = real(x.t.createdAt);
    if (c !== null) return c >= valid.j.inspected;
    const o = openedAt(x.t);
    return o !== null ? o >= valid.j.inspected : Number(x.t.id) > Number(valid.t.id);
  };
  const reopened = valid ? others.filter(isReopening) : others;
  const history = ordered.map((x) => ({ taskId: Number(x.t.id), state: x.j.state, detail: x.j.why ?? "έγκυρο τεκμήριο", openedAt: openedAt(x.t) }));
  const decider = reopened.length ? reopened[reopened.length - 1] : valid;
  if (!decider) out.cleaning = { state: "pending", detail: "δεν υπάρχει καθαρισμός για αυτή την αναχώρηση", history };
  else if (decider === valid) {
    const ignored = others.filter((x) => !x.j.ok && chrono(x, valid) > 0);
    out.cleaning = { state: "done", detail: `εργασία #${valid.t.id} ολοκληρώθηκε και εγκρίθηκε στην επιθεώρηση${ignored.length ? ` · ${ignored.length} νεότερη(ες) εγγραφή(ές) με ασυνεπή στοιχεία στο ιστορικό` : ""}`, at: valid.j.inspected, taskId: Number(valid.t.id), history };
  } else {
    const prefix = valid ? `νέα εργασία #${decider.t.id} μετά την έγκριση της #${valid.t.id} — χρειάζεται νέα έγκριση: ` : `εργασία #${decider.t.id}: `;
    out.cleaning = { state: decider.j.state, detail: `${prefix}${decider.j.why}${decider.j.inconsistent ? "· χρειάζεται νέος καθαρισμός / επιθεώρηση" : ""}`, taskId: Number(decider.t.id), history };
  }
  // Equipment: a person's confirmation; a serious open fault blocks it.
  const serious = (f.faults ?? []).filter((m) => m.severity !== "minor"), minor = (f.faults ?? []).filter((m) => m.severity === "minor");
  if (serious.length) out.equipment = { state: "failed", detail: `ανοιχτή ${serious[0].severity === "out_of_order" ? "βλάβη εκτός λειτουργίας" : "σοβαρή βλάβη"}: ${String(serious[0].description).slice(0, 80)}`, severity: serious[0].severity };
  else if (f.equipment?.ok) out.equipment = { state: "done", detail: `επιβεβαίωσε ${f.equipment.by}${f.equipment.note ? ` — ${f.equipment.note}` : ""}${minor.length ? ` · ${minor.length} μικρή(ές) βλάβη(ες) ανοιχτή(ές): ${String(minor[0].description).slice(0, 60)}` : ""}`, at: Number(f.equipment.at), remarks: minor.length };
  else out.equipment = { state: "pending", detail: "χρειάζεται επιβεβαίωση από το προσωπικό" };
  // TV accounts.
  if (!f.hasTv) out.tv = { state: "na", detail: "χωρίς Corali TV στο δωμάτιο" };
  else if (!f.tvJob) out.tv = { state: now - at > HOUR ? "failed" : "pending", detail: "δεν έχει ξεκινήσει καθαρισμός λογαριασμών" };
  else if (f.tvJob.status === "CLEARED_LOCAL_NEEDS_REVIEW" && f.tvJob.staffCheckedAt) out.tv = { state: "done", detail: "καθαρίστηκε και ελέγχθηκε από το προσωπικό", at: Number(f.tvJob.staffCheckedAt) };
  else if (f.tvJob.status === "CLEARED_LOCAL_NEEDS_REVIEW") out.tv = { state: "pending", detail: "καθαρίστηκε — χρειάζεται έλεγχος από το προσωπικό" };
  else if (TV_FAILED.has(f.tvJob.status)) out.tv = { state: "failed", detail: `${f.tvJob.status}${f.tvJob.error ? ` · ${f.tvJob.error}` : ""}` };
  else out.tv = { state: "pending", detail: f.tvJob.status };
  // Wi-Fi.
  if (!f.wifi) out.wifi = { state: "na", detail: "δεν δόθηκε κωδικός Wi-Fi" };
  else if (f.wifi.status === "removed") out.wifi = { state: "done", detail: "ο κωδικός αφαιρέθηκε", at: Number(f.wifi.removedAt ?? 0) || undefined };
  else if (f.wifi.status === "failed") out.wifi = { state: "failed", detail: `η αφαίρεση απέτυχε: ${String(f.wifi.error ?? "").slice(0, 80)}` };
  else out.wifi = { state: now - at > HOUR ? "failed" : "pending", detail: "ο κωδικός είναι ακόμη ενεργός" };
  // Access cards.
  const cards = f.cards ?? [];
  const live = cards.filter((c) => c.status === "active" && Number(c.validUntil) > now);
  if (!cards.length) out.access = { state: "na", detail: "χωρίς κάρτες πρόσβασης" };
  else if (live.length) out.access = { state: now - at > HOUR ? "failed" : "pending", detail: `${live.length} κάρτα(ες) ακόμη ενεργή(ές)` };
  else out.access = { state: "done", detail: "όλες οι κάρτες ανακλήθηκαν ή έληξαν" };
  // v196: a step whose source could not be read is DATA_UNAVAILABLE — never «n/a», never «done».
  const missingSteps = { faults: "equipment", tv: "tv", wifi: "wifi", access: "access" };
  for (const src of f.unavailable ?? []) {
    const k = missingSteps[src];
    if (k) out[k] = { state: "unavailable", code: "DATA_UNAVAILABLE", detail: "τα στοιχεία δεν μπόρεσαν να διαβαστούν (DATA_UNAVAILABLE) — δεν θεωρείται ότι δεν ισχύει" };
  }
  const applicable = STEPS.filter((s) => out[s.key].state !== "na");
  const status = applicable.some((s) => out[s.key].state === "failed") ? "failed" : applicable.some((s) => out[s.key].state === "unavailable") ? "data_unavailable" : applicable.every((s) => out[s.key].state === "done") ? "ready" : "pending";
  return { steps: out, status };
}

/**
 * v196 Predictive Room Readiness (pure): when the room will likely be ready, from what is left of its cleaning and the
 * hotel's own history — the median cleaning time (start → finish) and inspection lag (finish → approval) of the last 30
 * days (defaults 45′ / 20′ when there are fewer than 5 samples), and the housekeeper's queue: tasks of the same
 * housekeeper opened before this one and still unfinished each take one median cleaning first. Steps other than the
 * cleaning that are still pending add a fixed allowance (15′ each). Result: predictedReadyAt, and against the arrival
 * on_time (≥ 30′ to spare) | tight | late | unknown — «late» is the warning before the room is overdue.
 */
export const FORECAST_DEFAULTS = { cleanMin: 45, inspectMin: 20, otherStepMin: 15, minSamples: 5, spareMin: 30 };
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
export function predictReadiness({ now, cleaning, task = null, queueAhead = 0, history = [], otherPending = 0, arrivalAt = null }) {
  const D = FORECAST_DEFAULTS, MINUTE = 60_000;
  const cleans = history.map((h) => (Number(h.completedAt) - Number(h.startedAt)) / MINUTE).filter((m) => Number.isFinite(m) && m > 0 && m < 8 * 60);
  const lags = history.map((h) => (Number(h.inspectedAt) - Number(h.completedAt)) / MINUTE).filter((m) => Number.isFinite(m) && m >= 0 && m < 8 * 60);
  const cleanMin = cleans.length >= D.minSamples ? median(cleans) : D.cleanMin, inspectMin = lags.length >= D.minSamples ? median(lags) : D.inspectMin;
  const basis = cleans.length >= D.minSamples && lags.length >= D.minSamples ? "history" : "defaults";
  let left; let stage;
  if (cleaning === "done") { left = 0; stage = "καθαρισμός εγκρίθηκε"; }
  else if (cleaning === "failed") { left = queueAhead * cleanMin + cleanMin + inspectMin; stage = "χρειάζεται νέος καθαρισμός"; }
  else if (!task) { left = queueAhead * cleanMin + cleanMin + inspectMin; stage = "δεν έχει ανοίξει εργασία καθαρισμού"; }
  else if (task.status === "ready" || task.completedAt) { left = inspectMin; stage = "αναμένει επιθεώρηση"; }
  else if (task.startedAt && Number.isFinite(Number(task.startedAt))) { const spent = Math.max(0, (now - Number(task.startedAt)) / MINUTE); left = Math.max(5, cleanMin - spent) + inspectMin; stage = "καθαρισμός σε εξέλιξη"; }
  else { left = queueAhead * cleanMin + cleanMin + inspectMin; stage = queueAhead ? `${queueAhead} εργασία(ες) πριν από αυτή στην ουρά` : "σε αναμονή καθαρισμού"; }
  left += otherPending * D.otherStepMin;
  const predictedReadyAt = Math.round(now + left * MINUTE);
  const spare = arrivalAt === null ? null : Math.round((arrivalAt - predictedReadyAt) / MINUTE);
  const risk = spare === null ? "unknown" : spare >= D.spareMin ? "on_time" : spare >= 0 ? "tight" : "late";
  return { predictedReadyAt, minutesLeft: Math.round(left), spareMinutes: spare, risk, stage, basis, cleanMin: Math.round(cleanMin), inspectMin: Math.round(inspectMin) };
}

/**
 * Check-outs of the last `days` days. v194: two separate facts per check-out — `verified` (the documented confirmation:
 * when, by whom, the evidence snapshot) and `current` (the room's readiness evaluated NOW: a serious fault opened or
 * an inspection rejected after the confirmation makes it not ready again; a next guest already in the room = occupied).
 */
export async function turnoverBoard({ pool, owner, now = Date.now(), days = 3, bookingIds: only = null }) {
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  const since = now - days * 86_400_000;
  // v195: a specific check-out (the final confirmation) is fetched by its booking id, never searched in a recent list.
  const outs = only
    ? await q(`SELECT b.id booking_id,b.reference,b.guest_name,b.room_id,r.code,COALESCE(b.checked_out_at,0) checked_out_at FROM bookings b JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.status='checked_out' AND b.id=ANY($2::bigint[])`, [owner, only.map(Number)])
    : await q(`SELECT b.id booking_id,b.reference,b.guest_name,b.room_id,r.code,COALESCE(b.checked_out_at,0) checked_out_at FROM bookings b JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.status='checked_out' AND b.checked_out_at>=$2 ORDER BY b.checked_out_at DESC LIMIT 100`, [owner, since]);
  if (!outs.length) return { at: now, turnovers: [] };
  const roomIds = [...new Set(outs.map((o) => Number(o.room_id)))], bookingIds = outs.map((o) => Number(o.booking_id));
  // v196: a source that cannot be read is never taken as «nothing there» (no TV, no Wi-Fi, no fault): the step it
  // proves becomes DATA_UNAVAILABLE (blocks the confirmation) and the failure is logged and reported.
  const unavailable = new Map();
  const soft = (source, sql, p) => q(sql, p).catch((e) => { unavailable.set(source, reportDataUnavailable("turnover", source, e)); return null; });
  const [hk, faults, tvs, jobs, wifi, cards, saved, next, checkins, usedRows] = await Promise.all([
    q(`SELECT id,room_id,booking_id,status,assigned_to,created_at,completed_at,started_at,inspection_status,inspected_at,inspection_notes FROM housekeeping_tasks WHERE owner_id=$1 AND room_id=ANY($2::bigint[]) AND (booking_id=ANY($4::bigint[]) OR completed_at>=$3 OR started_at>=$3 OR due_at>=$3)`, [owner, roomIds, since - 86_400_000, bookingIds]),
    soft("faults", `SELECT room_id,severity,description,reported_at FROM maintenance_notices WHERE owner_id=$1 AND status='open' AND room_id=ANY($2::bigint[])`, [owner, roomIds]),
    soft("tv", `SELECT room_id FROM tv_screens WHERE owner_id=$1 AND active=1 AND room_id=ANY($2::bigint[])`, [owner, roomIds]),
    soft("tv", `SELECT booking_id,room_id,status,error_code,staff_checked_at_ms FROM tv_privacy_jobs WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]),
    soft("wifi", `SELECT booking_id,status,error,removed_at FROM guest_wifi WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]),
    soft("access", `SELECT booking_id,status,valid_until FROM access_cards WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]),
    q(`SELECT * FROM room_turnovers WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]),
    q(`SELECT DISTINCT ON (b.room_id) b.room_id,b.id,b.reference,b.check_in next_in,(SELECT g.arrival_time FROM guest_checkins g WHERE g.owner_id=b.owner_id AND g.booking_id=b.id ORDER BY g.id DESC LIMIT 1) arrival_time FROM bookings b WHERE b.owner_id=$1 AND b.status='confirmed' AND b.room_id=ANY($2::bigint[]) ORDER BY b.room_id,b.check_in`, [owner, roomIds]),
    q(`SELECT room_id,checked_in_at,status FROM bookings WHERE owner_id=$1 AND room_id=ANY($2::bigint[]) AND checked_in_at IS NOT NULL`, [owner, roomIds]),
    q(`SELECT booking_id,hk_task_id FROM room_turnovers WHERE owner_id=$1 AND hk_task_id IS NOT NULL`, [owner]),
  ]);
  // v196 forecast inputs: the last 30 days of approved cleanings (durations) and every unfinished task (queues).
  const [history, openTasks] = await Promise.all([
    soft("forecast", `SELECT started_at,completed_at,inspected_at FROM housekeeping_tasks WHERE owner_id=$1 AND inspection_status='approved' AND started_at IS NOT NULL AND completed_at>=$2 ORDER BY completed_at DESC LIMIT 500`, [owner, now - 30 * 86_400_000]),
    soft("forecast", `SELECT id,room_id,assigned_to,status FROM housekeeping_tasks WHERE owner_id=$1 AND status NOT IN ('ready','done','cancelled') AND task_type<>'maintenance'`, [owner]),
  ]);
  const forecastHistory = (history ?? []).map((h) => ({ startedAt: Number(h.started_at), completedAt: Number(h.completed_at), inspectedAt: Number(h.inspected_at) }));
  const missing = { faults: faults === null, tv: tvs === null || jobs === null, wifi: wifi === null, access: cards === null };
  const checkInTime = await q(`SELECT settings_json FROM tv_settings WHERE owner_id=$1`, [owner]).then((r) => { try { const t = JSON.parse(String(r[0]?.settings_json ?? "{}")).checkInTime; return HHMM.test(String(t ?? "")) ? String(t) : DEFAULT_CHECKIN_TIME; } catch { return DEFAULT_CHECKIN_TIME; } }, () => DEFAULT_CHECKIN_TIME);
  const turnovers = outs.map((o) => {
    const bid = Number(o.booking_id), rid = Number(o.room_id), out = Number(o.checked_out_at);
    const rec = saved.find((x) => Number(x.booking_id) === bid);
    const nextIn = checkins.filter((c) => Number(c.room_id) === rid && Number(c.checked_in_at) > out).map((c) => Number(c.checked_in_at)).sort((a, b) => a - b)[0] ?? null;
    const occupied = checkins.some((c) => Number(c.room_id) === rid && c.status === "checked_in" && Number(c.checked_in_at) > out);
    const equipment = rec?.equipment_at ? { ok: true, by: rec.equipment_by, note: rec.equipment_note, at: Number(rec.equipment_at) } : null;
    const job = (jobs ?? []).find((j) => Number(j.booking_id) === bid && Number(j.room_id) === rid);
    const w = (wifi ?? []).find((x) => Number(x.booking_id) === bid);
    const facts = {
      bookingId: bid, checkoutAt: out, nextCheckinAt: nextIn,
      usedTaskIds: usedRows.filter((u) => Number(u.booking_id) !== bid).map((u) => Number(u.hk_task_id)),
      hkTasks: hk.filter((t) => Number(t.room_id) === rid).map((t) => ({ id: Number(t.id), bookingId: t.booking_id === null ? null : Number(t.booking_id), status: t.status, createdAt: t.created_at, completedAt: t.completed_at, startedAt: t.started_at, inspection: t.inspection_status, inspectedAt: t.inspected_at, notes: t.inspection_notes })),
      unavailable: Object.keys(missing).filter((k) => missing[k]),
      faults: (faults ?? []).filter((m) => Number(m.room_id) === rid),
      equipment,
      hasTv: (tvs ?? []).some((t) => Number(t.room_id) === rid),
      tvJob: job ? { status: job.status, error: job.error_code, staffCheckedAt: job.staff_checked_at_ms } : null,
      wifi: w ? { status: w.status, error: w.error, removedAt: w.removed_at } : null,
      cards: (cards ?? []).filter((c) => Number(c.booking_id) === bid).map((c) => ({ status: c.status, validUntil: Number(c.valid_until) })),
    };
    const live = evaluateTurnover(facts, now);
    const verified = rec?.status === "verified";
    const problems = Object.entries(live.steps).filter(([, v]) => v.state === "failed" || v.state === "unavailable").map(([k, v]) => `${k}: ${v.detail}`);
    // v195: readiness against the next arrival — when the next guest is expected (their pre-check-in time, else the
    // hotel's check-in time) and how far that is; a minor open fault is a remark, a serious one makes it not ready.
    const nx = next.find((n) => Number(n.room_id) === rid);
    const arrivalAt = nx ? hotelMs(String(nx.next_in), HHMM.test(String(nx.arrival_time ?? "")) ? String(nx.arrival_time) : checkInTime) : null;
    const minutesToArrival = arrivalAt === null ? null : Math.round((arrivalAt - now) / 60_000);
    const remarks = Number(live.steps.equipment?.remarks ?? 0);
    const base = occupied ? { state: "occupied", detail: "ο επόμενος πελάτης είναι ήδη στο δωμάτιο" }
      : live.status === "ready" ? (remarks ? { state: "ready_with_remarks", detail: `έτοιμο, με ${remarks} μικρή(ές) βλάβη(ες) ανοιχτή(ές)` } : { state: "ready", detail: "όλα τα βήματα ισχύουν τώρα" })
      : { state: "not_ready", detail: problems.length ? problems.join(" · ") : "εκκρεμούν βήματα" };
    const urgency = base.state === "not_ready" && minutesToArrival !== null ? (minutesToArrival <= 0 ? "overdue" : minutesToArrival <= 180 ? "urgent" : "planned") : "none";
    // v196 forecast for a room not ready yet with a next arrival.
    let forecast = null;
    if (base.state === "not_ready" && history !== null && openTasks !== null) {
      const tid = live.steps.cleaning.taskId;
      const task = tid ? hk.find((t) => Number(t.id) === tid) : null;
      const ahead = task?.assigned_to ? (openTasks ?? []).filter((t) => String(t.assigned_to) === String(task.assigned_to) && Number(t.id) < Number(task.id) && Number(t.room_id) !== rid).length : 0;
      const otherPending = STEPS.filter((st) => st.key !== "cleaning" && ["pending", "failed"].includes(live.steps[st.key].state)).length;
      forecast = predictReadiness({ now, cleaning: live.steps.cleaning.state, task: task ? { status: task.status, startedAt: task.started_at, completedAt: task.completed_at } : null, queueAhead: ahead, history: forecastHistory, otherPending, arrivalAt });
    }
    const current = { ...base, arrivalAt, minutesToArrival, nextReference: nx ? String(nx.reference) : null, urgency, forecast };
    return {
      bookingId: bid, roomId: rid, code: String(o.code), reference: String(o.reference), guest: String(o.guest_name ?? "").split(" ")[0], checkoutAt: out,
      nextArrival: nx?.next_in ?? null,
      status: verified ? "verified" : live.status, steps: live.steps,
      verifiedAt: verified ? Number(rec.verified_at) : null, verifiedBy: verified ? String(rec.verified_by) : null,
      verifiedSteps: verified ? JSON.parse(String(rec.steps_json)) : null,
      current, regressed: verified && current.state === "not_ready",
    };
  });
  return { at: now, turnovers, dataUnavailable: [...unavailable.values()] };
}

/** Records the equipment check (a person's confirmation). */
export async function confirmEquipment({ pool, owner, bookingId, roomId, by, note = "", now = Date.now() }) {
  await pool.query(
    `INSERT INTO room_turnovers(owner_id,booking_id,room_id,status,equipment_at,equipment_by,equipment_note,created_at,updated_at) VALUES($1,$2,$3,'pending',$4,$5,$6,$4,$4)
     ON CONFLICT(owner_id,booking_id) DO UPDATE SET equipment_at=$4,equipment_by=$5,equipment_note=$6,updated_at=$4 WHERE room_turnovers.status<>'verified'`,
    [owner, bookingId, roomId, now, String(by).slice(0, 80), String(note).slice(0, 300)],
  );
}

/**
 * Final confirmation (v194): inside one SERIALIZABLE transaction — the evidence is re-evaluated from the database in
 * that transaction, the cleaning used as evidence is recorded and can never prove another turnover (unique index),
 * and a concurrent change to the same records (a fault opened, an inspection reversed) makes the confirmation fail
 * instead of storing stale evidence. Returns { ok, status, steps } or { ok: false, blocking }.
 */
export async function verifyTurnover({ pool, owner, bookingId, by, now = Date.now() }) {
  const client = typeof pool.connect === "function" ? await pool.connect() : pool;
  const release = () => { try { client.release?.(); } catch { /* already released */ } };
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`turnover:${owner}:${bookingId}`]);
    const board = await turnoverBoard({ pool: client, owner, now, bookingIds: [Number(bookingId)] });
    const t = board.turnovers.find((x) => x.bookingId === Number(bookingId));
    if (!t) { await client.query("ROLLBACK"); return { ok: false, status: "not_found", blocking: [] }; }
    if (t.status === "verified") { await client.query("ROLLBACK"); return { ok: true, status: "verified", steps: t.verifiedSteps, already: true }; }
    const blocking = STEPS.filter((s) => !["done", "na"].includes(t.steps[s.key].state)).map((s) => `${s.el}: ${t.steps[s.key].detail}`);
    if (blocking.length) { await client.query("ROLLBACK"); return { ok: false, status: t.status, blocking }; }
    await client.query(
      `INSERT INTO room_turnovers(owner_id,booking_id,room_id,status,steps_json,verified_at,verified_by,hk_task_id,created_at,updated_at) VALUES($1,$2,$3,'verified',$4,$5,$6,$7,$5,$5)
       ON CONFLICT(owner_id,booking_id) DO UPDATE SET status='verified',steps_json=$4,verified_at=$5,verified_by=$6,hk_task_id=$7,updated_at=$5 WHERE room_turnovers.status<>'verified'`,
      [owner, t.bookingId, t.roomId, JSON.stringify(t.steps), now, String(by).slice(0, 80), t.steps.cleaning.taskId ?? null],
    );
    await client.query("COMMIT");
    return { ok: true, status: "verified", steps: t.steps };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const code = /** @type {any} */ (e)?.code;
    if (code === "40001" || code === "40P01") return { ok: false, status: "conflict", blocking: ["Τα στοιχεία άλλαξαν την ώρα της επιβεβαίωσης — δοκιμάστε ξανά"] };
    if (code === "23505") return { ok: false, status: "conflict", blocking: ["Ο καθαρισμός αυτός έχει ήδη χρησιμοποιηθεί ως τεκμήριο για άλλη αναχώρηση"] };
    throw e;
  } finally { if (client !== pool) release(); }
}
