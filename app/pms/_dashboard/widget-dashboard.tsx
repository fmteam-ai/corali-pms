"use client";
import { useState } from "react";
import { moveWidget, type WidgetId, type WidgetPlacement, type WidgetSize } from "@/lib/dashboard-widgets";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { BookingSearch, BookingsCalendar, CheckAvailability, Finance, Forecast, Housekeeping, LatestBookings, Notifications, RoomsToday, StayList, StickyNotes, type Balance, type Feed, type Note, type Recent, type RoomToday, type Stay } from "./widgets";

export type DashboardData = {
  today: string;
  totalRooms: number;
  notes: Note[];
  arrivals: Record<"yesterday" | "today" | "tomorrow", Stay[]>;
  departures: Record<"yesterday" | "today" | "tomorrow", Stay[]>;
  recent: Recent[];
  rooms: RoomToday[];
  roomTypes: string[];
  balances: Balance[];
  paymentsToday: number;
  housekeeping: { todo: number; inProgress: number; review: number; ooo: number; openDefects: number };
  notifications: Feed[];
};
export type DashboardPermissions = { editNotes: boolean; editStays: boolean; createReservation: boolean; financial: boolean; housekeeping: boolean };

const icons: Record<WidgetId, string> = { sticky_notes: "📌", booking_search: "🪪", forecast: "🌤️", arriving: "🛬", departing: "🛫", check_availability: "🧮", bookings_calendar: "📅", latest_bookings: "🆕", rooms_today: "🛏️", finance: "💶", housekeeping: "🧹", notifications: "🔔" };

export function WidgetDashboard({ lang, data, can, initialLayout }: { lang: PmsLang; data: DashboardData; can: DashboardPermissions; initialLayout: WidgetPlacement[] }) {
  const t = pmsT(lang);
  const [layout, setLayout] = useState(initialLayout);
  const [customize, setCustomize] = useState(false);
  const [msg, setMsg] = useState("");
  const allowed = (id: WidgetId) => (id === "finance" ? can.financial : id === "housekeeping" ? can.housekeeping : true);

  async function persist(next: WidgetPlacement[]) {
    setLayout(next);
    const r = await fetch("/api/pms/dashboard-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: next }) });
    setMsg(r.ok ? "" : t("w.layoutFailed"));
  }
  async function reset() {
    const r = await fetch("/api/pms/dashboard-layout", { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setLayout(d.layout);
  }
  const update = (id: WidgetId, patch: Partial<WidgetPlacement>) => void persist(layout.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  function body(id: WidgetId) {
    switch (id) {
      case "sticky_notes": return <StickyNotes t={t} initial={data.notes} canEdit={can.editNotes} />;
      case "booking_search": return <BookingSearch t={t} lang={lang} />;
      case "forecast": return <Forecast t={t} lang={lang} today={data.today} totalRooms={data.totalRooms} />;
      case "arriving": return <StayList t={t} lang={lang} kind="arriving" stays={data.arrivals} canEdit={can.editStays} />;
      case "departing": return <StayList t={t} lang={lang} kind="departing" stays={data.departures} canEdit={can.editStays} />;
      case "check_availability": return <CheckAvailability t={t} lang={lang} today={data.today} canCreate={can.createReservation} />;
      case "bookings_calendar": return <BookingsCalendar t={t} lang={lang} today={data.today} roomTypes={data.roomTypes} canCreate={can.createReservation} />;
      case "latest_bookings": return <LatestBookings t={t} lang={lang} rows={data.recent} />;
      case "rooms_today": return <RoomsToday t={t} rooms={data.rooms} />;
      case "finance": return <Finance t={t} lang={lang} paymentsToday={data.paymentsToday} balances={data.balances} />;
      case "housekeeping": return <Housekeeping t={t} counts={data.housekeeping} />;
      case "notifications": return <Notifications t={t} lang={lang} items={data.notifications} />;
    }
  }

  const visible = layout.filter((w) => allowed(w.id) && !w.hidden);
  const hidden = layout.filter((w) => allowed(w.id) && w.hidden);
  return (
    <div className="widgetDashboard">
      <div className="widgetBar">
        <label className="switch"><input type="checkbox" checked={customize} onChange={(e) => setCustomize(e.target.checked)} /><span aria-hidden="true" /> ⚙️ {t("w.customize")}</label>
        {customize && <button type="button" className="secondaryButton" onClick={reset}>{t("w.reset")}</button>}
        {msg && <span className="error">{msg}</span>}
      </div>
      {customize && hidden.length > 0 && (
        <div className="widgetTray">
          <b>{t("w.hiddenWidgets")}:</b>
          {hidden.map((w) => <button key={w.id} type="button" onClick={() => update(w.id, { hidden: false })}>＋ {icons[w.id]} {t(`w.title.${w.id}` as PmsKey)}</button>)}
        </div>
      )}
      <div className="widgetGrid">
        {visible.map((w) => (
          <section key={w.id} className={`widget span${w.size}${customize ? " editing" : ""}`} aria-labelledby={`w-${w.id}`}>
            <header>
              <h2 id={`w-${w.id}`}><span aria-hidden="true">{icons[w.id]}</span> {t(`w.title.${w.id}` as PmsKey)}</h2>
              {customize && (
                <div className="widgetControls">
                  <button type="button" aria-label={t("w.moveUp")} onClick={() => void persist(moveWidget(layout, w.id, -1))}>↑</button>
                  <button type="button" aria-label={t("w.moveDown")} onClick={() => void persist(moveWidget(layout, w.id, 1))}>↓</button>
                  <select aria-label={t("w.size")} value={w.size} onChange={(e) => update(w.id, { size: Number(e.target.value) as WidgetSize })}>
                    <option value={1}>⅓</option><option value={2}>⅔</option><option value={3}>{t("w.full")}</option>
                  </select>
                  <button type="button" aria-label={t("w.hide")} onClick={() => update(w.id, { hidden: true })}>✕</button>
                </div>
              )}
            </header>
            <div className="widgetBody">{body(w.id)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
