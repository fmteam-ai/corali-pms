"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { pmsLocale, pmsStatus, pmsT, type PmsLang } from "@/lib/pms-i18n";

type Note = { id: number; body: string };
type Notification = { key: string; kind: string; title: string; link: string };
type Booking = { id: number; guest_name: string; check_in: string; check_out: string; status: string; reference: string };
type Counts = { arrivalsToday: number; departuresToday: number; arrivalsTomorrow: number; departuresTomorrow: number; occupied: number; totalRooms: number };
type Day = { day: string; arrivals: number; departures: number; occupied: number };

const pct = (occupied: number, total: number) => (total ? Math.round((occupied / total) * 100) : 0);

export function Dashboard({ lang, today, initialNotes, initialNotifications, bookings, recent, counts, forecast, canEditNotes, canCreateReservation }: { lang: PmsLang; today: string; initialNotes: Note[]; canEditNotes: boolean; canCreateReservation: boolean; initialNotifications: Notification[]; bookings: Booking[]; recent: Booking[]; counts: Counts; forecast: Day[] }) {
  const t = pmsT(lang);
  const locale = pmsLocale(lang);
  const [notes, setNotes] = useState(initialNotes);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [range, setRange] = useState<7 | 30>(7);

  async function action(payload: object) {
    return fetch("/api/pms/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }
  async function add() {
    const text = body.trim();
    if (!text) return;
    const r = await action({ action: "add_note", body: text });
    if (r.ok) {
      const d = await r.json();
      setNotes((v) => [d.note ?? { id: Date.now(), body: text }, ...v]);
      setBody("");
    }
  }
  async function saveEdit() {
    if (!editing || !editing.body.trim()) return;
    if ((await action({ action: "edit_note", id: editing.id, body: editing.body.trim() })).ok) {
      setNotes((v) => v.map((x) => (x.id === editing.id ? { ...x, body: editing.body.trim() } : x)));
      setEditing(null);
    }
  }
  async function remove(id: number) {
    if (!confirm(t("dash.confirmDelete"))) return;
    if ((await action({ action: "delete_note", id })).ok) setNotes((n) => n.filter((x) => x.id !== id));
  }
  async function read(key: string) {
    if ((await action({ action: "read_notification", key })).ok) setNotifications((n) => n.filter((x) => x.key !== key));
  }

  const shown = forecast.slice(0, range);
  const average = shown.length ? Math.round(shown.reduce((sum, d) => sum + pct(d.occupied, counts.totalRooms), 0) / shown.length) : 0;
  const bookingRow = (b: Booking) => (
    <Link className="dashboardBooking" key={b.id} href={`/pms/reservations/${b.id}`}>
      <strong>{b.guest_name}</strong>
      <span>{b.reference} · {b.check_in} → {b.check_out}</span>
      <small className={`status ${b.status}`}>{pmsStatus(lang, b.status)}</small>
    </Link>
  );

  return (
    <>
      <div className="dashboardActions">
        {canCreateReservation && <Link href="/pms/reservations/new">{t("app.newReservation")}</Link>}
        <Link href="/pms/reservations">{t("dash.shortcutSearch")}</Link>
        <Link href="/pms/rooms">{t("dash.shortcutCalendar")}</Link>
      </div>
      <div className="metricGrid">
        <article><small>{t("dash.arrivalsToday")}</small><b>{counts.arrivalsToday}</b></article>
        <article><small>{t("dash.departuresToday")}</small><b>{counts.departuresToday}</b></article>
        <article><small>{t("dash.arrivalsTomorrow")}</small><b>{counts.arrivalsTomorrow}</b></article>
        <article><small>{t("dash.departuresTomorrow")}</small><b>{counts.departuresTomorrow}</b></article>
        <article><small>{t("dash.occupiedToday")}</small><b>{counts.occupied} / {counts.totalRooms}</b></article>
      </div>
      <div className="dashboardTools">
        <MiniCalendar lang={lang} today={today} totalRooms={counts.totalRooms} />
        <section className="forecastCard">
          <div className="forecastHead">
            <h2>{t("dash.forecast")}</h2>
            <div className="segmented" role="group" aria-label={t("dash.forecast")}>
              {([7, 30] as const).map((n) => <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>{t("dash.days", { n })}</button>)}
            </div>
          </div>
          <p className="forecastAverage">{t("dash.average", { pct: average })}</p>
          <div className={`forecastBars${range === 30 ? " compact" : ""}`}>
            {shown.map((day) => {
              const p = pct(day.occupied, counts.totalRooms);
              return (
                <Link key={day.day} href={`/pms/rooms?start=${day.day}`} title={`${day.day} · ${day.occupied}/${counts.totalRooms} · ${t("dash.arrShort")} ${day.arrivals} · ${t("dash.depShort")} ${day.departures}`}>
                  <span>{new Date(`${day.day}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", timeZone: "UTC" })}</span>
                  <i className="bar"><i style={{ width: `${p}%` }} className={p >= 90 ? "high" : p >= 60 ? "mid" : undefined} /></i>
                  <b>{p}%</b>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
      <div className="dashboardGrid">
        <article><h2>{t("dash.upcoming")}</h2>{bookings.length ? bookings.map(bookingRow) : <p>{t("dash.noUpcoming")}</p>}</article>
        <article><h2>{t("dash.recent")}</h2>{recent.length ? recent.map(bookingRow) : <p>{t("dash.noRecent")}</p>}</article>
        <article>
          <h2>{t("dash.notes")}</h2>
          {canEditNotes && (
            <div className="noteAdd">
              <textarea value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} placeholder={t("dash.newNote")} />
              <button type="button" onClick={add}>{t("dash.add")}</button>
            </div>
          )}
          {notes.map((n) => (
            <div className="sticky" key={n.id}>
              {editing?.id === n.id ? (
                <>
                  <textarea value={editing.body} maxLength={500} autoFocus onChange={(e) => setEditing({ id: n.id, body: e.target.value })} />
                  <button type="button" onClick={saveEdit}>{t("dash.save")}</button>
                  <button type="button" onClick={() => setEditing(null)}>{t("dash.cancel")}</button>
                </>
              ) : (
                <>
                  <p>{n.body}</p>
                  {canEditNotes && <><button type="button" onClick={() => setEditing({ id: n.id, body: n.body })}>{t("dash.edit")}</button><button type="button" onClick={() => remove(n.id)}>{t("dash.delete")}</button></>}
                </>
              )}
            </div>
          ))}
        </article>
        <article>
          <h2>{t("bell.title")} <span className="badge">{notifications.length}</span></h2>
          {notifications.length === 0 ? <p>{t("bell.empty")}</p> : notifications.slice(0, 15).map((n) => (
            <div className="notification" key={n.key}>
              <Link href={n.link}>{n.title}</Link>
              <button type="button" onClick={() => read(n.key)}>{t("bell.markRead")}</button>
            </div>
          ))}
        </article>
      </div>
    </>
  );
}

function MiniCalendar({ lang, today, totalRooms }: { lang: PmsLang; today: string; totalRooms: number }) {
  const t = pmsT(lang);
  const locale = pmsLocale(lang);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<{ month: string; days: Day[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pms/occupancy?month=${month}`, { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData({ month, days: d.days }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [month]);
  const days = data?.month === month ? data.days : [];
  const first = new Date(`${month}-01T00:00:00Z`);
  const leading = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const shift = (delta: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(d.toISOString().slice(0, 7));
  };
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: "narrow", timeZone: "UTC" }));
  return (
    <section className="miniCalendar">
      <div className="miniCalHead">
        <button type="button" onClick={() => shift(-1)} aria-label={t("dash.prevMonth")}>‹</button>
        <h2>{first.toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <button type="button" onClick={() => shift(1)} aria-label={t("dash.nextMonth")}>›</button>
      </div>
      <p className="miniCalHint">{t("dash.calendarHint")}</p>
      <div className="miniCalGrid">
        {weekdays.map((w, i) => <b key={`w${i}`}>{w}</b>)}
        {Array.from({ length: leading }, (_, i) => <span key={`e${i}`} />)}
        {days.map((d) => {
          const p = pct(d.occupied, totalRooms);
          return (
            <Link key={d.day} href={`/pms/rooms?start=${d.day}`} className={`${d.day === today ? "today " : ""}${p >= 90 ? "high" : p >= 60 ? "mid" : p > 0 ? "low" : ""}`} title={`${d.day} · ${p}% · ${t("dash.arrShort")} ${d.arrivals} · ${t("dash.depShort")} ${d.departures}`}>
              <strong>{Number(d.day.slice(8))}</strong>
              <small>{p}%</small>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
