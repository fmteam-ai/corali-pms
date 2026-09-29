import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isIsoDate } from "@/lib/tape-chart";

/** Free rooms per room type for a date range (front desk "Check availability"): excludes out-of-order rooms, bookings and online holds. */
export async function GET(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const q = new URL(request.url).searchParams;
  const checkIn = q.get("checkIn"), checkOut = q.get("checkOut"), guests = Math.max(1, Math.min(20, Number(q.get("guests")) || 1));
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) return Response.json({ ok: false, error: "INVALID_DATES" }, { status: 400 });
  const r = await db().query(
    `SELECT r.room_type,count(*)::int AS total,
            count(*) FILTER (WHERE r.operational_status<>'out_of_order' AND r.capacity>=$4
              AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status NOT IN ('cancelled','checked_out','no_show') AND b.check_in<$3 AND b.check_out>$2)
              AND NOT EXISTS(SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>(extract(epoch from now())*1000)::bigint AND s.check_in<$3 AND s.check_out>$2 AND s.room_allocations::jsonb @> jsonb_build_array(r.id)))::int AS free,
            min(r.base_rate_cents)::bigint AS from_cents,max(r.capacity)::int AS capacity,
            (array_agg(r.id ORDER BY r.code) FILTER (WHERE r.operational_status<>'out_of_order' AND r.capacity>=$4
              AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status NOT IN ('cancelled','checked_out','no_show') AND b.check_in<$3 AND b.check_out>$2)))[1] AS first_free_room
       FROM rooms r WHERE r.owner_id=$1 AND r.active=1 GROUP BY r.room_type ORDER BY r.room_type`,
    [u.ownerId, checkIn, checkOut, guests],
  );
  return Response.json({ ok: true, checkIn, checkOut, types: r.rows.map((x) => ({ roomType: x.room_type, total: Number(x.total), free: Number(x.free), fromCents: Number(x.from_cents), capacity: Number(x.capacity), firstFreeRoom: x.first_free_room ? Number(x.first_free_room) : null })) }, { headers: { "Cache-Control": "no-store" } });
}
