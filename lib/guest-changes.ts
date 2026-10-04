// What a guest may do online with their booking, from the reservation & cancellation policy (pure; unit tested).
// - Refundable rates: free cancellation (full refund of what was paid) and date changes until N days before arrival.
// - After that deadline, or on a non-refundable rate: cancellation is possible but nothing is refunded, and dates
//   cannot be changed online (the guest is asked to contact the hotel).

export type GuestChangeInput = { status: string; checkIn: string; today: string; ratePlanKey: string; cancellationDays: number; totalCents: number; balanceCents: number; refundPercent?: number | null };
export type GuestChangePolicy = {
  nonRefundable: boolean; daysUntilArrival: number; deadline: string; freeCancellation: boolean;
  canCancel: boolean; refundCents: number; paidCents: number; canChangeDates: boolean; refundPercent: number;
  blocked: null | "not_confirmed" | "arrival_passed";
};

const dayMs = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
export const NON_REFUNDABLE_PLANS = ["non_refundable"];

export function guestChangePolicy(x: GuestChangeInput): GuestChangePolicy {
  const nonRefundable = NON_REFUNDABLE_PLANS.includes(x.ratePlanKey);
  const days = Math.round((Date.parse(`${x.checkIn}T00:00:00Z`) - Date.parse(`${x.today}T00:00:00Z`)) / dayMs);
  const cancellationDays = Math.max(0, Math.trunc(Number(x.cancellationDays) || 0));
  const deadline = addDays(x.checkIn, -cancellationDays);
  const paidCents = Math.max(0, Math.trunc(Number(x.totalCents) - Number(x.balanceCents)));
  const blocked = x.status !== "confirmed" ? "not_confirmed" : days < 0 ? "arrival_passed" : null;
  // Partly refundable plans give back only their share of what was paid when cancelled in time.
  const refundPercent = nonRefundable ? 0 : x.refundPercent === null || x.refundPercent === undefined ? 100 : Math.max(0, Math.min(100, Math.trunc(Number(x.refundPercent))));
  const freeCancellation = !blocked && refundPercent > 0 && x.today <= deadline;
  return {
    nonRefundable, daysUntilArrival: days, deadline, freeCancellation,
    canCancel: !blocked, refundCents: freeCancellation ? Math.round((paidCents * refundPercent) / 100) : 0, paidCents, refundPercent,
    canChangeDates: freeCancellation, blocked,
  };
}

/** New dates are acceptable: valid range, not in the past, at most 30 nights, and only for a booking that may change. */
export function validNewStay(checkIn: string, checkOut: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) return false;
  const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / dayMs);
  return checkIn >= today && nights >= 1 && nights <= 30;
}
