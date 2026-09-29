import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/security/permissions";
import { addDays, heldRoomIds, hotelToday, isIsoDate } from "@/lib/tape-chart";
import { RoomGrid } from "./grid";

const DAYS = 31;

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ start?: string; cancelled?: string }> }) {
  const user = await requireUser("rooms.read");
  const params = await searchParams;
  const today = hotelToday();
  const start = isIsoDate(params.start) ? params.start : addDays(today, -2);
  const end = addDays(start, DAYS);
  const showCancelled = params.cancelled === "1";
  const [rooms, bookings, holds] = await Promise.all([
    db().query(
      `SELECT r.id,r.code,r.room_type,r.capacity,r.operational_status,
              (SELECT t.status FROM housekeeping_tasks t WHERE t.owner_id=r.owner_id AND t.room_id=r.id AND t.status NOT IN ('ready') ORDER BY t.id DESC LIMIT 1) AS open_task_status
         FROM rooms r WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,
      [user.ownerId],
    ),
    db().query(
      `SELECT id,reference,guest_name,room_id,check_in,check_out,status,balance_cents,total_cents,adults,children,channel,version
         FROM bookings
        WHERE owner_id=$1 AND room_id IS NOT NULL AND check_in<$3 AND check_out>$2
          AND (status NOT IN ('cancelled','no_show') OR $4::boolean)
        ORDER BY check_in`,
      [user.ownerId, start, end, showCancelled],
    ),
    db().query(
      `SELECT id,guest_first_name,guest_last_name,check_in,check_out,room_allocations
         FROM booking_sessions
        WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>(EXTRACT(EPOCH FROM now())*1000)::bigint AND check_in<$3 AND check_out>$2`,
      [user.ownerId, start, end],
    ),
  ]);
  const holdBars = holds.rows.flatMap((h) =>
    heldRoomIds(h.room_allocations).map((roomId) => ({ id: Number(h.id), roomId, guestName: `${h.guest_first_name} ${h.guest_last_name}`.trim(), checkIn: String(h.check_in), checkOut: String(h.check_out) })),
  );
  return (
    <section>
      <div className="pageTitle">
        <div>
          <h1>Πλάνο δωματίων</h1>
          <p>Σύρετε μια κράτηση σε άλλο δωμάτιο ή ημερομηνία· κάθε αλλαγή ελέγχεται για overbooking. Διπλό κλικ σε κενό κελί ανοίγει νέα κράτηση.</p>
        </div>
        <Link className="secondaryLink" href="/pms/rooms/catalog">Κατηγορίες & χαρακτηριστικά</Link>
      </div>
      <RoomGrid
        key={`${start}-${showCancelled}`}
        start={start}
        today={today}
        days={DAYS}
        showCancelled={showCancelled}
        canCreate={can(user.role, "reservations.create", user.permissions)}
        canEdit={can(user.role, "reservations.edit", user.permissions)}
        rooms={rooms.rows}
        initialBookings={bookings.rows}
        holds={holdBars}
      />
    </section>
  );
}
