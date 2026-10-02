import assert from "node:assert/strict";
import test from "node:test";
import { applyOffer, daysBeforeArrival, nightOverrides, offerCoversNight, offerFitsStay, offerStatus, offerValue, promotionText, type Offer } from "../lib/offers.ts";
import { couponCodeFrom, couponStatus } from "../lib/direct-pricing.ts";

const base: Offer = { name: "Autumn", starts_on: "2026-10-01", ends_on: "2026-10-31", adjustment_type: "percentage", adjustment_value: 10, operation: "discount", weekdays: "[]", room_codes: "[]", rate_plan_keys: "[]", minimum_stay: 1, promotion: 1 };

test("last-minute, early-booking and check-in-in-season windows", () => {
  assert.equal(daysBeforeArrival("2026-10-01", "2026-10-08"), 7);
  const lastMinute = { ...base, last_minute_days: 7 };
  assert.equal(offerFitsStay(lastMinute, { checkIn: "2026-10-08", nights: 2, today: "2026-10-01" }), true);
  assert.equal(offerFitsStay(lastMinute, { checkIn: "2026-10-09", nights: 2, today: "2026-10-01" }), false);
  const early = { ...base, min_advance_days: 60 };
  assert.equal(offerFitsStay(early, { checkIn: "2026-10-20", nights: 2, today: "2026-10-01" }), false);
  assert.equal(offerFitsStay(early, { checkIn: "2026-12-01", nights: 2, today: "2026-10-01" }), true);
  const season = { ...base, checkin_in_season: 1 };
  assert.equal(offerFitsStay(season, { checkIn: "2026-09-29", nights: 5, today: "2026-09-01" }), false);
  assert.equal(offerFitsStay(base, { checkIn: "2026-09-29", nights: 5, today: "2026-09-01" }), true);
  assert.equal(offerFitsStay({ ...base, minimum_stay: 3 }, { checkIn: "2026-10-05", nights: 2, today: "2026-10-01" }), false);
});

test("nights, weekdays, rooms and rate plans", () => {
  const offer = { ...base, weekdays: "[5,6]", room_codes: '["101"]', rate_plan_keys: '["direct_web"]' };
  assert.equal(offerCoversNight(offer, { date: "2026-10-02", roomCode: "101", planKey: "direct_web" }), true); // Friday
  assert.equal(offerCoversNight(offer, { date: "2026-10-05", roomCode: "101", planKey: "direct_web" }), false); // Monday
  assert.equal(offerCoversNight(offer, { date: "2026-10-02", roomCode: "102", planKey: "direct_web" }), false);
  assert.equal(offerCoversNight(offer, { date: "2026-10-02", roomCode: "101", planKey: "flexible" }), false);
  assert.equal(offerCoversNight({ ...base, weekdays: "null", room_codes: "null" }, { date: "2026-11-01", roomCode: "101", planKey: "flexible" }), false, "outside the period");
});

test("values, longer-stay tiers and rounding", () => {
  assert.equal(applyOffer(9350, base, 2), 8415);
  assert.equal(applyOffer(9350, { ...base, round_integer: 1 }, 2), 8400);
  assert.equal(applyOffer(10000, { ...base, operation: "charge", adjustment_type: "fixed", adjustment_value: 1500 }, 1), 11500);
  const tiers = { ...base, nights_overrides_json: '[{"nights":14,"value":20},{"nights":7,"value":15},{"nights":"x","value":5}]' };
  assert.deepEqual(nightOverrides(tiers.nights_overrides_json), [{ nights: 7, value: 15 }, { nights: 14, value: 20 }]);
  assert.deepEqual([offerValue(tiers, 3), offerValue(tiers, 7), offerValue(tiers, 20)], [10, 15, 20]);
  assert.equal(applyOffer(10000, { ...base, adjustment_value: 150 }, 1), 0, "never below zero");
});

test("promotion text and statuses", () => {
  const offer = { ...base, promotion_text_json: '{"el":"Φθινόπωρο","en":"Autumn deal"}' };
  assert.equal(promotionText(offer, "el"), "Φθινόπωρο");
  assert.equal(promotionText(offer, "de"), "Autumn deal");
  assert.equal(promotionText({ ...base, promotion_text_json: "oops" }, "en"), "");
  assert.equal(offerStatus({ ...base, active: 1 }, "2026-09-30"), "upcoming");
  assert.equal(offerStatus({ ...base, active: 1 }, "2026-10-15"), "running");
  assert.equal(offerStatus({ ...base, active: 1 }, "2026-11-01"), "ended");
  assert.equal(offerStatus({ ...base, active: 0 }, "2026-10-15"), "inactive");
});

test("coupon statuses and readable random codes", () => {
  const c = { active: 1, valid_from: "2026-10-01", valid_to: "2026-12-31", max_uses: 5, usage_count: 3 };
  assert.equal(couponStatus(c, "2026-10-10"), "active");
  assert.equal(couponStatus(c, "2026-10-10", 2), "used_up");
  assert.equal(couponStatus(c, "2026-09-30"), "upcoming");
  assert.equal(couponStatus(c, "2027-01-01"), "expired");
  assert.equal(couponStatus({ ...c, active: 0 }, "2026-10-10"), "inactive");
  const code = couponCodeFrom("summer 26!", [0, 1, 2, 3, 4, 31]);
  assert.equal(code, "SUMMER26-ABCDE9");
  assert.match(couponCodeFrom("", [255, 128, 64, 32, 16, 8]), /^[A-Z2-9]{6}$/);
});

test("offers that do not combine: the cheaper of stacking or the exclusive one alone", async () => {
  const { bestOfferSet, combines } = await import("../lib/offers.ts");
  const a = { ...base, name: "A", adjustment_value: 10 }, b = { ...base, name: "B", adjustment_value: 10 }, solo = { ...base, name: "Solo", adjustment_value: 15, combine_offers: 0 }, fee = { ...base, name: "Fee", operation: "charge", adjustment_type: "fixed", adjustment_value: 500 };
  assert.equal(combines(a, "plan"), true);
  assert.equal(combines({ ...a, combine_plan: "0" }, "plan"), false);
  assert.deepEqual(bestOfferSet(10000, [a, b, fee], 2).map((o) => o.name), ["A", "B", "Fee"]);
  assert.deepEqual(bestOfferSet(10000, [a, b, solo, fee], 2).map((o) => o.name), ["A", "B", "Fee"], "10%+10% beats 15% alone");
  assert.deepEqual(bestOfferSet(10000, [a, { ...solo, adjustment_value: 25 }, fee], 2).map((o) => o.name), ["Solo", "Fee"], "25% alone beats 10%; surcharge kept");
});
