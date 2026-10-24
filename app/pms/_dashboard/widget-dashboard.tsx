"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { LuBedDouble, LuBell, LuBot, LuCalendarDays, LuCalendarSearch, LuCloudSun, LuIdCard, LuPlaneLanding, LuPlaneTakeoff, LuSparkles, LuSprayCan, LuStickyNote, LuTv, LuWallet } from "react-icons/lu";
import { moveWidget, type WidgetId, type WidgetPlacement, type WidgetSize } from "@/lib/dashboard-widgets";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { TvRequestsWidget } from "./tv-requests-widget";
import { AiAssistant, BookingSearch, BookingsCalendar, CheckAvailability, Finance, Forecast, Housekeeping, LatestBookings, Notifications, RoomsToday, StayList, StickyNotes, type Balance, type Feed, type Note, type Recent, type RoomToday, type Stay } from "./widgets";

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
export type DashboardPermissions = { editNotes: boolean; editStays: boolean; createReservation: boolean; financial: boolean; housekeeping: boolean; housekeepingWrite: boolean };

// Line icons for the widget headers.
const icons: Record<WidgetId, IconType> = { sticky_notes: LuStickyNote, booking_search: LuIdCard, ai_assistant: LuBot, forecast: LuCloudSun, arriving: LuPlaneLanding, departing: LuPlaneTakeoff, check_availability: LuCalendarSearch, bookings_calendar: LuCalendarDays, latest_bookings: LuSparkles, rooms_today: LuBedDouble, finance: LuWallet, housekeeping: LuSprayCan, notifications: LuBell, tv_requests: LuTv };
const WidgetIcon = ({ id }: { id: WidgetId }) => { const I = icons[id]; return <I className="wIcon" aria-hidden />; };

export function WidgetDashboard({ lang, data, can, initialLayout }: { lang: PmsLang; data: DashboardData; can: DashboardPermissions; initialLayout: WidgetPlacement[] }) {
  const t = pmsT(lang);
  const [layout, setLayout] = useState(initialLayout);
  const [customize, setCustomize] = useState(false);
  const [msg, setMsg] = useState("");
  const allowed = (id: WidgetId) => (id === "finance" ? can.financial : id === "housekeeping" || id === "tv_requests" ? can.housekeeping : true);

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
      case "ai_assistant": return <AiAssistant t={t} lang={lang} />;
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
      case "tv_requests": return <TvRequestsWidget lang={lang} canHandle={can.housekeepingWrite} />;
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
          {hidden.map((w) => <button key={w.id} type="button" onClick={() => update(w.id, { hidden: false })}>＋ <WidgetIcon id={w.id} /> {t(`w.title.${w.id}` as PmsKey)}</button>)}
        </div>
      )}
      <div className="widgetGrid">
        {visible.map((w) => (
          <MasonryItem key={w.id} className={`widget span${w.size}${customize ? " editing" : ""}`} labelledBy={`w-${w.id}`}>
            <header>
              <h2 id={`w-${w.id}`}><span className="wIconBox"><WidgetIcon id={w.id} /></span> {t(`w.title.${w.id}` as PmsKey)}</h2>
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
          </MasonryItem>
        ))}
      </div>
    </div>
  );
}

// Masonry packing like the VikBooking dashboard: the grid has 4px rows and each widget spans as many rows as its
// height needs, so short widgets no longer leave gaps under taller neighbours (grid-auto-flow: dense fills holes).
const ROW = 4, GAP = 12;
function MasonryItem({ className, labelledBy, children }: { className: string; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [span, setSpan] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setSpan(Math.ceil((el.getBoundingClientRect().height + GAP) / ROW)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <section ref={ref} className={className} aria-labelledby={labelledBy} style={span ? { gridRowEnd: `span ${span}` } : undefined}>{children}</section>;
}
