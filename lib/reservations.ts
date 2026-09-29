import { db } from "@/lib/db";

export type ReservationRow = {
  id: number; reference: string; guest_name: string; guest_email: string | null; guest_phone: string;
  guest_country: string; guest_language: string; room_id: number | null; room_code: string | null;
  room_type: string | null; check_in: string; check_out: string; channel: string; status: string;
  adults: number; children: number; total_cents: number; balance_cents: number; rate_policy: string;
  cancellation_days: number; special_requests: string; version: number;
};

const select = `SELECT b.*, r.code AS room_code, r.room_type
  FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id`;

export async function listReservations(ownerId: string, query = ""): Promise<ReservationRow[]> {
  const term = `%${query.trim()}%`;
  const result = await db().query({
    text: `${select} WHERE b.owner_id=$1 AND ($2='%%' OR b.reference ILIKE $2 OR b.guest_name ILIKE $2 OR COALESCE(b.guest_email,'') ILIKE $2)
      ORDER BY b.check_in DESC, b.id DESC LIMIT 500`,
    values: [ownerId, term],
  });
  return result.rows;
}

export async function getReservation(ownerId: string, id: number) {
  const [booking, folio, audit] = await Promise.all([
    db().query(`${select} WHERE b.owner_id=$1 AND b.id=$2 LIMIT 1`, [ownerId, id]),
    db().query("SELECT * FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at,id", [ownerId, id]),
    db().query("SELECT * FROM reservation_audit WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100", [ownerId, id]),
  ]);
  return booking.rows[0] ? { booking: booking.rows[0] as ReservationRow, folio: folio.rows, audit: audit.rows } : null;
}
