import { db } from "@/lib/db";
import { addDays, hotelToday } from "@/lib/tape-chart";
import { buildSuggestions, suggestionKey, type Suggestion } from "@/lib/pricing-suggestions";

const HORIZON_DAYS = 60;

/** Open suggestions for the next 60 days (already approved or dismissed ones are hidden). */
export async function openSuggestions(ownerId: string): Promise<(Suggestion & { key: string; rooms: number })[]> {
  const today = hotelToday();
  const [loads, decided] = await Promise.all([
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
  ]);
  const done = new Set(decided.rows.map((r) => String(r.suggestion_key)));
  const totals = new Map<string, number>();
  for (const r of loads.rows) totals.set(String(r.room_type), Math.max(totals.get(String(r.room_type)) ?? 0, Number(r.total)));
  return buildSuggestions(loads.rows.map((r) => ({ date: String(r.date), roomType: String(r.room_type), occupied: Number(r.occupied), total: Number(r.total) })), today)
    .map((s) => ({ ...s, key: suggestionKey(s), rooms: totals.get(s.roomType) ?? 0 }))
    .filter((s) => !done.has(s.key));
}
