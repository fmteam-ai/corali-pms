// Guest self-service on the booking engine: sign in with booking number + email, change dates or cancel within the
// reservation & cancellation policy. Money is never moved automatically here: a higher price adds to the balance
// (with a payment link), and refunds are flagged to reception, who issue them in the payment provider.
import type { PoolClient } from "pg";
import { enqueueAvailability } from "@/lib/channel-sync";
import { db, withTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { evenNights } from "@/lib/folio";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { guestChangePolicy, validNewStay } from "@/lib/guest-changes";
import { pushNotification } from "@/lib/pms-notifications";
import { publicAvailability } from "@/lib/public-rate";
import { hashToken, newOpaqueToken } from "@/lib/security/tokens";
import { hotelToday } from "@/lib/tape-chart";
import type { BookingLanguage } from "@/lib/booking-i18n";

type Q = Pick<PoolClient, "query">;
const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export const BOOKING_COLUMNS = `b.id,b.reference,b.guest_name,b.guest_email,b.guest_language,b.room_id,b.check_in,b.check_out,b.status,b.total_cents,b.balance_cents,b.rate_policy,b.cancellation_days,b.adults,b.children,b.folio_initialized_at,b.created_at,b.version,r.room_type`;

export async function bookingForToken(q: Q, token: string, lock = false) {
  const r = await q.query(
    `SELECT ${BOOKING_COLUMNS} FROM booking_manage_tokens t JOIN bookings b ON b.id=t.booking_id AND b.owner_id=t.owner_id LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id
      WHERE t.owner_id=$1 AND t.token_hash=$2 AND t.status='active' AND t.expires_at>$3 LIMIT 1${lock ? " FOR UPDATE OF b" : ""}`,
    [env().PMS_OWNER_ID, hashToken(token), Date.now()],
  );
  return r.rows[0] ?? null;
}

export function policyFor(b: Record<string, unknown>) {
  return guestChangePolicy({ status: String(b.status), checkIn: String(b.check_in), today: hotelToday(), ratePlanKey: String(b.rate_policy ?? ""), cancellationDays: Number(b.cancellation_days ?? 0), totalCents: Number(b.total_cents), balanceCents: Number(b.balance_cents) });
}

/** Booking number + email → a manage link token (2 hours). Same generic failure for any mismatch. */
export async function loginWithReference(reference: string, email: string): Promise<string | null> {
  const r = await db().query(`SELECT id FROM bookings WHERE owner_id=$1 AND upper(reference)=upper($2) AND lower(guest_email)=lower($3) AND status NOT IN ('no_show') LIMIT 1`, [env().PMS_OWNER_ID, reference.trim(), email.trim()]);
  const id = r.rows[0]?.id;
  if (!id) return null;
  const token = newOpaqueToken();
  await db().query(`INSERT INTO booking_manage_tokens(owner_id,booking_id,token_hash,status,expires_at,created_by,created_at) VALUES($1,$2,$3,'active',$4,'guest-login',$5)`, [env().PMS_OWNER_ID, id, hashToken(token), Date.now() + 2 * 3_600_000, Date.now()]);
  return token;
}

export type ChangeQuote = { ok: true; roomId: number; nights: number; roomCents: number; chargesCents: number; differenceCents: number; newTotalCents: number; newBalanceCents: number; refundDueCents: number; lastMinute: boolean } | { ok: false; error: "NOT_ALLOWED" | "INVALID_DATES" | "UNAVAILABLE" };

/** Price of the same room type and rate plan for new dates (the booking's own room does not block itself). */
export async function quoteChange(q: Q, b: Record<string, unknown>, checkIn: string, checkOut: string, lang: BookingLanguage): Promise<ChangeQuote> {
  if (!policyFor(b).canChangeDates) return { ok: false, error: "NOT_ALLOWED" };
  const today = hotelToday();
  if (!validNewStay(checkIn, checkOut, today) || (checkIn === b.check_in && checkOut === b.check_out)) return { ok: false, error: "INVALID_DATES" };
  const avail = await publicAvailability({ ownerId: env().PMS_OWNER_ID, checkIn, checkOut, adults: Number(b.adults ?? 1), children: Number(b.children ?? 0), rooms: 1, lang, excludeBookingId: Number(b.id) });
  const entry = avail.rooms.find((r) => r.roomType === b.room_type);
  const plan = entry?.plans.find((p) => p.key === b.rate_policy) ?? entry?.plans.find((p) => p.key === "flexible");
  if (!entry || !plan) return { ok: false, error: "UNAVAILABLE" };
  // Keep the same room when it is free for the new dates; otherwise another room of the same type.
  const sameFree = !(await q.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND id<>$3 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$5 AND check_out>$4
      UNION ALL SELECT 1 FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>$6 AND check_in<$5 AND check_out>$4 AND room_allocations::jsonb @> $7::jsonb LIMIT 1`,
    [env().PMS_OWNER_ID, b.room_id, b.id, checkIn, checkOut, Date.now(), JSON.stringify([Number(b.room_id)])])).rowCount;
  const roomId = sameFree ? Number(b.room_id) : Number(entry.roomIds[0]);
  const chargesCents = avail.charges.reduce((sum, c) => sum + Number(c.total_cents), 0);
  const old = (await q.query(`SELECT COALESCE((SELECT sum(amount_cents) FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2),0)::bigint AS room,
      COALESCE((SELECT sum(amount_cents) FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 AND entry_type='charge' AND category IN ('tax','fee')),0)::bigint AS charges`, [env().PMS_OWNER_ID, b.id])).rows[0];
  // Bookings never opened in the folio have no nightly lines yet: their stored total is the room price.
  const oldRoom = Number(old.room) || Number(b.total_cents), oldCharges = Number(old.room) ? Number(old.charges) : 0;
  const differenceCents = plan.totalCents + chargesCents - oldRoom - oldCharges;
  const newTotalCents = Number(b.total_cents) + differenceCents;
  const paid = Math.max(0, Number(b.total_cents) - Number(b.balance_cents));
  const lastMinute = Math.round((Date.parse(`${checkIn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) < 7;
  return { ok: true, roomId, nights: Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000), roomCents: plan.totalCents, chargesCents, differenceCents, newTotalCents, newBalanceCents: Math.max(0, newTotalCents - paid), refundDueCents: Math.max(0, paid - newTotalCents), lastMinute };
}

/** Apply a quoted date change; the price must still match what the guest confirmed. Returns a payment link if a balance is due. */
export async function applyChange(token: string, checkIn: string, checkOut: string, expectedTotalCents: number, lang: BookingLanguage) {
  return withTransaction(async (c) => {
    const b = await bookingForToken(c, token, true);
    if (!b) throw Error("INVALID_TOKEN");
    const quote = await quoteChange(c, b, checkIn, checkOut, lang);
    if (!quote.ok) throw Error(quote.error);
    if (quote.newTotalCents !== expectedTotalCents) throw Error("PRICE_CHANGED");
    await c.query("SELECT pg_advisory_xact_lock($1)", [quote.roomId]);
    const conflict = await c.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND id<>$3 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$5 AND check_out>$4 LIMIT 1`, [env().PMS_OWNER_ID, quote.roomId, b.id, checkIn, checkOut]);
    if (conflict.rowCount) throw Error("UNAVAILABLE");
    const owner = env().PMS_OWNER_ID, now = Date.now();
    await ensureFolio(c, owner, b);
    const before = { ...b };
    await c.query(`DELETE FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2`, [owner, b.id]);
    for (const n of evenNights(quote.roomCents, checkIn, checkOut)) await c.query(`INSERT INTO booking_nightly_rates(owner_id,booking_id,stay_date,amount_cents,original_cents,payer,updated_by,updated_at) VALUES($1,$2,$3,$4,$4,'guest','guest-change',$5)`, [owner, b.id, n.stay_date, n.amount_cents, now]);
    const charges = (await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint AS total FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 AND entry_type='charge' AND category IN ('tax','fee')`, [owner, b.id])).rows[0];
    const chargeDiff = quote.chargesCents - Number(charges.total);
    if (chargeDiff > 0) await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','tax',$3,$4,'guest','guest-change',$5)`, [owner, b.id, "Αλλαγή ημερομηνιών: υποχρεωτικές χρεώσεις / Date change: mandatory charges", chargeDiff, now]);
    if (chargeDiff < 0) await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'discount','other',$3,$4,'guest','guest-change',$5)`, [owner, b.id, "Αλλαγή ημερομηνιών: υποχρεωτικές χρεώσεις / Date change: mandatory charges", chargeDiff, now]);
    await c.query(`UPDATE bookings SET check_in=$1,check_out=$2,room_id=$3,version=version+1 WHERE owner_id=$4 AND id=$5`, [checkIn, checkOut, quote.roomId, owner, b.id]);
    await recalcBooking(c, owner, Number(b.id));
    const after = (await c.query(`SELECT * FROM bookings WHERE owner_id=$1 AND id=$2`, [owner, b.id])).rows[0];
    await c.query(`INSERT INTO reservation_audit(owner_id,booking_id,actor_id,action,before_json,after_json,created_at) VALUES($1,$2,'guest','guest_change_dates',$3,$4,$5)`, [owner, b.id, JSON.stringify(before), JSON.stringify(after), now]);
    await enqueueAvailability(c, owner, String(b.check_in), String(b.check_out), "guest_change");
    await enqueueAvailability(c, owner, checkIn, checkOut, "guest_change");
    const refund = quote.refundDueCents > 0 ? ` · επιστροφή ${euro(quote.refundDueCents)}` : "";
    await pushNotification(c, owner, { kind: "direct_booking", titleEl: `Αλλαγή ημερομηνιών από τον επισκέπτη: ${b.reference} · ${checkIn} – ${checkOut} · νέο σύνολο ${euro(Number(after.total_cents))}${refund}`, titleEn: `Guest changed dates: ${b.reference} · ${checkIn} – ${checkOut} · new total ${euro(Number(after.total_cents))}${quote.refundDueCents > 0 ? ` · refund due ${euro(quote.refundDueCents)}` : ""}`, link: `/pms/reservations/${b.id}` });
    let payUrl: string | null = null;
    if (Number(after.balance_cents) > 0) {
      const payToken = newOpaqueToken();
      await c.query(`UPDATE balance_payment_links SET status='revoked' WHERE owner_id=$1 AND booking_id=$2 AND status='active'`, [owner, b.id]);
      await c.query(`INSERT INTO balance_payment_links(owner_id,booking_id,token_hash,status,expires_at,created_at) VALUES($1,$2,$3,'active',$4,$5)`, [owner, b.id, hashToken(payToken), Date.parse(`${checkOut}T00:00:00Z`) + 3 * 86_400_000, now]);
      payUrl = `/pay-balance?token=${payToken}&lang=${lang}`;
    }
    return { booking: after, quote, payUrl };
  });
}

/** Cancel per the policy: free cancellation flags a refund of what was paid to reception; otherwise nothing is refunded. */
export async function cancelBooking(token: string) {
  return withTransaction(async (c) => {
    const b = await bookingForToken(c, token, true);
    if (!b) throw Error("INVALID_TOKEN");
    const policy = policyFor(b);
    if (!policy.canCancel) throw Error("NOT_ALLOWED");
    const owner = env().PMS_OWNER_ID, now = Date.now();
    await c.query(`UPDATE bookings SET status='cancelled',cancelled_at=$1,version=version+1 WHERE owner_id=$2 AND id=$3`, [now, owner, b.id]);
    await c.query(`UPDATE balance_payment_links SET status='revoked' WHERE owner_id=$1 AND booking_id=$2 AND status='active'`, [owner, b.id]);
    const after = (await c.query(`SELECT * FROM bookings WHERE owner_id=$1 AND id=$2`, [owner, b.id])).rows[0];
    await c.query(`INSERT INTO reservation_audit(owner_id,booking_id,actor_id,action,before_json,after_json,created_at) VALUES($1,$2,'guest','guest_cancel',$3,$4,$5)`, [owner, b.id, JSON.stringify(b), JSON.stringify(after), now]);
    await enqueueAvailability(c, owner, String(b.check_in), String(b.check_out), "guest_cancel");
    const refundEl = policy.refundCents > 0 ? ` · ΕΠΙΣΤΡΟΦΗ ${euro(policy.refundCents)} (δωρεάν ακύρωση)` : " · χωρίς επιστροφή";
    const refundEn = policy.refundCents > 0 ? ` · REFUND ${euro(policy.refundCents)} (free cancellation)` : " · no refund";
    await pushNotification(c, owner, { kind: "direct_booking", titleEl: `Ακύρωση από τον επισκέπτη: ${b.reference} · ${b.guest_name}${refundEl}`, titleEn: `Guest cancelled: ${b.reference} · ${b.guest_name}${refundEn}`, link: `/pms/reservations/${b.id}` });
    return { booking: after, refundCents: policy.refundCents };
  });
}
