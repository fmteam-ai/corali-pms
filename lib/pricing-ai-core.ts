// Pure parts of the AI price recommendations (lib/pricing-ai): weekly aggregation of the data Claude sees and the
// guard rails applied to what it proposes. Unit tested.
import { addDays } from "./tape-chart.ts";

export const PRICING_HORIZON_DAYS = 63; // nine weeks
export const MAX_CHANGE = 0.35; // recommendations are kept within ±35% of the current price

export type RawRecommendation = { room_type: string; starts_on: string; ends_on: string; recommended_rate_eur: number; confidence: "low" | "medium" | "high"; reasoning: string };
export type PricingRecommendation = RawRecommendation & { current_rate_eur: number; change_percent: number };
export type WeekRow = { roomType: string; startsOn: string; endsOn: string; rooms: number; rateEur: number; occupancy: number; lastYearOccupancy: number | null; recentBookings: number; compMedianEur: number | null; compMinEur: number | null; compMaxEur: number | null };
export type DayRow = { date: string; roomType: string; total: number; occupied: number; rateCents: number; lastYear: number | null; recent: number };

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** Weekly figures per room category for the next nine weeks, from daily rows and competitor rates per date (cents). */
export function weeklyRows(today: string, days: DayRow[], comp: Map<string, number[]>): WeekRow[] {
  const out: WeekRow[] = [];
  const types = [...new Set(days.map((d) => d.roomType))].sort();
  for (const type of types) {
    for (let w = 0; w * 7 < PRICING_HORIZON_DAYS; w++) {
      const start = addDays(today, w * 7), end = addDays(today, w * 7 + 6);
      const week = days.filter((d) => d.roomType === type && d.date >= start && d.date <= end && d.total > 0);
      if (!week.length) continue;
      const compRates = week.flatMap((d) => comp.get(d.date) ?? []);
      const ly = week.filter((d) => d.lastYear !== null);
      out.push({
        roomType: type, startsOn: start, endsOn: end, rooms: Math.max(...week.map((d) => d.total)),
        rateEur: Math.round(week.reduce((a, d) => a + d.rateCents, 0) / week.length / 100),
        occupancy: Math.round((week.reduce((a, d) => a + d.occupied, 0) / week.reduce((a, d) => a + d.total, 0)) * 100),
        lastYearOccupancy: ly.length ? Math.round((ly.reduce((a, d) => a + (d.lastYear ?? 0), 0) / ly.reduce((a, d) => a + d.total, 0)) * 100) : null,
        recentBookings: week.reduce((a, d) => a + d.recent, 0),
        compMedianEur: compRates.length ? Math.round(median(compRates)! / 100) : null,
        compMinEur: compRates.length ? Math.round(Math.min(...compRates) / 100) : null,
        compMaxEur: compRates.length ? Math.round(Math.max(...compRates) / 100) : null,
      });
    }
  }
  return out;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Keep a recommendation inside ±35% of the current price and in whole euros; drop ones for unknown categories/dates. */
export function clampRecommendation(r: RawRecommendation, weeks: WeekRow[]): PricingRecommendation | null {
  if (!isoDate.test(r.starts_on) || !isoDate.test(r.ends_on) || r.ends_on < r.starts_on) return null;
  const covered = weeks.filter((w) => w.roomType === r.room_type && w.endsOn >= r.starts_on && w.startsOn <= r.ends_on);
  if (!covered.length) return null;
  const current = Math.round(covered.reduce((a, w) => a + w.rateEur, 0) / covered.length);
  if (!(current > 0)) return null;
  const asked = Number(r.recommended_rate_eur);
  const rate = Math.round(Math.min(current * (1 + MAX_CHANGE), Math.max(current * (1 - MAX_CHANGE), Number.isFinite(asked) && asked > 0 ? asked : current)));
  return { ...r, recommended_rate_eur: rate, current_rate_eur: current, change_percent: Math.round(((rate - current) / current) * 100) };
}
