import assert from "node:assert/strict";
import test from "node:test";
import { couponDiscount, couponProblem, normalizeCouponCode, priceWithOffers, type Coupon } from "../lib/direct-pricing.ts";

const birthday: Coupon = { id: 1, code: "BDAY-ABCDEFGH", discount_type: "percentage", discount_value: 10, valid_from: "2026-09-29", valid_to: "2026-11-28", max_uses: 1, usage_count: 0, active: 1, combinable: 0, restricted_email: "maria@example.com" };

test("direct website rate is 5% below the standard rate", () => {
  const p = priceWithOffers({ standardCents: 40000, nonPromoStandardCents: 40000, directPercent: 5 });
  assert.deepEqual(p, { standardCents: 40000, directCents: 38000, totalCents: 38000, directSavingCents: 2000, couponCents: 0, couponApplied: false });
  assert.equal(priceWithOffers({ standardCents: 40000, nonPromoStandardCents: 40000, directPercent: 0 }).totalCents, 40000);
  assert.equal(priceWithOffers({ standardCents: 40000, nonPromoStandardCents: 40000, directPercent: 90 }).totalCents, 20000, "discount capped at 50%");
});

test("non-stackable code replaces the direct discount and never raises the price", () => {
  const p = priceWithOffers({ standardCents: 40000, nonPromoStandardCents: 40000, directPercent: 5, coupon: birthday });
  assert.equal(p.totalCents, 36000);
  assert.equal(p.couponCents, 2000);
  assert.equal(p.couponApplied, true);
  // A promotional offer already lowered the standard price; the code works on the price without it.
  const promo = priceWithOffers({ standardCents: 30000, nonPromoStandardCents: 40000, directPercent: 5, coupon: birthday });
  assert.equal(promo.totalCents, 28500, "the better direct+promotion price is kept");
  assert.equal(promo.couponApplied, false);
});

test("stackable codes apply on top of the direct price", () => {
  const p = priceWithOffers({ standardCents: 40000, nonPromoStandardCents: 40000, directPercent: 5, coupon: { ...birthday, combinable: 1 } });
  assert.equal(p.totalCents, 34200);
  assert.equal(couponDiscount({ discount_type: "fixed", discount_value: 5000 }, 3000), 3000);
});

test("promo code validation", () => {
  const today = "2026-10-01";
  assert.equal(couponProblem(birthday, { today, email: "Maria@Example.com" }), null);
  assert.equal(couponProblem(birthday, { today }), null, "email checked only when known");
  assert.equal(couponProblem(birthday, { today, email: "other@example.com" }), "EMAIL_MISMATCH");
  assert.equal(couponProblem(birthday, { today: "2026-12-01" }), "EXPIRED");
  assert.equal(couponProblem(birthday, { today: "2026-09-01" }), "NOT_STARTED");
  assert.equal(couponProblem({ ...birthday, usage_count: 1 }, { today }), "USED_UP");
  assert.equal(couponProblem(birthday, { today, pendingUses: 1 }), "USED_UP", "a pending checkout holds the single use");
  assert.equal(couponProblem({ ...birthday, active: 0 }, { today }), "INACTIVE");
  assert.equal(couponProblem(null, { today }), "NOT_FOUND");
  assert.equal(normalizeCouponCode(" bday-abcd efgh "), "BDAY-ABCDEFGH");
});
