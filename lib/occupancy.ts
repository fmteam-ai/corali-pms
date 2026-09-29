import { db } from "@/lib/db";

export type DayOccupancy = { day: string; arrivals: number; departures: number; occupied: number };

/** Per-day arrivals, departures and occupied rooms for [start, start+days). Cancelled and no-show stays are excluded. */
export async function dailyOccupancy(ownerId: string, start: string, days: number): Promise<DayOccupancy[]> {
  const span = Math.min(62, Math.max(1, Math.trunc(days)));
  const result = await db().query(
    `SELECT d.day::date::text AS day,
            count(DISTINCT b.id) FILTER (WHERE b.check_in::date=d.day::date)::int AS arrivals,
            count(DISTINCT b.id) FILTER (WHERE b.check_out::date=d.day::date)::int AS departures,
            count(DISTINCT b.room_id) FILTER (WHERE b.check_in::date<=d.day::date AND b.check_out::date>d.day::date)::int AS occupied
       FROM generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') AS d(day)
       LEFT JOIN bookings b ON b.owner_id=$1 AND b.status IN ('confirmed','checked_in','checked_out')
            AND b.check_in::date<=d.day::date AND b.check_out::date>=d.day::date
      GROUP BY d.day ORDER BY d.day`,
    [ownerId, start, span],
  );
  return result.rows.map((row) => ({ day: String(row.day), arrivals: Number(row.arrivals), departures: Number(row.departures), occupied: Number(row.occupied) }));
}

export async function activeRoomCount(ownerId: string): Promise<number> {
  const result = await db().query(`SELECT count(*)::int AS total FROM rooms WHERE owner_id=$1 AND active=1`, [ownerId]);
  return Number(result.rows[0]?.total ?? 0);
}
