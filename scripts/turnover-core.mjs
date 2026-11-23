// v193 Verified Room Turnover: after each check-out, one final confirmation that the room is really ready for the
// next guest — every step proven from its own record, never assumed:
//   cleaning    — a housekeeping task for the room finished after the check-out and approved at inspection;
//   equipment   — a person confirmed the equipment check (and no serious fault is open for the room);
//   tv          — the guest's accounts were cleared from the room TV (privacy job confirmed by staff);
//   wifi        — the guest's Wi-Fi password was removed from the network;
//   access      — the guest's access cards were revoked or have expired.
// A step that does not apply (no TV in the room, Wi-Fi not used) is «n/a». «Επιβεβαίωση» is possible only when every
// applicable step is done; it stores the documented result (each step's evidence and time) and who confirmed it.
const HOUR = 3_600_000;
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
  // Cleaning: finished after the check-out and approved.
  const hk = (f.hkTasks ?? []).filter((t) => Number(t.completedAt ?? 0) >= at - 5 * 60_000 || Number(t.startedAt ?? 0) >= at - 5 * 60_000).sort((a, b) => Number(b.completedAt ?? 0) - Number(a.completedAt ?? 0))[0];
  if (!hk) out.cleaning = { state: "pending", detail: "δεν υπάρχει καθαρισμός μετά το check-out" };
  else if (hk.inspection === "approved" || hk.inspection === "passed") out.cleaning = { state: "done", detail: `εγκρίθηκε${hk.inspectedAt ? ` ${new Date(Number(hk.inspectedAt)).toISOString()}` : ""}`, at: Number(hk.inspectedAt ?? hk.completedAt) };
  else if (hk.inspection === "rejected") out.cleaning = { state: "failed", detail: `απορρίφθηκε στην επιθεώρηση${hk.notes ? `: ${String(hk.notes).slice(0, 80)}` : ""}` };
  else out.cleaning = { state: "pending", detail: hk.status === "done" || hk.completedAt ? "καθαρίστηκε — αναμένει επιθεώρηση" : "σε εξέλιξη" };
  // Equipment: a person's confirmation; a serious open fault blocks it.
  const serious = (f.faults ?? []).filter((m) => m.severity !== "minor");
  if (serious.length) out.equipment = { state: "failed", detail: `ανοιχτή σοβαρή βλάβη: ${String(serious[0].description).slice(0, 80)}` };
  else if (f.equipment?.ok) out.equipment = { state: "done", detail: `επιβεβαίωσε ${f.equipment.by}${f.equipment.note ? ` — ${f.equipment.note}` : ""}`, at: Number(f.equipment.at) };
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
  const applicable = STEPS.filter((s) => out[s.key].state !== "na");
  const status = applicable.some((s) => out[s.key].state === "failed") ? "failed" : applicable.every((s) => out[s.key].state === "done") ? "ready" : "pending";
  return { steps: out, status };
}

/** Check-outs of the last `days` days with their turnover state (verified ones carry their stored record). */
export async function turnoverBoard({ pool, owner, now = Date.now(), days = 3 }) {
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  const since = now - days * 86_400_000;
  const outs = await q(`SELECT b.id booking_id,b.reference,b.guest_name,b.room_id,r.code,COALESCE(b.checked_out_at,0) checked_out_at FROM bookings b JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.status='checked_out' AND b.checked_out_at>=$2 ORDER BY b.checked_out_at DESC LIMIT 100`, [owner, since]);
  if (!outs.length) return { at: now, turnovers: [] };
  const roomIds = [...new Set(outs.map((o) => Number(o.room_id)))], bookingIds = outs.map((o) => Number(o.booking_id));
  const [hk, faults, tvs, jobs, wifi, cards, saved, next] = await Promise.all([
    q(`SELECT room_id,status,completed_at,started_at,inspection_status,inspected_at,inspection_notes FROM housekeeping_tasks WHERE owner_id=$1 AND room_id=ANY($2::bigint[]) AND (completed_at>=$3 OR started_at>=$3 OR due_at>=$3)`, [owner, roomIds, since - 86_400_000]),
    q(`SELECT room_id,severity,description FROM maintenance_notices WHERE owner_id=$1 AND status='open' AND room_id=ANY($2::bigint[])`, [owner, roomIds]).catch(() => []),
    q(`SELECT room_id FROM tv_screens WHERE owner_id=$1 AND active=1 AND room_id=ANY($2::bigint[])`, [owner, roomIds]).catch(() => []),
    q(`SELECT booking_id,room_id,status,error_code,staff_checked_at_ms FROM tv_privacy_jobs WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]).catch(() => []),
    q(`SELECT booking_id,status,error,removed_at FROM guest_wifi WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]).catch(() => []),
    q(`SELECT booking_id,status,valid_until FROM access_cards WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]).catch(() => []),
    q(`SELECT * FROM room_turnovers WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, bookingIds]),
    q(`SELECT room_id,min(check_in) next_in FROM bookings WHERE owner_id=$1 AND status='confirmed' AND room_id=ANY($2::bigint[]) GROUP BY room_id`, [owner, roomIds]),
  ]);
  const turnovers = outs.map((o) => {
    const bid = Number(o.booking_id), rid = Number(o.room_id);
    const rec = saved.find((s) => Number(s.booking_id) === bid);
    let equipment = null;
    if (rec?.equipment_at) equipment = { ok: true, by: rec.equipment_by, note: rec.equipment_note, at: Number(rec.equipment_at) };
    const job = jobs.find((j) => Number(j.booking_id) === bid && Number(j.room_id) === rid);
    const w = wifi.find((x) => Number(x.booking_id) === bid);
    const facts = {
      checkoutAt: Number(o.checked_out_at),
      hkTasks: hk.filter((t) => Number(t.room_id) === rid).map((t) => ({ status: t.status, completedAt: t.completed_at, startedAt: t.started_at, inspection: t.inspection_status, inspectedAt: t.inspected_at, notes: t.inspection_notes })),
      faults: faults.filter((m) => Number(m.room_id) === rid),
      equipment,
      hasTv: tvs.some((t) => Number(t.room_id) === rid),
      tvJob: job ? { status: job.status, error: job.error_code, staffCheckedAt: job.staff_checked_at_ms } : null,
      wifi: w ? { status: w.status, error: w.error, removedAt: w.removed_at } : null,
      cards: cards.filter((c) => Number(c.booking_id) === bid).map((c) => ({ status: c.status, validUntil: Number(c.valid_until) })),
    };
    const live = evaluateTurnover(facts, now);
    const verified = rec?.status === "verified";
    return {
      bookingId: bid, roomId: rid, code: String(o.code), reference: String(o.reference), guest: String(o.guest_name ?? "").split(" ")[0], checkoutAt: Number(o.checked_out_at),
      nextArrival: next.find((n) => Number(n.room_id) === rid)?.next_in ?? null,
      status: verified ? "verified" : live.status, steps: verified ? JSON.parse(String(rec.steps_json)) : live.steps,
      verifiedAt: verified ? Number(rec.verified_at) : null, verifiedBy: verified ? String(rec.verified_by) : null,
    };
  });
  return { at: now, turnovers };
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
 * Final confirmation: only when every applicable step is done (re-evaluated now, never trusted from the page).
 * Stores the documented result. Returns { ok, status, steps } — ok false with the blocking steps otherwise.
 */
export async function verifyTurnover({ pool, owner, bookingId, by, now = Date.now() }) {
  const board = await turnoverBoard({ pool, owner, now, days: 30 });
  const t = board.turnovers.find((x) => x.bookingId === Number(bookingId));
  if (!t) return { ok: false, status: "not_found", blocking: [] };
  if (t.status === "verified") return { ok: true, status: "verified", steps: t.steps };
  const blocking = STEPS.filter((s) => !["done", "na"].includes(t.steps[s.key].state)).map((s) => `${s.el}: ${t.steps[s.key].detail}`);
  if (blocking.length) return { ok: false, status: t.status, blocking };
  await pool.query(
    `INSERT INTO room_turnovers(owner_id,booking_id,room_id,status,steps_json,verified_at,verified_by,created_at,updated_at) VALUES($1,$2,$3,'verified',$4,$5,$6,$5,$5)
     ON CONFLICT(owner_id,booking_id) DO UPDATE SET status='verified',steps_json=$4,verified_at=$5,verified_by=$6,updated_at=$5`,
    [owner, t.bookingId, t.roomId, JSON.stringify(t.steps), now, String(by).slice(0, 80)],
  );
  return { ok: true, status: "verified", steps: t.steps };
}
