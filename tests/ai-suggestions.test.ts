import assert from "node:assert/strict";
import test from "node:test";
import { isBreakfast, recommendExtras } from "../lib/upsell.ts";
import { buildSuggestions, dayAdjustment, suggestionKey } from "../lib/pricing-suggestions.ts";

const extras = [
  { id: 1, code: "BREAKFAST", name: "Breakfast" },
  { id: 2, code: "COT", name: "Baby cot" },
  { id: 3, code: "WINE", name: "Bottle of wine on arrival" },
  { id: 4, code: "BOAT", name: "Boat tour to Antiparos" },
  { id: 5, code: "TRANSFER", name: "Port transfer" },
  { id: 6, code: "PROINO", name: "Πρωινό στο δωμάτιο" },
];

test("upsell never recommends breakfast and fits the guests", () => {
  assert.equal(isBreakfast(extras[5]), true);
  const family = recommendExtras(extras, { adults: 2, children: 1, nights: 5, checkIn: "2026-07-10", bookingDate: "2026-05-01" });
  assert.deepEqual(family.map((r) => r.id).slice(0, 2), [2, 4]);
  assert.equal(family[0].reason, "family");
  assert.ok(family.every((r) => r.id !== 1 && r.id !== 6));
  const couple = recommendExtras(extras, { adults: 2, children: 0, nights: 2, checkIn: "2026-10-10", bookingDate: "2026-10-01" });
  assert.equal(couple[0].id, 3);
  assert.equal(couple[0].reason, "couple");
  assert.deepEqual(recommendExtras([extras[0]], { adults: 1, children: 0, nights: 1, checkIn: "2026-10-10", bookingDate: "2026-10-09" }), []);
});

test("pricing suggestions follow demand and lead time", () => {
  assert.deepEqual(dayAdjustment(0.9, 10), { percent: 15, reason: "high_demand" });
  assert.deepEqual(dayAdjustment(0.75, 20), { percent: 10, reason: "strong_demand" });
  assert.equal(dayAdjustment(0.75, 60), null, "too far out to raise");
  assert.deepEqual(dayAdjustment(0.1, 5), { percent: -15, reason: "very_low_close_in" });
  assert.deepEqual(dayAdjustment(0.3, 12), { percent: -10, reason: "low_demand_close_in" });
  assert.equal(dayAdjustment(0.1, 30), null, "no early discounting");
  assert.equal(dayAdjustment(0.9, -1), null, "never for the past");
  const s = buildSuggestions([
    { date: "2026-10-02", roomType: "double", occupied: 13, total: 14 },
    { date: "2026-10-03", roomType: "double", occupied: 12, total: 14 },
    { date: "2026-10-04", roomType: "double", occupied: 4, total: 14 },
    { date: "2026-10-02", roomType: "apartment", occupied: 0, total: 6 },
  ], "2026-09-29");
  assert.deepEqual(s.map((x) => [x.roomType, x.startsOn, x.endsOn, x.percent]), [["apartment", "2026-10-02", "2026-10-02", -15], ["double", "2026-10-02", "2026-10-03", 15], ["double", "2026-10-04", "2026-10-04", -10]]);
  assert.equal(s[1].averageOccupancy, 0.89);
  assert.equal(suggestionKey(s[1]), "double|2026-10-02|2026-10-03|15");
});
