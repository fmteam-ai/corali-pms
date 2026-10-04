import type { PoolClient } from "pg";
import { postOnlineFolio } from "@/lib/folio-db";
import { pushNotification } from "@/lib/pms-notifications";
import { splitCents } from "@/lib/stripe-fulfillment";
import { enqueueAvailability } from "@/lib/channel-sync";

type Queryable = Pick<PoolClient, "query">;

export type BookingSessionRow = {
  id: number; room_allocations: string; total_cents: number; check_in: string; check_out: string;
  guest_first_name: string; guest_last_name: string; guest_email: string; guest_phone: string; country: string; language: string;
  rate_policy: string; guests: number; children: number; special_requests: string; whatsapp_opt_in: number | null; email_marketing_opt_in: number | null;
  coupon_code: string | null; balance_charge_days?: number | null; cancellation_days?: number | null; refund_percent?: number | null; room_subtotal_cents: number; extras_cents: number; charge_breakdown: string;
};

export type ConfirmedPayment = {
  provider: "stripe" | "viva";
  reference: string;
  amountCents: number;
  customerRef?: string | null;
  paymentMethodRef?: string | null;
  status?: "succeeded" | "authorized" | "card_saved"; // authorized = held on the card (captured later), card_saved = guarantee only
  authorizedCents?: number;
};

/**
 * Turn a locked, verified booking session into confirmed reservations (one per room) with an itemised folio.
 * Payment-provider neutral: the caller verifies the provider's payment and holds the session row lock.
 */
export async function fulfillBookingSession(client: Queryable, ownerId: string, source: BookingSessionRow, payment: ConfirmedPayment): Promise<number> {
  const roomIds = JSON.parse(source.room_allocations) as number[];
  for (const roomId of [...roomIds].sort((a, b) => a - b)) await client.query("SELECT pg_advisory_xact_lock($1)", [roomId]);
  const charges = splitCents(Number(source.total_cents), roomIds.length);
  const payments = splitCents(payment.amountCents, roomIds.length);
  let firstBooking: number | undefined;
  for (const [index, roomId] of roomIds.entries()) {
    const conflict = await client.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$4 AND check_out>$3 LIMIT 1`, [ownerId, roomId, source.check_in, source.check_out]);
    if (conflict.rowCount) throw new Error("ROOM_UNAVAILABLE");
    const reference = `CR-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const b = await client.query(
      `INSERT INTO bookings(owner_id,reference,guest_name,guest_email,guest_phone,guest_country,guest_language,room_id,check_in,check_out,channel,status,total_cents,balance_cents,rate_policy,cancellation_days,adults,children,special_requests,created_at,whatsapp_opt_in,email_marketing_opt_in,payment_provider,payment_customer_ref,payment_method_ref,balance_charge_days,refund_percent)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'direct','confirmed',$11,$12,$13,$24,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$25) RETURNING id`,
      [ownerId, reference, `${source.guest_first_name} ${source.guest_last_name}`, source.guest_email, source.guest_phone, source.country, source.language, roomId, source.check_in, source.check_out, charges[index], Math.max(0, charges[index] - payments[index]), source.rate_policy, source.guests, source.children, source.special_requests, Date.now(), source.whatsapp_opt_in ?? 0, source.email_marketing_opt_in ?? 0, payment.provider, payment.customerRef ?? null, payment.paymentMethodRef ?? null, source.balance_charge_days ?? null, Number(source.cancellation_days ?? 7), source.refund_percent ?? null],
    );
    const bookingId = Number(b.rows[0].id);
    firstBooking ??= bookingId;
    await postOnlineFolio(client, ownerId, bookingId, source, index, roomIds.length, charges[index], payments[index], `${payment.reference}#${index + 1}`);
  }
  await client.query(`INSERT INTO payment_transactions(owner_id,booking_id,provider,provider_reference,status,amount_cents,currency,created_at) VALUES($1,$2,$3,$4,$5,$6,'EUR',$7) ON CONFLICT(provider,provider_reference) DO NOTHING`, [ownerId, firstBooking, payment.provider, payment.reference, payment.status ?? "succeeded", payment.status === "authorized" ? payment.authorizedCents ?? 0 : payment.amountCents, Date.now()]);
  await pushNotification(client, ownerId, { kind: "direct_booking", titleEl: `Νέα απευθείας κράτηση: ${source.guest_first_name} ${source.guest_last_name} · ${source.check_in} → ${source.check_out}`, titleEn: `New direct booking: ${source.guest_first_name} ${source.guest_last_name} · ${source.check_in} → ${source.check_out}`, link: `/pms/reservations/${firstBooking}` });
  if (source.coupon_code) await client.query(`UPDATE coupons SET usage_count=usage_count+1 WHERE owner_id=$1 AND upper(code)=upper($2)`, [ownerId, source.coupon_code]);
  await enqueueAvailability(client, ownerId, source.check_in, source.check_out, "direct_booking");
  await client.query(`UPDATE booking_sessions SET status='completed',updated_at=$1 WHERE id=$2`, [Date.now(), source.id]);
  return firstBooking!;
}
