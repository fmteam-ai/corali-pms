// Revenue strategy analytics: pace & pickup, channel net yield and competitor rate index (pure; unit tested).

export type Stay = { check_in: string; check_out: string; total_cents: number; created_at: number; cancelled_at: number | null; status: string; channel: string };

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return iso(ms(date) + days * DAY);
}

/** Same calendar date one year earlier (29 Feb → 28 Feb). */
export function lastYear(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y - 1, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return iso(target.getTime());
}

/**
 * Whether a booking was on the books at `asOf` (epoch ms): created by then and not yet cancelled.
 * Cancelled bookings without a cancellation time (older data) are treated as never on the books.
 */
export function onBooksAt(stay: Stay, asOf: number): boolean {
  if (Number(stay.created_at) > asOf) return false;
  if (stay.status === "cancelled") return stay.cancelled_at !== null && stay.cancelled_at !== undefined && Number(stay.cancelled_at) > asOf;
  return true; // no-shows were on the books (and are usually charged)
}

export type Otb = { roomNights: number; revenueCents: number; bookings: number };

/** Room nights and revenue (prorated per night) falling in [from, to) for stays on the books at `asOf`. */
export function onTheBooks(stays: Stay[], from: string, to: string, asOf: number): Otb {
  let roomNights = 0, revenue = 0, bookings = 0;
  const lo = ms(from), hi = ms(to);
  for (const s of stays) {
    if (!onBooksAt(s, asOf)) continue;
    const a = ms(s.check_in), b = ms(s.check_out), nights = Math.round((b - a) / DAY);
    if (nights <= 0) continue;
    const overlap = Math.round((Math.min(b, hi) - Math.max(a, lo)) / DAY);
    if (overlap <= 0) continue;
    roomNights += overlap;
    revenue += (Number(s.total_cents) * overlap) / nights;
    bookings++;
  }
  return { roomNights, revenueCents: Math.round(revenue), bookings };
}

export const paceLeadDays = [180, 150, 120, 90, 60, 45, 30, 21, 14, 7, 0] as const;

/** Room nights on the books for a stay period at each lead time before its first night, this year vs last year. */
export function paceCurve(stays: Stay[], from: string, to: string, leads: readonly number[] = paceLeadDays) {
  const lyFrom = lastYear(from), lyTo = lastYear(to);
  return leads.map((lead) => {
    // End of the day `lead` days before the period starts.
    const asOf = ms(from) - lead * DAY + DAY - 1, asOfLy = ms(lyFrom) - lead * DAY + DAY - 1;
    return { lead, thisYear: onTheBooks(stays, from, to, asOf).roomNights, lastYear: onTheBooks(stays, lyFrom, lyTo, asOfLy).roomNights };
  });
}

export type PaceRow = { month: string; capacity: number; otb: Otb; stly: Otb; lyFinal: Otb; pickup7: number; pickup30: number };

/**
 * Month-by-month pace: on the books now vs the same time last year (STLY), last year's final result, and pickup
 * (net room nights gained) over the last 7 and 30 days.
 */
export function paceByMonth(stays: Stay[], months: string[], now: number, rooms: number): PaceRow[] {
  return months.map((month) => {
    const from = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const to = iso(Date.UTC(y, m, 1));
    const days = Math.round((ms(to) - ms(from)) / DAY);
    const nowOtb = onTheBooks(stays, from, to, now);
    const lyNow = now - (ms(from) - ms(lastYear(from)));
    return {
      month,
      capacity: days * rooms,
      otb: nowOtb,
      stly: onTheBooks(stays, lastYear(from), lastYear(to), lyNow),
      lyFinal: onTheBooks(stays, lastYear(from), lastYear(to), Number.MAX_SAFE_INTEGER),
      pickup7: nowOtb.roomNights - onTheBooks(stays, from, to, now - 7 * DAY).roomNights,
      pickup30: nowOtb.roomNights - onTheBooks(stays, from, to, now - 30 * DAY).roomNights,
    };
  });
}

export function variancePercent(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type Commission = { commissionPercent: number; paymentFeePercent: number };
export const defaultCommissions: Record<string, Commission> = {
  direct: { commissionPercent: 0, paymentFeePercent: 1.5 },
  phone: { commissionPercent: 0, paymentFeePercent: 0 },
  walk_in: { commissionPercent: 0, paymentFeePercent: 0 },
  "booking.com": { commissionPercent: 15, paymentFeePercent: 0 },
  expedia: { commissionPercent: 18, paymentFeePercent: 0 },
  airbnb: { commissionPercent: 15, paymentFeePercent: 0 },
};

export type ChannelYield = { channel: string; bookings: number; roomNights: number; grossCents: number; commissionCents: number; feeCents: number; netCents: number; grossAdrCents: number; netAdrCents: number; netShare: number; costPercent: number };

/** Gross vs net revenue per channel for nights in [from, to): commission and payment fees come off the room revenue. */
export function channelYield(stays: Stay[], from: string, to: string, commissions: Record<string, Commission>): ChannelYield[] {
  const groups = new Map<string, Stay[]>();
  for (const s of stays) if (s.status !== "cancelled" && s.status !== "no_show") groups.set(s.channel || "direct", [...(groups.get(s.channel || "direct") ?? []), s]);
  const rows = [...groups.entries()].map(([channel, list]) => {
    const otb = onTheBooks(list, from, to, Number.MAX_SAFE_INTEGER);
    const c = commissions[channel] ?? defaultCommissions[channel] ?? { commissionPercent: 0, paymentFeePercent: 0 };
    const commissionCents = Math.round((otb.revenueCents * c.commissionPercent) / 100);
    const feeCents = Math.round((otb.revenueCents * c.paymentFeePercent) / 100);
    const netCents = otb.revenueCents - commissionCents - feeCents;
    return { channel, bookings: otb.bookings, roomNights: otb.roomNights, grossCents: otb.revenueCents, commissionCents, feeCents, netCents, grossAdrCents: otb.roomNights ? Math.round(otb.revenueCents / otb.roomNights) : 0, netAdrCents: otb.roomNights ? Math.round(netCents / otb.roomNights) : 0, netShare: 0, costPercent: otb.revenueCents ? Math.round(((commissionCents + feeCents) / otb.revenueCents) * 1000) / 10 : 0 };
  }).filter((r) => r.roomNights > 0);
  const totalNet = rows.reduce((sum, r) => sum + r.netCents, 0);
  return rows.map((r) => ({ ...r, netShare: totalNet ? Math.round((r.netCents / totalNet) * 1000) / 10 : 0 })).sort((a, b) => b.netCents - a.netCents);
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

export type CompsetPosition = "above" | "in_line" | "below";

/** Our rate against the competitor median: index (100 = equal) and a ±10% band. */
export function compsetIndex(ourCents: number, competitorCents: number[]): { median: number | null; index: number | null; position: CompsetPosition | null } {
  const med = median(competitorCents);
  if (!med || !ourCents) return { median: med, index: null, position: null };
  const index = Math.round((ourCents / med) * 100);
  return { median: med, index, position: index > 110 ? "above" : index < 90 ? "below" : "in_line" };
}
