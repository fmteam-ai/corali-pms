import assert from "node:assert/strict";
import test from "node:test";
import { autoPrice, normalizeAutoPricing } from "../scripts/auto-pricing-core.mjs";

const settings = normalizeAutoPricing({
  enabled: true, mode: "auto", maxChangePercent: 30, weekendPercent: 10,
  demand: [{ occupancy: 60, percent: 5 }, { occupancy: 90, percent: 20 }],
  lastMinute: { days: 7, belowOccupancy: 40, percent: -12 }, earlyBird: { days: 90, percent: -5 },
  types: { double: { enabled: true, minEur: 80, maxEur: 130 } },
});
const price = (x: Partial<Parameters<typeof autoPrice>[0]>) => autoPrice({ baseCents: 10000, occupancy: 0.5, leadDays: 30, date: "2026-07-08", settings, type: "double", ...x }).cents;

test("settings are cleaned and demand bands sorted from the highest", () => {
  assert.deepEqual(settings.demand.map((b) => b.occupancy), [90, 60]);
  const s = normalizeAutoPricing({ mode: "x", horizonDays: 9999, types: { a: { enabled: true, minEur: 200, maxEur: 100 } } });
  assert.equal(s.mode, "suggest");
  assert.equal(s.enabled, false);
  assert.equal(s.horizonDays, 365);
  assert.equal(s.types.a.maxEur, 200);
});

test("demand, last minute, early booking and weekend move the price", () => {
  assert.equal(price({}), 10000); // Wednesday, 50%: no rule
  assert.equal(price({ occupancy: 0.6 }), 10500);
  assert.equal(price({ occupancy: 0.95 }), 12000);
  assert.equal(price({ occupancy: 0.2, leadDays: 3 }), 8800);
  assert.equal(price({ leadDays: 120 }), 9500);
  assert.equal(price({ date: "2026-07-10" }), 11000); // Friday
});

test("the price always stays inside the minimum, maximum and the maximum change", () => {
  assert.equal(price({ occupancy: 0.95, date: "2026-07-11", baseCents: 12000 }), 13000); // capped at maximum €130
  assert.equal(price({ occupancy: 0, leadDays: 2, baseCents: 8500 }), 8000); // not below minimum €80
  const wide = normalizeAutoPricing({ enabled: true, maxChangePercent: 10, demand: [{ occupancy: 50, percent: 50 }], types: { double: { enabled: true } } });
  assert.equal(autoPrice({ baseCents: 10000, occupancy: 0.9, leadDays: 30, date: "2026-07-08", settings: wide, type: "double" }).cents, 11000);
  const comp = normalizeAutoPricing({ enabled: true, demand: [], compset: { enabled: true, weight: 50 }, types: {} });
  assert.equal(autoPrice({ baseCents: 10000, occupancy: 0.5, leadDays: 30, date: "2026-07-08", compMedianCents: 12000, settings: comp, type: "x" }).cents, 11000);
});
