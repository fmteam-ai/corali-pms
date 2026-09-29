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

test("birthday codes respect the allowed stay window and excluded periods", async () => {
  const { stayProblem, dateInRange, parseDateRanges } = await import("../lib/direct-pricing.ts");
  const summerBlock = { stay_from: null, stay_to: null, blackout_json: JSON.stringify([{ from: "07-20", to: "08-20" }]) };
  assert.equal(stayProblem(summerBlock, "2027-07-10", "2027-07-15"), null);
  assert.equal(stayProblem(summerBlock, "2027-07-18", "2027-07-21"), "STAY_BLACKOUT"); // night of 20/07 is excluded
  assert.equal(stayProblem(summerBlock, "2027-08-21", "2027-08-25"), null); // check-out day itself is not a night
  assert.equal(stayProblem(summerBlock, "2027-08-18", "2027-08-21"), "STAY_BLACKOUT");
  assert.equal(stayProblem(summerBlock, "2028-08-01", "2028-08-02"), "STAY_BLACKOUT"); // repeats every year
  const season = { stay_from: "04-01", stay_to: "10-31", blackout_json: "[]" };
  assert.equal(stayProblem(season, "2027-10-30", "2027-11-01"), null);
  assert.equal(stayProblem(season, "2027-10-30", "2027-11-02"), "STAY_OUTSIDE");
  assert.equal(stayProblem({ stay_from: "2027-05-01", stay_to: "2027-06-30", blackout_json: null }, "2027-06-29", "2027-07-01"), null);
  assert.equal(stayProblem({ stay_from: "2027-05-01", stay_to: "2027-06-30", blackout_json: null }, "2028-06-01", "2028-06-02"), "STAY_OUTSIDE");
  assert.equal(dateInRange("2027-01-03", { from: "12-20", to: "01-06" }), true); // wraps the new year
  assert.equal(dateInRange("2027-02-03", { from: "12-20", to: "01-06" }), false);
  assert.deepEqual(parseDateRanges('[{"from":"07-20","to":"2027-08-20"},{"from":"bad","to":"08-01"},{"from":"01-01","to":"01-02"}]'), [{ from: "01-01", to: "01-02" }]);
  assert.deepEqual(parseDateRanges("not json"), []);
});

test("couponProblem checks stay dates only when the search supplies them", () => {
  const c = { id: 1, code: "BDAY-X", discount_type: "percentage", discount_value: 10, valid_from: "2027-01-01", valid_to: "2027-12-31", max_uses: 1, usage_count: 0, active: 1, combinable: 0, restricted_email: null, stay_from: null, stay_to: null, blackout_json: '[{"from":"07-20","to":"08-20"}]' } as Coupon;
  assert.equal(couponProblem(c, { today: "2027-06-01" }), null);
  assert.equal(couponProblem(c, { today: "2027-06-01", checkIn: "2027-08-01", checkOut: "2027-08-05" }), "STAY_BLACKOUT");
  assert.equal(couponProblem(c, { today: "2027-06-01", checkIn: "2027-09-01", checkOut: "2027-09-05" }), null);
});
