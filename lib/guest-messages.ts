import type { PoolClient } from "pg";
import { cancellationRefund, guestMessaging } from "../scripts/automation-core.mjs";

type Queryable = Pick<PoolClient, "query">;
export type MessageBooking = { id: number | string; channel?: string | null; guest_email?: string | null; guest_phone?: string | null; whatsapp_opt_in?: number | string | null; total_cents?: number | string; balance_cents?: number | string; rate_policy?: string | null; cancellation_days?: number | string | null; refund_percent?: number | string | null; check_in: string };

/**
 * Queue a triggered guest message (payment problem, cancellation) for the automation worker: email when the guest has
 * an address, WhatsApp when they opted in. OTA bookings are skipped (the channel informs its guests). Re-queuing the same
 * message replaces the earlier one.
 */
export async function queueGuestMessage(client: Queryable, ownerId: string, booking: MessageBooking, event: "payment_failed" | "cancellation", payload: Record<string, unknown>) {
  if (!guestMessaging(booking.channel)) return 0;
  const channels = [booking.guest_email ? "email" : null, Number(booking.whatsapp_opt_in) === 1 && booking.guest_phone ? "whatsapp" : null].filter(Boolean) as string[];
  const now = Date.now();
  for (const channel of channels) {
    await client.query(
      `INSERT INTO message_deliveries(owner_id,booking_id,event_key,channel,scheduled_at,status,payload_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$5,$5)
       ON CONFLICT(owner_id,booking_id,event_key,channel) DO UPDATE SET status='pending',attempts=0,last_error=NULL,payload_json=$6,scheduled_at=$5,updated_at=$5`,
      [ownerId, Number(booking.id), event, channel, now, JSON.stringify(payload)],
    );
  }
  return channels.length;
}

/** Details of a cancellation message: reason and whether the money paid comes back under the policy. */
export function cancellationPayload(booking: MessageBooking, reason: string, note: string | null, cancelledOn: string) {
  const paidCents = Math.max(0, Number(booking.total_cents ?? 0) - Number(booking.balance_cents ?? 0));
  const { outcome, freeUntil, refundCents, percent } = cancellationRefund({ paidCents, ratePolicy: booking.rate_policy, cancellationDays: booking.cancellation_days, checkIn: booking.check_in, cancelledOn, refundPercent: booking.refund_percent });
  return { reason, note: note || null, paidCents, refund: outcome, refundCents, refundPercent: percent, freeUntil, nonRefundable: String(booking.rate_policy ?? "") === "non_refundable" };
}
