// Rule-based dynamic pricing suggestions (pure; unit tested). Suggestions never change prices on their own:
// a manager must approve each one, which creates a special price.

export type DayLoad = { date: string; roomType: string; occupied: number; total: number };
export type Suggestion = { roomType: string; startsOn: string; endsOn: string; percent: number; reason: "high_demand" | "strong_demand" | "low_demand_close_in" | "very_low_close_in"; averageOccupancy: number };

function lead(today: string, date: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Suggested adjustment for one day: raise when demand is high, discount close-in dates that are still empty. */
export function dayAdjustment(occupancy: number, leadDays: number): { percent: number; reason: Suggestion["reason"] } | null {
  if (leadDays < 0) return null;
  if (occupancy >= 0.85 && leadDays <= 45) return { percent: 15, reason: "high_demand" };
  if (occupancy >= 0.7 && leadDays <= 30) return { percent: 10, reason: "strong_demand" };
  if (occupancy <= 0.2 && leadDays <= 7) return { percent: -15, reason: "very_low_close_in" };
  if (occupancy <= 0.35 && leadDays <= 14) return { percent: -10, reason: "low_demand_close_in" };
  return null;
}

/** Consecutive days of a room type with the same suggestion become one range (endsOn inclusive). */
export function buildSuggestions(days: DayLoad[], today: string): Suggestion[] {
  const out: (Suggestion & { sum: number; count: number })[] = [];
  const sorted = [...days].filter((d) => d.total > 0).sort((a, b) => a.roomType.localeCompare(b.roomType) || a.date.localeCompare(b.date));
  for (const d of sorted) {
    const occupancy = d.occupied / d.total;
    const adj = dayAdjustment(occupancy, lead(today, d.date));
    if (!adj) continue;
    const last = out.at(-1);
    const next = last ? new Date(`${last.endsOn}T00:00:00Z`) : null;
    next?.setUTCDate(next.getUTCDate() + 1);
    if (last && last.roomType === d.roomType && last.percent === adj.percent && next?.toISOString().slice(0, 10) === d.date) {
      last.endsOn = d.date;
      last.sum += occupancy;
      last.count += 1;
    } else {
      out.push({ roomType: d.roomType, startsOn: d.date, endsOn: d.date, percent: adj.percent, reason: adj.reason, averageOccupancy: 0, sum: occupancy, count: 1 });
    }
  }
  return out.map(({ sum, count, ...s }) => ({ ...s, averageOccupancy: Math.round((sum / count) * 100) / 100 }));
}

/** Stable key so a dismissed/approved suggestion is not shown again. */
export function suggestionKey(s: Pick<Suggestion, "roomType" | "startsOn" | "endsOn" | "percent">) {
  return `${s.roomType}|${s.startsOn}|${s.endsOn}|${s.percent}`;
}

export type CompsetNote = { compsetIndex: number | null; compsetMedianCents: number | null; compsetAdjusted: boolean };

/**
 * Temper a demand-based suggestion with the competitor rate index (our rate as % of the compset median):
 * don't push further above a market we already out-price, halve discounts when we are already cheaper,
 * and add 5 points to a raise when we sell well below the market.
 */
export function applyCompset<T extends Suggestion>(s: T, index: number | null, medianCents: number | null = null): T & CompsetNote {
  let percent = s.percent;
  if (index !== null) {
    if (percent > 0 && index >= 110) percent = Math.min(percent, 5);
    else if (percent > 0 && index <= 90) percent = Math.min(20, percent + 5);
    else if (percent < 0 && index <= 90) percent = -Math.round(Math.abs(percent) / 2);
  }
  return { ...s, percent, compsetIndex: index, compsetMedianCents: medianCents, compsetAdjusted: percent !== s.percent };
}
