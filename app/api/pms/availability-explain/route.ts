import { requireApiUser } from "@/lib/auth";
import { explainAvailability, type ExplainRoom } from "@/lib/availability-explain";
import { db } from "@/lib/db";
import { isIsoDate } from "@/lib/tape-chart";

/** For a stay and party: every room with whether the booking engine offers it, and why not. */
export async function GET(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const q = new URL(request.url).searchParams;
  const checkIn = q.get("checkIn"), checkOut = q.get("checkOut");
  const n = (k: string, d: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(Number(q.get(k) ?? d)) || d));
  const adults = n("adults", 2, 1, 20), children = n("children", 0, 0, 10), rooms = n("rooms", 1, 1, 10), lang = q.get("lang") === "en" ? "en" : "el";
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) return Response.json({ ok: false, error: "INVALID_DATES" }, { status: 400 });
  const [roomRows, bookings, holds, rateRules, restrictions, minStay] = await Promise.all([
    db().query(`SELECT r.id,r.code,r.room_type,r.capacity,r.active,r.operational_status,r.base_rate_cents,COALESCE(NULLIF(CASE WHEN $2='en' THEN c.name_en ELSE c.name_el END,''),c.name_el,c.name_en,'') AS category FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id AND c.owner_id=r.owner_id WHERE r.owner_id=$1 ORDER BY COALESCE(c.display_order,999),r.code`, [u.ownerId, lang]),
    db().query(`SELECT room_id,reference,check_in,check_out FROM bookings WHERE owner_id=$1 AND room_id IS NOT NULL AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$3 AND check_out>$2`, [u.ownerId, checkIn, checkOut]),
    db().query(`SELECT room_allocations FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>$4 AND check_in<$3 AND check_out>$2`, [u.ownerId, checkIn, checkOut, Date.now()]),
    db().query(`SELECT id,room_type,room_codes,weekdays,active,updated_at,starts_on,ends_on,price_cents,minimum_stay,maximum_stay,closed,closed_to_arrival,closed_to_departure FROM rate_rules WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY id`, [u.ownerId, checkIn, checkOut]),
    db().query(`SELECT name,starts_on,ends_on,minimum_stay,maximum_stay,closed_arrival_weekdays,closed_departure_weekdays,room_codes,rate_plan_keys FROM booking_restrictions WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2`, [u.ownerId, checkIn, checkOut]),
    db().query(`SELECT id,room_type,starts_on,ends_on,min_nights,active,updated_at FROM min_stay_rules WHERE owner_id=$1 AND active=1`, [u.ownerId]),
  ]);
  const held = holds.rows.flatMap((h) => { try { const v = JSON.parse(String(h.room_allocations ?? "[]")); return Array.isArray(v) ? v.map(Number) : []; } catch { return []; } });
  const result = explainAvailability({
    checkIn, checkOut, adults, children, rooms,
    roomList: roomRows.rows.map((r) => ({ ...r, id: Number(r.id), capacity: Number(r.capacity), active: Number(r.active), base_rate_cents: Number(r.base_rate_cents) }) as ExplainRoom),
    bookings: bookings.rows.map((b) => ({ ...b, room_id: Number(b.room_id) })), holds: held,
    rateRules: rateRules.rows, restrictions: restrictions.rows, minStay: minStay.rows,
  });
  return Response.json({ ok: true, rooms: result }, { headers: { "Cache-Control": "no-store" } });
}
