"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, barSpan, hasUnpaidBalance, housekeepingColors, housekeepingState, nightsBetween, tapeStatus, tapeStatusColors, type HousekeepingState, type TapeStatus } from "@/lib/tape-chart";

type Room = { id: number; code: string; room_type: string; capacity: number; operational_status: string; open_task_status: string | null };
type Booking = { id: number; reference: string; guest_name: string; room_id: number; check_in: string; check_out: string; status: string; balance_cents: number; total_cents: number; adults: number; children: number; channel: string; version: number };
type Hold = { id: number; roomId: number; guestName: string; checkIn: string; checkOut: string };

const statusLabels: Record<TapeStatus, string> = {
  confirmed: "Επιβεβαιωμένη",
  check_in_due: "Άφιξη σήμερα / εκκρεμεί check-in",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Ακυρωμένη",
  tentative: "Προσωρινή δέσμευση",
};
const housekeepingLabels: Record<HousekeepingState, string> = {
  clean: "Καθαρό",
  dirty: "Βρώμικο",
  cleaning: "Καθαρισμός σε εξέλιξη",
  inspection_pending: "Αναμονή επιθεώρησης",
  out_of_order: "Εκτός λειτουργίας",
};
const errors: Record<string, string> = {
  ROOM_UNAVAILABLE: "Το δωμάτιο δεν είναι διαθέσιμο για αυτές τις ημερομηνίες.",
  VERSION_CONFLICT: "Η κράτηση άλλαξε από άλλο χρήστη. Ανανεώστε τη σελίδα.",
  INVALID_TRANSITION: "Η ενέργεια δεν επιτρέπεται στην τρέχουσα κατάσταση της κράτησης.",
  INVALID_INPUT: "Μη έγκυρες ημερομηνίες.",
  INVALID_ROOM: "Μη έγκυρο δωμάτιο.",
  ROOM_OUT_OF_ORDER: "Το δωμάτιο είναι εκτός λειτουργίας.",
  FORBIDDEN: "Δεν έχετε δικαίωμα για αυτή την ενέργεια.",
};
const CELL = 46;
const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("el-GR", { weekday: "short", timeZone: "UTC" });
const dayMonth = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const HkDot = ({ state }: { state: HousekeepingState }) => <i className="hkDot" style={{ background: housekeepingColors[state] }} aria-hidden="true" />;

export function RoomGrid({ start, today, days, showCancelled, canCreate, canEdit, rooms, initialBookings, holds }: { start: string; today: string; days: number; showCancelled: boolean; canCreate: boolean; canEdit: boolean; rooms: Room[]; initialBookings: Booking[]; holds: Hold[] }) {
  const router = useRouter();
  const [bookings, setBookings] = useState(initialBookings);
  const [message, setMessage] = useState("");
  const [menu, setMenu] = useState<Booking | null>(null);
  const [dates, setDates] = useState({ checkIn: "", checkOut: "" });
  const [busy, setBusy] = useState(false);
  const columns = useMemo(() => Array.from({ length: days }, (_, i) => addDays(start, i)), [start, days]);
  const active = bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show");
  const occupiedNights = columns.reduce((sum, date) => sum + active.filter((b) => b.check_in <= date && b.check_out > date).length, 0);
  const occupancy = rooms.length ? Math.round((occupiedNights / (rooms.length * days)) * 100) : 0;

  function navigate(nextStart: string, cancelled = showCancelled) {
    router.push(`/pms/rooms?start=${nextStart}${cancelled ? "&cancelled=1" : ""}`);
  }

  async function patch(booking: Booking, body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/pms/reservations/${booking.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: booking.version, ...body }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(errors[data.error] ?? "Η ενέργεια απέτυχε.");
        return false;
      }
      setBookings((rows) => rows.map((row) => (row.id === booking.id ? { ...row, ...data.booking } : row)));
      setMessage(success);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function move(id: number, roomId: number, checkIn: string) {
    const booking = bookings.find((b) => b.id === id);
    if (!booking || !canEdit) return;
    const nights = Math.max(1, nightsBetween(booking.check_in, booking.check_out));
    if (booking.room_id === roomId && booking.check_in === checkIn) return;
    await patch(booking, { action: "move", roomId, checkIn, checkOut: addDays(checkIn, nights) }, "Η κράτηση μετακινήθηκε.");
  }

  function openMenu(booking: Booking) {
    setMenu(booking);
    setDates({ checkIn: booking.check_in, checkOut: booking.check_out });
  }

  async function quickAction(action: "check_in" | "check_out" | "move") {
    if (!menu) return;
    const body = action === "move" ? { action, roomId: menu.room_id, checkIn: dates.checkIn, checkOut: dates.checkOut } : { action };
    const ok = await patch(menu, body, action === "move" ? "Οι ημερομηνίες ενημερώθηκαν." : "Η κατάσταση ενημερώθηκε.");
    if (ok) setMenu(null);
  }

  return (
    <>
      <div className="tapeToolbar">
        <div className="tapeNav">
          <button type="button" onClick={() => navigate(addDays(start, -7))} aria-label="Προηγούμενη εβδομάδα">‹ 7</button>
          <button type="button" onClick={() => navigate(addDays(today, -2))}>Σήμερα</button>
          <button type="button" onClick={() => navigate(addDays(start, 7))} aria-label="Επόμενη εβδομάδα">7 ›</button>
          <input type="date" value={start} onChange={(e) => e.target.value && navigate(e.target.value)} aria-label="Έναρξη πλάνου" />
          <label className="tapeToggle"><input type="checkbox" checked={showCancelled} onChange={(e) => navigate(start, e.target.checked)} /> Ακυρωμένες</label>
        </div>
        <p className="tapeOccupancy"><b>{occupancy}%</b> πληρότητα περιόδου · {rooms.length} δωμάτια</p>
      </div>
      <div className="tapeLegend" aria-label="Υπόμνημα">
        {(Object.keys(tapeStatusColors) as TapeStatus[]).map((key) => <span key={key}><i style={{ background: tapeStatusColors[key] }} />{statusLabels[key]}</span>)}
        <span><i className="legendUnpaid" />Ανεξόφλητο υπόλοιπο</span>
        {(Object.keys(housekeepingColors) as HousekeepingState[]).map((key) => <span key={key}><HkDot state={key} />{housekeepingLabels[key]}</span>)}
      </div>
      <p className="notice" aria-live="polite">{message}</p>
      <div className="tape" style={{ ["--tape-days" as string]: days }}>
        <div className="tapeHead">
          <b>Δωμάτιο</b>
          {columns.map((d) => <span key={d} className={d === today ? "today" : undefined}><small>{weekday(d)}</small>{dayMonth(d)}</span>)}
        </div>
        {rooms.map((room) => {
          const hk = housekeepingState(room.operational_status, room.open_task_status);
          const roomBookings = bookings.filter((b) => b.room_id === room.id);
          const roomHolds = holds.filter((h) => h.roomId === room.id);
          return (
            <div className="tapeRow" key={room.id}>
              <b>
                <span title={housekeepingLabels[hk]} role="img" aria-label={housekeepingLabels[hk]}><HkDot state={hk} /></span> {room.code}
                <small>{room.room_type} · {room.capacity} άτομα</small>
              </b>
              {columns.map((date) => (
                <div
                  key={date}
                  className={`slot${date === today ? " today" : ""}${hk === "out_of_order" ? " ooo" : ""}`}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); void move(Number(e.dataTransfer.getData("bookingId")), room.id, date); }}
                  onDoubleClick={() => {
                    const occupied = roomBookings.some((b) => b.status !== "cancelled" && b.status !== "no_show" && b.check_in <= date && b.check_out > date);
                    if (!occupied && canCreate) router.push(`/pms/reservations/new?roomId=${room.id}&checkIn=${date}&checkOut=${addDays(date, 1)}`);
                  }}
                  title={canCreate ? "Διπλό κλικ για νέα κράτηση" : undefined}
                />
              ))}
              {roomBookings.map((booking) => {
                const span = barSpan(booking.check_in, booking.check_out, start, days);
                if (!span) return null;
                const status = tapeStatus(booking.status, booking.check_in, today);
                const unpaid = hasUnpaidBalance(booking.status, Number(booking.balance_cents));
                const cancelled = status === "cancelled";
                return (
                  <button
                    key={`b${booking.id}`}
                    type="button"
                    draggable={canEdit && (booking.status === "confirmed" || booking.status === "checked_in")}
                    onDragStart={(e) => e.dataTransfer.setData("bookingId", String(booking.id))}
                    onContextMenu={(e) => { e.preventDefault(); openMenu(booking); }}
                    onClick={() => openMenu(booking)}
                    className={`bookingBar${unpaid ? " unpaid" : ""}${cancelled ? " cancelledBar" : ""}${span.clippedStart ? " clipStart" : ""}${span.clippedEnd ? " clipEnd" : ""}`}
                    style={{ left: `calc(var(--tape-room-col) + ${span.offset * CELL + 2}px)`, width: span.length * CELL - 4, background: tapeStatusColors[status] }}
                    title={`${booking.guest_name} · ${booking.reference}\n${booking.check_in} → ${booking.check_out}\n${statusLabels[status]}${unpaid ? `\nΥπόλοιπο ${euro(Number(booking.balance_cents))}` : ""}`}
                  >
                    {unpaid && <span aria-label="Ανεξόφλητο">€ </span>}{booking.guest_name}
                  </button>
                );
              })}
              {roomHolds.map((hold) => {
                const span = barSpan(hold.checkIn, hold.checkOut, start, days);
                if (!span) return null;
                return (
                  <span
                    key={`h${hold.id}-${hold.roomId}`}
                    className="bookingBar holdBar"
                    style={{ left: `calc(var(--tape-room-col) + ${span.offset * CELL + 2}px)`, width: span.length * CELL - 4, background: tapeStatusColors.tentative }}
                    title={`${hold.guestName} · online πληρωμή σε εξέλιξη\n${hold.checkIn} → ${hold.checkOut}`}
                  >
                    {hold.guestName || "Online κράτηση"}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      {menu && (
        <div className="quickMenu" role="dialog" aria-label={menu.guest_name}>
          <b>{menu.guest_name}</b>
          <small>{menu.reference} · {menu.check_in} → {menu.check_out} · {menu.adults}+{menu.children} · {menu.channel}</small>
          <small>Σύνολο {euro(Number(menu.total_cents))} · Υπόλοιπο {euro(Number(menu.balance_cents))}</small>
          {canEdit && menu.status === "confirmed" && menu.check_in <= today && <button disabled={busy} onClick={() => quickAction("check_in")}>Check-in</button>}
          {canEdit && menu.status === "checked_in" && <button disabled={busy} onClick={() => quickAction("check_out")}>Check-out</button>}
          {canEdit && (menu.status === "confirmed" || menu.status === "checked_in") && (
            <fieldset className="quickDates">
              <legend>Αλλαγή ημερομηνιών</legend>
              <label>Άφιξη<input type="date" value={dates.checkIn} disabled={menu.status === "checked_in"} onChange={(e) => setDates((d) => ({ ...d, checkIn: e.target.value }))} /></label>
              <label>Αναχώρηση<input type="date" value={dates.checkOut} min={addDays(dates.checkIn || menu.check_in, 1)} onChange={(e) => setDates((d) => ({ ...d, checkOut: e.target.value }))} /></label>
              <button disabled={busy || !dates.checkIn || !dates.checkOut || dates.checkOut <= dates.checkIn || (dates.checkIn === menu.check_in && dates.checkOut === menu.check_out)} onClick={() => quickAction("move")}>Αποθήκευση ημερομηνιών</button>
            </fieldset>
          )}
          <button onClick={() => router.push(`/pms/reservations/${menu.id}`)}>Folio / στοιχεία</button>
          <button className="close" onClick={() => setMenu(null)}>Κλείσιμο</button>
        </div>
      )}
    </>
  );
}
