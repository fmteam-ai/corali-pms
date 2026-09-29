import { db } from "@/lib/db";
import { reservationSearchTerms } from "@/lib/reservation-search";

export { reservationSearchTerms };

export type ReservationRow = {
  id: number; reference: string; guest_name: string; guest_email: string | null; guest_phone: string;
  guest_country: string; guest_language: string; room_id: number | null; room_code: string | null;
  room_type: string | null; check_in: string; check_out: string; channel: string; status: string;
  adults: number; children: number; total_cents: number; balance_cents: number; rate_policy: string;
  cancellation_days: number; special_requests: string; version: number;
};

const select = `SELECT b.*, r.code AS room_code, r.room_type
  FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id`;

const searchWhere = `b.owner_id=$1 AND ($2='%%' OR b.reference ILIKE $2 OR b.guest_name ILIKE $2 OR COALESCE(b.guest_email,'') ILIKE $2
  OR ($3<>'' AND regexp_replace(COALESCE(b.guest_phone,''),'\\D','','g') LIKE $3) OR r.code ILIKE $4)`;

export async function listReservations(ownerId: string, query = ""): Promise<ReservationRow[]> {
  const terms = reservationSearchTerms(query);
  const result = await db().query({
    text: `${select} WHERE ${searchWhere} ORDER BY b.check_in DESC, b.id DESC LIMIT 500`,
    values: [ownerId, terms.text, terms.digits, terms.room],
  });
  return result.rows;
}

/** Quick search: current and upcoming stays first, then the most recent past ones. */
export async function searchReservations(ownerId: string, query: string, limit = 10) {
  const terms = reservationSearchTerms(query);
  const result = await db().query({
    text: `SELECT b.id,b.reference,b.guest_name,b.guest_phone,b.check_in,b.check_out,b.status,r.code AS room_code
      FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id
      WHERE ${searchWhere}
      ORDER BY (b.check_out >= (now() AT TIME ZONE 'Europe/Athens')::date::text AND b.status NOT IN ('cancelled','no_show')) DESC, abs((b.check_in::date - (now() AT TIME ZONE 'Europe/Athens')::date)) ASC, b.id DESC
      LIMIT $5`,
    values: [ownerId, terms.text, terms.digits, terms.room, limit],
  });
  return result.rows as { id: number; reference: string; guest_name: string; guest_phone: string; check_in: string; check_out: string; status: string; room_code: string | null }[];
}

export async function getReservation(ownerId: string, id: number) {
  const [booking, folio, audit] = await Promise.all([
    db().query(`${select} WHERE b.owner_id=$1 AND b.id=$2 LIMIT 1`, [ownerId, id]),
    db().query("SELECT * FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at,id", [ownerId, id]),
    db().query("SELECT * FROM reservation_audit WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100", [ownerId, id]),
  ]);
  return booking.rows[0] ? { booking: booking.rows[0] as ReservationRow, folio: folio.rows, audit: audit.rows } : null;
}
