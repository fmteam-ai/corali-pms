// v187 Guest Journey in the PMS: stays with their steps and history, retry / manual confirmation, and the health of
// every automation (cron steps, failed guest messages) with recovery.
import { db } from "@/lib/db";
import { JOURNEY_STEPS, STEP_LABELS, journeySummary } from "../scripts/journey-core.mjs";
import { confirmJourneyStep, runJourney } from "../scripts/journey-worker.mjs";
import { reconcile } from "../scripts/reconcile-core.mjs";
import { addDays, hotelToday } from "@/lib/tape-chart";

export type JourneyAction = { id: number; step: string; label: string; status: string; detail: string; attempts: number; updatedAt: number; nextCheckAt: number; confirmed: boolean };
export type JourneyStay = { bookingId: number; reference: string; guest: string; room: string | null; status: string; checkIn: string; checkOut: string; summary: string; actions: JourneyAction[]; events: { step: string; status: string; detail: string; actor: string; at: number }[] };

export async function journeyOverview(ownerId: string, lang: "el" | "en" = "el") {
  const today = hotelToday();
  const [stays, actions, events] = await Promise.all([
    db().query(
      `SELECT b.id,b.reference,b.guest_name,b.status,b.check_in,b.check_out,r.code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
        WHERE b.owner_id=$1 AND ((b.status='confirmed' AND b.check_in>=$2 AND b.check_in<=$3) OR (b.status='checked_in' AND b.check_out>=$2)
          OR EXISTS (SELECT 1 FROM journey_actions a WHERE a.owner_id=b.owner_id AND a.booking_id=b.id AND a.updated_at>$4))
        ORDER BY b.check_in, r.code NULLS LAST LIMIT 200`,
      [ownerId, today, addDays(today, 2), Date.now() - 86_400_000],
    ),
    db().query(`SELECT * FROM journey_actions WHERE owner_id=$1 AND updated_at>$2`, [ownerId, Date.now() - 4 * 86_400_000]),
    db().query(`SELECT booking_id,step,status,detail,actor,created_at FROM journey_events WHERE owner_id=$1 AND created_at>$2 ORDER BY created_at DESC LIMIT 2000`, [ownerId, Date.now() - 4 * 86_400_000]),
  ]);
  return stays.rows.map((b): JourneyStay => {
    const mine = actions.rows.filter((a) => Number(a.booking_id) === Number(b.id)).sort((x, y) => JOURNEY_STEPS.indexOf(x.step) - JOURNEY_STEPS.indexOf(y.step));
    const list = mine.map((a) => ({ id: Number(a.id), step: String(a.step), label: STEP_LABELS[a.step as keyof typeof STEP_LABELS]?.[lang] ?? String(a.step), status: String(a.status), detail: String(a.detail), attempts: Number(a.attempts), updatedAt: Number(a.updated_at), nextCheckAt: Number(a.next_check_at), confirmed: a.confirmed_by !== null }));
    return {
      bookingId: Number(b.id), reference: String(b.reference), guest: String(b.guest_name), room: b.code ? String(b.code) : null, status: String(b.status), checkIn: String(b.check_in), checkOut: String(b.check_out),
      summary: list.length ? journeySummary(list) : "pending", actions: list,
      events: events.rows.filter((e) => Number(e.booking_id) === Number(b.id)).slice(0, 40).map((e) => ({ step: String(e.step), status: String(e.status), detail: String(e.detail), actor: String(e.actor), at: Number(e.created_at) })),
    };
  });
}

export async function automationHealth(ownerId: string) {
  const [status, failures, deliveries, money] = await Promise.all([
    db().query(`SELECT * FROM automation_status WHERE owner_id=$1 ORDER BY name`, [ownerId]),
    db().query(`SELECT name,status,error,created_at FROM automation_failures WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 60`, [ownerId]),
    db().query(`SELECT d.id,d.event_key,d.channel,d.status,COALESCE(d.last_error,'') last_error,d.attempts,d.updated_at,b.reference,b.guest_name FROM message_deliveries d JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id WHERE d.owner_id=$1 AND d.status='failed' AND d.updated_at>$2 ORDER BY d.updated_at DESC LIMIT 100`, [ownerId, Date.now() - 7 * 86_400_000]),
    // v187: payments, POS room charges and app orders against the folios (30 days).
    reconcile({ pool: db(), owner: ownerId, fromMs: Date.now() - 30 * 86_400_000 }),
  ]);
  return {
    steps: status.rows.map((s) => ({ name: String(s.name), lastRunAt: Number(s.last_run_at), lastOkAt: s.last_ok_at ? Number(s.last_ok_at) : null, status: String(s.last_status), error: String(s.last_error), ms: Number(s.last_ms), runs: Number(s.runs), failures: Number(s.failures), consecutive: Number(s.consecutive_failures) })),
    failures: failures.rows.map((f) => ({ name: String(f.name), status: String(f.status), error: String(f.error), at: Number(f.created_at) })),
    reconciliation: money,
    failedMessages: deliveries.rows.map((d) => ({ id: Number(d.id), event: String(d.event_key), channel: String(d.channel), error: String(d.last_error), attempts: Number(d.attempts), at: Number(d.updated_at), reference: String(d.reference), guest: String(d.guest_name) })),
  };
}

/** «Επανάληψη»: the step is checked (and its recovery action performed) now. */
export async function retryJourney(ownerId: string, actionId: number, userId: number) {
  const a = (await db().query(`SELECT booking_id,step FROM journey_actions WHERE owner_id=$1 AND id=$2`, [ownerId, actionId])).rows[0];
  if (!a) throw Error("NOT_FOUND");
  // A failed message is queued again before the check, so the retry really re-sends it.
  if (a.step === "msg_instructions") await db().query(`UPDATE message_deliveries SET status='pending',scheduled_at=$3,last_error=NULL,updated_at=$3 WHERE owner_id=$1 AND booking_id=$2 AND event_key IN ('pre_arrival','checkin') AND status='failed'`, [ownerId, a.booking_id, Date.now()]);
  if (a.step === "tv_welcome") await db().query(`UPDATE journey_actions SET result_json='{}' WHERE owner_id=$1 AND id=$2 AND status IN ('failed','unconfirmed')`, [ownerId, actionId]);
  return runJourney({ pool: db(), owner: ownerId, bookingId: Number(a.booking_id), step: String(a.step), force: true, actor: `user:${userId}` });
}

export async function runJourneyNow(ownerId: string, userId: number) {
  return runJourney({ pool: db(), owner: ownerId, force: true, actor: `user:${userId}` });
}

export async function confirmJourney(ownerId: string, actionId: number, user: { id: number; name: string }, note: string) {
  await confirmJourneyStep({ pool: db(), owner: ownerId, actionId, userId: user.id, userName: user.name, note: note.trim().slice(0, 300) });
}

/** Failed guest messages (last 7 days, or one) are queued again; the cron sends them within a minute. */
export async function retryFailedMessages(ownerId: string, deliveryId?: number) {
  const r = await db().query(
    `UPDATE message_deliveries SET status='pending',scheduled_at=$2,last_error=NULL,updated_at=$2 WHERE owner_id=$1 AND status='failed' AND updated_at>$3 ${deliveryId ? "AND id=$4" : ""}`,
    deliveryId ? [ownerId, Date.now(), Date.now() - 7 * 86_400_000, deliveryId] : [ownerId, Date.now(), Date.now() - 7 * 86_400_000],
  );
  return r.rowCount ?? 0;
}
