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
};

export type CouponProblem = "NOT_FOUND" | "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "USED_UP" | "EMAIL_MISMATCH";

export function normalizeCouponCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "").slice(0, 40) : "";
}

/** Why a code cannot be used today (booking date, Athens) by this guest, or null when it can. Pending checkouts hold a use. */
export function couponProblem(coupon: Coupon | null | undefined, context: { today: string; email?: string | null; pendingUses?: number }): CouponProblem | null {
  if (!coupon) return "NOT_FOUND";
  if (Number(coupon.active) !== 1) return "INACTIVE";
  if (coupon.valid_from && context.today < coupon.valid_from) return "NOT_STARTED";
  if (coupon.valid_to && context.today > coupon.valid_to) return "EXPIRED";
  if (coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.usage_count) + Number(context.pendingUses ?? 0) >= Number(coupon.max_uses)) return "USED_UP";
  if (coupon.restricted_email && context.email !== undefined && context.email !== null && coupon.restricted_email.toLowerCase() !== context.email.trim().toLowerCase()) return "EMAIL_MISMATCH";
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
