// Corali automatic pricing (pure; unit tested). For each room type and night the PMS starts from the hotel's own
// price (season price, else the base rate), moves it by demand (occupancy on the books), the days left, the weekend
// and, if wanted, the competitors' median, and always keeps it inside the hotel's minimum and maximum.

const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export const DEFAULT_AUTO_PRICING = {
  enabled: false,
  mode: "suggest", // "suggest": shown in the PMS only; "auto": applied to the booking engine and Channex
  horizonDays: 120,
  maxChangePercent: 30, // never further than this from the hotel's own price
  demand: [
    { occupancy: 90, percent: 20 },
    { occupancy: 75, percent: 12 },
    { occupancy: 60, percent: 5 },
  ],
  lastMinute: { days: 7, belowOccupancy: 40, percent: -12 },
  earlyBird: { days: 90, percent: 0 },
  weekendPercent: 0, // Friday and Saturday nights
  compset: { enabled: false, weight: 30 }, // move this % of the way toward the competitors' median
  types: {}, // { [roomType]: { enabled, minEur, maxEur } }
};

export function normalizeAutoPricing(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, d = DEFAULT_AUTO_PRICING;
  const demand = (Array.isArray(r.demand) ? r.demand : d.demand)
    .map((x) => ({ occupancy: clampNum(x?.occupancy, 0, 100, 0), percent: clampNum(x?.percent, -50, 100, 0) }))
    .filter((x) => x.occupancy > 0).slice(0, 8).sort((a, b) => b.occupancy - a.occupancy);
  const types = {};
  for (const [k, v] of Object.entries(r.types && typeof r.types === "object" ? r.types : {})) {
    if (!k || k.length > 120) continue;
    const minEur = clampNum(v?.minEur, 0, 100_000, 0), maxEur = clampNum(v?.maxEur, 0, 100_000, 0);
    types[k] = { enabled: v?.enabled === true, minEur, maxEur: maxEur && maxEur < minEur ? minEur : maxEur };
  }
  return {
    enabled: r.enabled === true,
    mode: r.mode === "auto" ? "auto" : "suggest",
    horizonDays: Math.round(clampNum(r.horizonDays, 7, 365, d.horizonDays)),
    maxChangePercent: clampNum(r.maxChangePercent, 0, 100, d.maxChangePercent),
    demand,
    lastMinute: { days: Math.round(clampNum(r.lastMinute?.days, 0, 60, d.lastMinute.days)), belowOccupancy: clampNum(r.lastMinute?.belowOccupancy, 0, 100, d.lastMinute.belowOccupancy), percent: clampNum(r.lastMinute?.percent, -50, 50, d.lastMinute.percent) },
    earlyBird: { days: Math.round(clampNum(r.earlyBird?.days, 0, 365, d.earlyBird.days)), percent: clampNum(r.earlyBird?.percent, -50, 50, d.earlyBird.percent) },
    weekendPercent: clampNum(r.weekendPercent, -50, 100, 0),
    compset: { enabled: r.compset?.enabled === true, weight: clampNum(r.compset?.weight, 0, 100, d.compset.weight) },
    types,
  };
}

const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * Price of one night (cents). occupancy 0..1 for that room type and night; leadDays from today; compMedianCents is
 * the competitors' median for the night or null. Returns the price and the reasons (for the PMS to show).
 */
export function autoPrice({ baseCents, occupancy, leadDays, date, compMedianCents = null, settings, type }) {
  const s = settings, t = s.types[type] ?? { minEur: 0, maxEur: 0 }, reasons = [];
  let percent = 0;
  const occ = occupancy * 100, band = s.demand.find((b) => occ >= b.occupancy);
  if (band && band.percent) { percent += band.percent; reasons.push(`demand ${Math.round(occ)}% → ${band.percent > 0 ? "+" : ""}${band.percent}%`); }
  if (s.lastMinute.days && leadDays <= s.lastMinute.days && occ < s.lastMinute.belowOccupancy && s.lastMinute.percent) { percent += s.lastMinute.percent; reasons.push(`last minute ${s.lastMinute.percent}%`); }
  if (s.earlyBird.days && leadDays >= s.earlyBird.days && s.earlyBird.percent) { percent += s.earlyBird.percent; reasons.push(`early ${s.earlyBird.percent}%`); }
  if (s.weekendPercent && [5, 6].includes(weekday(date))) { percent += s.weekendPercent; reasons.push(`weekend ${s.weekendPercent > 0 ? "+" : ""}${s.weekendPercent}%`); }
  let cents = baseCents * (1 + percent / 100);
  if (s.compset.enabled && compMedianCents && compMedianCents > 0) {
    const moved = cents + (compMedianCents - cents) * (s.compset.weight / 100);
    if (Math.round(moved) !== Math.round(cents)) reasons.push(`competitors €${Math.round(compMedianCents / 100)}`);
    cents = moved;
  }
  const lo = baseCents * (1 - s.maxChangePercent / 100), hi = baseCents * (1 + s.maxChangePercent / 100);
  cents = Math.min(hi, Math.max(lo, cents));
  if (t.minEur && cents < t.minEur * 100) { cents = t.minEur * 100; reasons.push(`minimum €${t.minEur}`); }
  if (t.maxEur && cents > t.maxEur * 100) { cents = t.maxEur * 100; reasons.push(`maximum €${t.maxEur}`); }
  // Whole euros, so the guest and the OTAs see round prices.
  return { cents: Math.max(0, Math.round(cents / 100) * 100), reasons };
}
