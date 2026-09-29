import { db } from "@/lib/db";
import { addDays, hotelToday } from "@/lib/tape-chart";
import { applyCompset, buildSuggestions, suggestionKey, type CompsetNote, type Suggestion } from "@/lib/pricing-suggestions";
import { compsetIndex } from "@/lib/revenue-analytics";

const HORIZON_DAYS = 60;

/** Open suggestions for the next 60 days (already approved or dismissed ones are hidden). */
export async function openSuggestions(ownerId: string): Promise<(Suggestion & CompsetNote & { key: string; rooms: number })[]> {
  const today = hotelToday();
  const [loads, decided, ours, comp] = await Promise.all([
    db().query(
      `SELECT d.day::date::text AS date, r.room_type,
              count(DISTINCT r.id)::int AS total,
              count(DISTINCT b.room_id)::int AS occupied
         FROM generate_series($2::date,$3::date,interval '1 day') AS d(day)
         JOIN rooms r ON r.owner_id=$1 AND r.active=1 AND r.operational_status<>'out_of_order'
         LEFT JOIN bookings b ON b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in')
              AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text
        GROUP BY d.day, r.room_type`,
      [ownerId, today, addDays(today, HORIZON_DAYS)],
    ),
    db().query(`SELECT suggestion_key FROM pricing_suggestion_decisions WHERE owner_id=$1`, [ownerId]),
    // Our reference rate per room type and night, and the competitor rates for the same nights.
    db().query(
      `SELECT d.day::date::text AS date, r.room_type,
              min(COALESCE((SELECT rr.price_cents FROM rate_rules rr WHERE rr.owner_id=r.owner_id AND (rr.room_type IS NULL OR rr.room_type='' OR rr.room_type=r.room_type) AND rr.starts_on<=d.day::date::text AND rr.ends_on>=d.day::date::text AND rr.price_cents IS NOT NULL ORDER BY rr.id DESC LIMIT 1), r.base_rate_cents))::bigint AS rate
         FROM generate_series($2::date,$3::date,interval '1 day') AS d(day) JOIN rooms r ON r.owner_id=$1 AND r.active=1
        GROUP BY d.day, r.room_type`,
      [ownerId, today, addDays(today, HORIZON_DAYS)],
    ),
    db().query(`SELECT cr.stay_date,cr.rate_cents FROM competitor_rates cr JOIN competitors c ON c.id=cr.competitor_id AND c.owner_id=cr.owner_id AND c.active=1 WHERE cr.owner_id=$1 AND cr.stay_date>=$2 AND cr.stay_date<=$3 AND cr.sold_out=0 AND cr.rate_cents IS NOT NULL`, [ownerId, today, addDays(today, HORIZON_DAYS)]),
  ]);
  const done = new Set(decided.rows.map((r) => String(r.suggestion_key)));
  const totals = new Map<string, number>();
  for (const r of loads.rows) totals.set(String(r.room_type), Math.max(totals.get(String(r.room_type)) ?? 0, Number(r.total)));
  const ourRate = new Map(ours.rows.map((r) => [`${r.room_type}|${r.date}`, Number(r.rate)]));
  const compByDate = new Map<string, number[]>();
  for (const r of comp.rows) compByDate.set(String(r.stay_date), [...(compByDate.get(String(r.stay_date)) ?? []), Number(r.rate_cents)]);
  // Average compset index over the suggestion's nights that have competitor data.
  const compset = (s: Suggestion) => {
    const idx: number[] = [], med: number[] = [];
    for (let d = s.startsOn; d <= s.endsOn; d = addDays(d, 1)) {
      const c = compsetIndex(ourRate.get(`${s.roomType}|${d}`) ?? 0, compByDate.get(d) ?? []);
      if (c.index !== null) { idx.push(c.index); med.push(c.median!); }
    }
    return idx.length ? { index: Math.round(idx.reduce((a, b) => a + b, 0) / idx.length), median: Math.round(med.reduce((a, b) => a + b, 0) / med.length) } : { index: null, median: null };
  };
  return buildSuggestions(loads.rows.map((r) => ({ date: String(r.date), roomType: String(r.room_type), occupied: Number(r.occupied), total: Number(r.total) })), today)
    .map((s) => { const c = compset(s); return applyCompset(s, c.index, c.median); })
    .map((s) => ({ ...s, key: suggestionKey(s), rooms: totals.get(s.roomType) ?? 0 }))
    .filter((s) => !done.has(s.key));
}
