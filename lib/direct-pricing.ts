// Direct-booking pricing rules: website discount and promo codes (pure, unit tested).

export const DEFAULT_DIRECT_DISCOUNT_PERCENT = 5;

export type Coupon = {
  id: number;
  code: string;
  discount_type: string; // "percentage" | "fixed" (fixed amounts are in cents)
  discount_value: number;
  valid_from: string;
  valid_to: string;
  max_uses: number | null;
  usage_count: number;
  active: number;
  combinable: number;
  restricted_email: string | null;
  stay_from?: string | null; // "MM-DD" (every year) or "YYYY-MM-DD": first night the code may cover
  stay_to?: string | null; // last night the code may cover
  blackout_json?: string | null; // [{from,to}] ranges (MM-DD or YYYY-MM-DD) whose nights the code never covers
};

export type DateRange = { from: string; to: string };
const monthDay = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const fullDate = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A valid range bound: "MM-DD" repeats every year, "YYYY-MM-DD" is a single date. */
export function isRangeBound(value: unknown): value is string {
  return typeof value === "string" && (monthDay.test(value) || fullDate.test(value));
}

/** Parse stored blackout ranges, dropping anything malformed or mixing yearly and fixed bounds. */
export function parseDateRanges(value: unknown): DateRange[] {
  let list: unknown = value;
  if (typeof value === "string") { try { list = JSON.parse(value || "[]"); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  return list.flatMap((r) => r && isRangeBound(r.from) && isRangeBound(r.to) && r.from.length === r.to.length ? [{ from: r.from, to: r.to }] : []).slice(0, 20);
}

/** Whether an ISO date falls in a range; yearly (MM-DD) ranges may wrap the new year, e.g. 12-20 → 01-06. */
export function dateInRange(date: string, range: DateRange): boolean {
  if (range.from.length === 10) return date >= range.from && date <= range.to;
  const md = date.slice(5);
  return range.from <= range.to ? md >= range.from && md <= range.to : md >= range.from || md <= range.to;
}

/** Nights of a stay (check-in inclusive, check-out exclusive). */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${checkIn}T00:00:00Z`); d.toISOString().slice(0, 10) < checkOut && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** Why a code may not cover these stay nights: outside its allowed stay window, or touching an excluded period. */
export function stayProblem(coupon: Pick<Coupon, "stay_from" | "stay_to" | "blackout_json">, checkIn: string, checkOut: string): "STAY_OUTSIDE" | "STAY_BLACKOUT" | null {
  const nights = stayNights(checkIn, checkOut);
  const from = isRangeBound(coupon.stay_from) ? coupon.stay_from : null, to = isRangeBound(coupon.stay_to) ? coupon.stay_to : null;
  if (from || to) {
    const window = from && to && from.length === to.length ? { from, to } : null;
    const inside = (n: string) => window ? dateInRange(n, window) : (!from || (from.length === 10 ? n >= from : n.slice(5) >= from)) && (!to || (to.length === 10 ? n <= to : n.slice(5) <= to));
    if (!nights.every(inside)) return "STAY_OUTSIDE";
  }
  const blackout = parseDateRanges(coupon.blackout_json);
  if (nights.some((n) => blackout.some((r) => dateInRange(n, r)))) return "STAY_BLACKOUT";
  return null;
}

export type CouponProblem = "NOT_FOUND" | "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "USED_UP" | "EMAIL_MISMATCH" | "STAY_OUTSIDE" | "STAY_BLACKOUT";

export function normalizeCouponCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "").slice(0, 40) : "";
}

/** Why a code cannot be used today (booking date, Athens) by this guest, or null when it can. Pending checkouts hold a use. */
export function couponProblem(coupon: Coupon | null | undefined, context: { today: string; email?: string | null; pendingUses?: number; checkIn?: string; checkOut?: string }): CouponProblem | null {
  if (!coupon) return "NOT_FOUND";
  if (Number(coupon.active) !== 1) return "INACTIVE";
  if (coupon.valid_from && context.today < coupon.valid_from) return "NOT_STARTED";
  if (coupon.valid_to && context.today > coupon.valid_to) return "EXPIRED";
  if (coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.usage_count) + Number(context.pendingUses ?? 0) >= Number(coupon.max_uses)) return "USED_UP";
  if (coupon.restricted_email && context.email !== undefined && context.email !== null && coupon.restricted_email.toLowerCase() !== context.email.trim().toLowerCase()) return "EMAIL_MISMATCH";
  if (context.checkIn && context.checkOut) return stayProblem(coupon, context.checkIn, context.checkOut);
  return null;
}

export function couponDiscount(coupon: Pick<Coupon, "discount_type" | "discount_value">, baseCents: number): number {
  const base = Math.max(0, Math.trunc(baseCents));
  const value = Math.max(0, Number(coupon.discount_value) || 0);
  const discount = coupon.discount_type === "fixed" ? Math.trunc(value) : Math.round((base * Math.min(100, value)) / 100);
  return Math.min(base, discount);
}

export type OfferPrice = {
  standardCents: number; // configured price with all special offers
  directCents: number; // after the direct-website discount
  totalCents: number; // what the guest pays for the rooms
  directSavingCents: number;
  couponCents: number; // extra saving from the promo code versus the direct price
  couponApplied: boolean;
};

/**
 * Final room price. Stackable codes apply on top of the direct price. Non-stackable codes apply to the standard price
 * without promotional offers and replace the direct discount; the guest always pays the lower of the two.
 */
/**
 * The direct-booking discount belongs only to the "Direct website rate" plan (direct_web), applied once against the
 * standard price. Other plans keep their own adjustment (e.g. non-refundable −10%) with no direct discount. A
 * direct_web plan with a negative adjustment of its own uses the direct discount setting instead (or its own
 * percentage when the setting is off), so the discount is never applied twice.
 */
export function planPricing(planKey: string, adjustmentPercent: number, directPercent: number): { adjustmentPercent: number; directPercent: number } {
  const adj = Number(adjustmentPercent) || 0;
  const direct = Math.min(50, Math.max(0, Number(directPercent) || 0));
  if (planKey !== "direct_web") return { adjustmentPercent: adj, directPercent: 0 };
  if (adj < 0) return { adjustmentPercent: 0, directPercent: direct > 0 ? direct : Math.min(50, -adj) };
  return { adjustmentPercent: adj, directPercent: direct };
}

export function priceWithOffers(input: { standardCents: number; nonPromoStandardCents: number; directPercent: number; coupon?: Coupon | null }): OfferPrice {
  const standard = Math.max(0, Math.trunc(input.standardCents));
  const percent = Math.min(50, Math.max(0, Number(input.directPercent) || 0));
  const direct = Math.round((standard * (100 - percent)) / 100);
  let total = direct;
  let applied = false;
  if (input.coupon) {
    if (Number(input.coupon.combinable) === 1) {
      total = direct - couponDiscount(input.coupon, direct);
      applied = total < direct;
    } else {
      const base = Math.max(0, Math.trunc(input.nonPromoStandardCents));
      const couponed = base - couponDiscount(input.coupon, base);
      if (couponed < direct) {
        total = couponed;
        applied = true;
      }
    }
  }
  return { standardCents: standard, directCents: direct, totalCents: total, directSavingCents: standard - direct, couponCents: direct - total, couponApplied: applied };
}

/** Human multiplier for a mandatory charge line, e.g. "5 nights × €2.00". */
export function chargeUnit(mode: string): "night" | "room" | "person" | "room_night" | "booking" {
  return mode === "per_night" ? "night" : mode === "per_room" ? "room" : mode === "per_person" ? "person" : mode === "per_room_night" ? "room_night" : "booking";
}

export type CouponStatus = "active" | "inactive" | "upcoming" | "expired" | "used_up";

/** Status of a code on a given day, for the PMS list (booking window and remaining uses, pending checkouts included). */
export function couponStatus(coupon: Pick<Coupon, "active" | "valid_from" | "valid_to" | "max_uses" | "usage_count">, today: string, pendingUses = 0): CouponStatus {
  if (Number(coupon.active) !== 1) return "inactive";
  if (coupon.valid_from && today < coupon.valid_from) return "upcoming";
  if (coupon.valid_to && today > coupon.valid_to) return "expired";
  if (coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.usage_count) + pendingUses >= Number(coupon.max_uses)) return "used_up";
  return "active";
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A readable random code (no 0/O or 1/I), e.g. "SUMMER-7KQ4X2", from caller-supplied random bytes. */
export function couponCodeFrom(prefix: string, bytes: ArrayLike<number>, length = 6): string {
  const head = normalizeCouponCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 12);
  let tail = "";
  for (let i = 0; i < length; i++) tail += codeAlphabet[(bytes[i] ?? 0) % codeAlphabet.length];
  return head ? `${head}-${tail}` : tail;
}
