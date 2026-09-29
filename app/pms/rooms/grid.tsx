"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { NoticeModal } from "../maintenance/notice-modal";
import { addDays, barSpan, hasUnpaidBalance, housekeepingColors, housekeepingState, nightsBetween, tapeStatus, tapeStatusColors, type HousekeepingState, type TapeStatus } from "@/lib/tape-chart";

type TopNotice = { id: number; severity: string; description: string; reported_at: number; reporter: string | null; photos: number };
type Room = { id: number; code: string; room_type: string; capacity: number; operational_status: string; open_task_status: string | null; open_notices?: number; top_notice?: TopNotice | null };
type Booking = { id: number; reference: string; guest_name: string; room_id: number; check_in: string; check_out: string; status: string; balance_cents: number; total_cents: number; adults: number; children: number; channel: string; version: number };
type Hold = { id: number; roomId: number; guestName: string; checkIn: string; checkOut: string };

const CELL = 46;
const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const HkDot = ({ state }: { state: HousekeepingState }) => <i className="hkDot" style={{ background: housekeepingColors[state] }} aria-hidden="true" />;

export function RoomGrid({ lang, start, today, days, showCancelled, canCreate, canEdit, canResolve = false, canReport = false, rooms, initialBookings, holds }: { lang: PmsLang; start: string; today: string; days: number; showCancelled: boolean; canCreate: boolean; canEdit: boolean; canResolve?: boolean; canReport?: boolean; rooms: Room[]; initialBookings: Booking[]; holds: Hold[] }) {
  const router = useRouter();
  const t = pmsT(lang);
  const locale = pmsLocale(lang);
  const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  const dayMonth = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const statusLabel = (status: TapeStatus) => t(`tape.st.${status}` as PmsKey);
  const hkLabel = (state: HousekeepingState) => t(`hk.${state}` as PmsKey);
  const [bookings, setBookings] = useState(initialBookings);
  const [message, setMessage] = useState("");
  const [menu, setMenu] = useState<Booking | null>(null);
  const [dates, setDates] = useState({ checkIn: "", checkOut: "" });
  const [busy, setBusy] = useState(false);
  const [noticeRoom, setNoticeRoom] = useState<Room | null>(null);
  const when = (ms: number) => new Date(Number(ms)).toLocaleString(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
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
        setMessage(data.error && t(`err.${data.error}` as PmsKey) !== `err.${data.error}` ? t(`err.${data.error}` as PmsKey) : t("tape.failed"));
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
    await patch(booking, { action: "move", roomId, checkIn, checkOut: addDays(checkIn, nights) }, t("tape.moved"));
  }

  function openMenu(booking: Booking) {
    setMenu(booking);
    setDates({ checkIn: booking.check_in, checkOut: booking.check_out });
  }

  async function quickAction(action: "check_in" | "check_out" | "move") {
    if (!menu) return;
    const body = action === "move" ? { action, roomId: menu.room_id, checkIn: dates.checkIn, checkOut: dates.checkOut } : { action };
    const ok = await patch(menu, body, action === "move" ? t("tape.datesSaved") : t("tape.statusSaved"));
    if (ok) setMenu(null);
  }

  return (
    <>
      <div className="tapeToolbar">
        <div className="tapeNav">
          <button type="button" onClick={() => navigate(addDays(start, -7))} aria-label={t("tape.prevWeek")}>‹ 7</button>
          <button type="button" onClick={() => navigate(addDays(today, -2))}>{t("tape.today")}</button>
          <button type="button" onClick={() => navigate(addDays(start, 7))} aria-label={t("tape.nextWeek")}>7 ›</button>
          <input type="date" value={start} onChange={(e) => e.target.value && navigate(e.target.value)} aria-label={t("tape.start")} />
          <label className="tapeToggle"><input type="checkbox" checked={showCancelled} onChange={(e) => navigate(start, e.target.checked)} /> {t("tape.showCancelled")}</label>
        </div>
        <p className="tapeOccupancy"><b>{occupancy}%</b> {t("tape.occupancy", { n: rooms.length })}</p>
      </div>
      <div className="tapeLegend" aria-label={t("tape.legend")}>
        {(Object.keys(tapeStatusColors) as TapeStatus[]).map((key) => <span key={key}><i style={{ background: tapeStatusColors[key] }} />{statusLabel(key)}</span>)}
        <span><i className="legendUnpaid" />{t("tape.unpaid")}</span>
        {(Object.keys(housekeepingColors) as HousekeepingState[]).map((key) => <span key={key}><HkDot state={key} />{hkLabel(key)}</span>)}
      </div>
      <p className="notice" aria-live="polite">{message}</p>
      <div className="tape" style={{ ["--tape-days" as string]: days }}>
        <div className="tapeHead">
          <b>{t("tape.room")}</b>
          {columns.map((d) => <span key={d} className={d === today ? "today" : undefined}><small>{weekday(d)}</small>{dayMonth(d)}</span>)}
        </div>
        {rooms.map((room) => {
          const hk = housekeepingState(room.operational_status, room.open_task_status);
          const roomBookings = bookings.filter((b) => b.room_id === room.id);
          const roomHolds = holds.filter((h) => h.roomId === room.id);
          return (
            <div className="tapeRow" key={room.id}>
              <b>
                <span title={hkLabel(hk)} role="img" aria-label={hkLabel(hk)}><HkDot state={hk} /></span> {room.code}
                {room.top_notice && (
                  <span className="defectWrap">
                    <button type="button" className={`defectBadge sev-${room.top_notice.severity}`} onClick={() => setNoticeRoom(room)} aria-label={t("mnt.badge", { n: room.open_notices ?? 1, severity: t(`mnt.sev.${room.top_notice.severity}` as PmsKey) })}>
                      {room.top_notice.severity === "minor" ? "🛠️" : "⚠️"}{(room.open_notices ?? 1) > 1 && <sup>{room.open_notices}</sup>}
                    </button>
                    <span className="defectCard" role="tooltip">
                      <span className={`sevTag sev-${room.top_notice.severity}`}>{t(`mnt.sev.${room.top_notice.severity}` as PmsKey)}</span>
                      <small>{t("mnt.reportedBy", { name: room.top_notice.reporter ?? "—", time: when(room.top_notice.reported_at) })}</small>
                      <span>{room.top_notice.description}</span>
                      {Number(room.top_notice.photos) > 0 && <small>📷 {t("mnt.photos", { n: room.top_notice.photos })}</small>}
                    </span>
                  </span>
                )}
                {!room.top_notice && canReport && <button type="button" className="defectAdd" onClick={() => setNoticeRoom(room)} aria-label={`${t("mnt.report")} · ${room.code}`} title={t("mnt.report")}>+</button>}
                <small>{room.room_type} · {t("tape.persons", { n: room.capacity })}</small>
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
                  title={canCreate ? t("tape.dblClick") : undefined}
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
                    title={`${booking.guest_name} · ${booking.reference}\n${booking.check_in} → ${booking.check_out}\n${statusLabel(status)}${unpaid ? `\n${t("tape.balance", { amount: euro(Number(booking.balance_cents)) })}` : ""}`}
                  >
                    {unpaid && <span aria-label={t("tape.unpaid")}>€ </span>}{booking.guest_name}
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
                    title={`${hold.guestName} · ${t("tape.onlineHold")}\n${hold.checkIn} → ${hold.checkOut}`}
                  >
                    {hold.guestName || t("tape.onlineBooking")}
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
          <small>{t("tape.total", { total: euro(Number(menu.total_cents)), balance: euro(Number(menu.balance_cents)) })}</small>
          {canEdit && menu.status === "confirmed" && menu.check_in <= today && <button disabled={busy} onClick={() => quickAction("check_in")}>{t("desk.checkIn")}</button>}
          {canEdit && menu.status === "checked_in" && <button disabled={busy} onClick={() => quickAction("check_out")}>{t("desk.checkOut")}</button>}
          {canEdit && (menu.status === "confirmed" || menu.status === "checked_in") && (
            <fieldset className="quickDates">
              <legend>{t("tape.changeDates")}</legend>
              <label>{t("tape.arrival")}<input type="date" value={dates.checkIn} disabled={menu.status === "checked_in"} onChange={(e) => setDates((d) => ({ ...d, checkIn: e.target.value }))} /></label>
              <label>{t("tape.departure")}<input type="date" value={dates.checkOut} min={addDays(dates.checkIn || menu.check_in, 1)} onChange={(e) => setDates((d) => ({ ...d, checkOut: e.target.value }))} /></label>
              <button disabled={busy || !dates.checkIn || !dates.checkOut || dates.checkOut <= dates.checkIn || (dates.checkIn === menu.check_in && dates.checkOut === menu.check_out)} onClick={() => quickAction("move")}>{t("tape.saveDates")}</button>
            </fieldset>
          )}
          <button onClick={() => router.push(`/pms/reservations/${menu.id}`)}>{t("tape.folio")}</button>
          <button className="close" onClick={() => setMenu(null)}>{t("tape.close")}</button>
        </div>
      )}
      {noticeRoom && <NoticeModal lang={lang} roomId={noticeRoom.id} roomCode={noticeRoom.code} canResolve={canResolve} canReport={canReport} onClose={() => setNoticeRoom(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
