"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pmsLocale, pmsStatus, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

export type Stay = { id: number; reference: string; guest_name: string; room_code: string | null; check_in: string; check_out: string; status: string; balance_cents: number; version: number; adults: number; children: number };
export type Note = { id: number; body: string; color: string };
export type RoomToday = { id: number; code: string; room_type: string; operational_status: string; guest_name: string | null; booking_id: number | null };
export type Recent = { id: number; reference: string; guest_name: string; check_in: string; check_out: string; status: string; channel: string; created_at: number };
export type Balance = { id: number; reference: string; guest_name: string; check_out: string; balance_cents: number };
export type Feed = { key: string; title: string; link?: string | null; created_at: number; read?: boolean };
type T = ReturnType<typeof pmsT>;

const money = (lang: PmsLang, c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
const shortDate = (lang: PmsLang, d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(pmsLocale(lang), { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function post(url: string, body: object, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

/* ---------- Sticky notes ---------- */
const colors = ["yellow", "pink", "green", "blue"] as const;
export function StickyNotes({ t, initial, canEdit }: { t: T; initial: Note[]; canEdit: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [editing, setEditing] = useState<{ id: number | null; body: string; color: string } | null>(null);
  async function save() {
    if (!editing || !editing.body.trim()) { setEditing(null); return; }
    if (editing.id === null) {
      const { ok, d } = await post("/api/pms/dashboard", { action: "add_note", body: editing.body.trim(), color: editing.color });
      if (ok) setNotes((n) => [{ id: d.note.id, body: d.note.body, color: d.note.color ?? editing.color }, ...n]);
    } else {
      const { ok } = await post("/api/pms/dashboard", { action: "edit_note", id: editing.id, body: editing.body.trim(), color: editing.color });
      if (ok) setNotes((n) => n.map((x) => (x.id === editing.id ? { ...x, body: editing.body.trim(), color: editing.color } : x)));
    }
    setEditing(null);
  }
  async function remove(id: number) {
    if (!confirm(t("w.notes.confirmDelete"))) return;
    if ((await post("/api/pms/dashboard", { action: "delete_note", id })).ok) setNotes((n) => n.filter((x) => x.id !== id));
  }
  const editor = (
    <div className={`sticky editing c-${editing?.color}`}>
      <textarea autoFocus maxLength={500} value={editing?.body ?? ""} placeholder={t("w.notes.placeholder")} onChange={(e) => setEditing((x) => x && { ...x, body: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save(); if (e.key === "Escape") setEditing(null); }} />
      <div className="stickyTools">
        {colors.map((c) => <button key={c} type="button" className={`dot c-${c}${editing?.color === c ? " on" : ""}`} aria-label={t(`w.notes.color.${c}` as PmsKey)} onClick={() => setEditing((x) => x && { ...x, color: c })} />)}
        <button type="button" className="ok" onClick={save}>✓</button>
      </div>
    </div>
  );
  return (
    <div className="stickyBoard">
      {canEdit && (editing?.id === null ? editor : <button type="button" className="sticky add" aria-label={t("w.notes.add")} onClick={() => setEditing({ id: null, body: "", color: "yellow" })}><span>+</span></button>)}
      {notes.map((n) => editing?.id === n.id ? <div key={n.id}>{editor}</div> : (
        <div key={n.id} className={`sticky c-${n.color || "yellow"}`} onDoubleClick={() => canEdit && setEditing({ id: n.id, body: n.body, color: n.color || "yellow" })}>
          <p>{n.body}</p>
          {canEdit && <div className="stickyActions"><button type="button" aria-label={t("w.notes.edit")} onClick={() => setEditing({ id: n.id, body: n.body, color: n.color || "yellow" })}>✎</button><button type="button" aria-label={t("w.notes.delete")} onClick={() => remove(n.id)}>×</button></div>}
        </div>
      ))}
      {!notes.length && !canEdit && <p className="muted">{t("w.notes.empty")}</p>}
    </div>
  );
}

/* ---------- Booking search ---------- */
export function BookingSearch({ t, lang }: { t: T; lang: PmsLang }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: number; reference: string; guest_name: string; check_in: string; check_out: string; status: string }[] | null>(null);
  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    const r = await fetch(`/api/pms/search?q=${encodeURIComponent(q.trim())}`);
    const d = await r.json().catch(() => ({}));
    setResults(d.results ?? []);
  }
  return (
    <div className="wBookingSearch">
      <form onSubmit={search} className="searchRow"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("w.search.placeholder")} aria-label={t("w.search.placeholder")} /><button>🔍 {t("w.search.button")}</button></form>
      {results && (results.length ? <ul className="wList">{results.map((r) => <li key={r.id}><Link href={`/pms/reservations/${r.id}`}><b>{r.reference}</b> · {r.guest_name}</Link><small>{shortDate(lang, r.check_in)} → {shortDate(lang, r.check_out)} · {pmsStatus(lang, r.status)}</small></li>)}</ul> : <p className="muted">{t("w.search.none")}</p>)}
    </div>
  );
}

/* ---------- Forecast ---------- */
type Day = { day: string; arrivals: number; departures: number; occupied: number };
export function Forecast({ t, lang, today, totalRooms }: { t: T; lang: PmsLang; today: string; totalRooms: number }) {
  const [span, setSpan] = useState(7);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState<Day[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/pms/occupancy?start=${start}&days=${span}`).then((r) => r.json()).then((d) => { if (live) setDays(d.days ?? []); }).catch(() => live && setDays([]));
    return () => { live = false; };
  }, [start, span]);
  const nights = days?.reduce((a, d) => a + d.occupied, 0) ?? 0;
  const capacity = totalRooms * span;
  const bookings = days?.reduce((a, d) => a + d.arrivals, 0) ?? 0;
  const pct = capacity ? Math.round((nights / capacity) * 100) : 0;
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="wForecast">
      <div className="fHead">
        <div><b>{shortDate(lang, start)} – {shortDate(lang, addDays(start, span - 1))}</b></div>
        <div className="fNav">
          <select value={span} aria-label={t("w.forecast.range")} onChange={(e) => setSpan(Number(e.target.value))}>{[7, 14, 30].map((n) => <option key={n} value={n}>{t("w.forecast.days", { n })}</option>)}</select>
          <button type="button" aria-label={t("w.prev")} disabled={start <= today} onClick={() => setStart((s) => (addDays(s, -span) < today ? today : addDays(s, -span)))}>‹</button>
          <button type="button" aria-label={t("w.next")} onClick={() => setStart((s) => addDays(s, span))}>›</button>
        </div>
      </div>
      <div className="fStats">
        <div><small>{t("w.forecast.occupancy")}</small><b>{pct}%</b></div>
        <div><small>{t("w.forecast.bookings")}</small><b>{bookings}</b></div>
        <div><small>{t("w.forecast.nights")}</small><b>{nights} / {capacity}</b></div>
      </div>
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label={`${t("w.forecast.occupancy")} ${pct}%`}>
        <circle cx="70" cy="70" r={r} className="unsold" />
        <circle cx="70" cy="70" r={r} className="sold" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 70 70)" />
        <text x="70" y="76" textAnchor="middle">{pct}%</text>
      </svg>
      <div className="legendRow"><span><i className="sold" />{t("w.forecast.sold")}</span><span><i className="unsold" />{t("w.forecast.unsold")}</span></div>
    </div>
  );
}

/* ---------- Arriving / departing ---------- */
export function StayList({ t, lang, kind, stays, canEdit }: { t: T; lang: PmsLang; kind: "arriving" | "departing"; stays: Record<"yesterday" | "today" | "tomorrow", Stay[]>; canEdit: boolean }) {
  const router = useRouter();
  const [day, setDay] = useState<"today" | "tomorrow" | "yesterday">("today");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const list = stays[day].filter((s) => !q || `${s.reference} ${s.guest_name} ${s.room_code ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  async function act(s: Stay, action: "check_in" | "check_out") {
    setBusy(s.id);
    const { ok, d } = await post(`/api/pms/reservations/${s.id}`, { version: s.version, action }, "PATCH");
    setBusy(null);
    if (!ok) { const k = `err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("desk.actionFailed")); return; }
    setMsg("");
    router.refresh();
  }
  return (
    <div className="wStays">
      <div className="wToolbar">
        <span className="countBadge">{stays[day].length}</span>
        <span className="wSearch"><input value={q} placeholder={t("w.searchShort")} aria-label={t("w.searchShort")} onChange={(e) => setQ(e.target.value)} />{q && <button type="button" aria-label={t("w.clear")} onClick={() => setQ("")}>×</button>}</span>
        <div className="segmented small" role="group">{(["today", "tomorrow", "yesterday"] as const).map((d) => <button key={d} type="button" aria-pressed={day === d} onClick={() => setDay(d)}>{t(`w.day.${d}` as PmsKey)}</button>)}</div>
      </div>
      <div className="tableWrap compact">
        <table>
          <thead><tr><th>{t("w.col.id")}</th><th>{t("w.col.name")}</th><th>{t("w.col.adults")}</th><th>{t("w.col.room")}</th><th>{kind === "arriving" ? t("w.col.checkOut") : t("w.col.checkIn")}</th><th>{t("w.col.status")}</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/pms/reservations/${s.id}`}>{s.reference}</Link></td>
                <td>{s.guest_name}{Number(s.balance_cents) > 0 && <small className="balanceDue">{money(lang, Number(s.balance_cents))}</small>}</td>
                <td>{s.adults}{s.children ? ` + ${s.children}` : ""}</td>
                <td>{s.room_code ?? "—"}</td>
                <td>{shortDate(lang, kind === "arriving" ? s.check_out : s.check_in)}</td>
                <td><span className={`status ${s.status}`}>{pmsStatus(lang, s.status)}</span></td>
                <td>{canEdit && day !== "yesterday" && (kind === "arriving" ? s.status === "confirmed" && day === "today" && <button type="button" disabled={busy === s.id} onClick={() => act(s, "check_in")}>{t("desk.checkIn")}</button> : s.status === "checked_in" && day === "today" && <button type="button" disabled={busy === s.id} onClick={() => act(s, "check_out")}>{t("desk.checkOut")}</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="muted">⚠ {kind === "arriving" ? t("w.noArrivals") : t("w.noDepartures")}</p>}
      </div>
      {msg && <p className="error" role="status">{msg}</p>}
    </div>
  );
}

/* ---------- Check availability ---------- */
type TypeAvail = { roomType: string; total: number; free: number; fromCents: number; capacity: number; firstFreeRoom: number | null };
export function CheckAvailability({ t, lang, today, canCreate }: { t: T; lang: PmsLang; today: string; canCreate: boolean }) {
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDays(today, 1));
  const [guests, setGuests] = useState(2);
  const [types, setTypes] = useState<TypeAvail[] | null>(null);
  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    const r = await fetch(`/api/pms/availability?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`);
    const d = await r.json().catch(() => ({}));
    setTypes(d.types ?? []);
  }
  return (
    <div className="wAvailability">
      <form className="availForm" onSubmit={check}>
        <label>{t("w.col.checkIn")}<input type="date" value={checkIn} min={today} onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1)); }} /></label>
        <label>{t("w.col.checkOut")}<input type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} /></label>
        <label>{t("w.guests")}<input type="number" min={1} max={20} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} /></label>
        <button>{t("w.avail.check")}</button>
      </form>
      {types && (
        <div className="tableWrap compact">
          <table>
            <thead><tr><th>{t("w.col.roomType")}</th><th>{t("w.avail.free")}</th><th>{t("w.avail.from")}</th><th /></tr></thead>
            <tbody>{types.map((x) => <tr key={x.roomType} className={x.free ? undefined : "soldOutRow"}><td><b>{x.roomType}</b><small>{t("w.avail.capacity", { n: x.capacity })}</small></td><td>{x.free} / {x.total}</td><td>{money(lang, x.fromCents)}</td><td>{canCreate && x.firstFreeRoom && <Link className="smallButton" href={`/pms/reservations/new?roomId=${x.firstFreeRoom}&checkIn=${checkIn}&checkOut=${checkOut}`}>{t("w.avail.book")}</Link>}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Bookings calendar ---------- */
export function BookingsCalendar({ t, lang, today, roomTypes, canCreate }: { t: T; lang: PmsLang; today: string; roomTypes: string[]; canCreate: boolean }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [roomType, setRoomType] = useState("");
  const [data, setData] = useState<{ totalRooms: number; days: Day[] } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/pms/occupancy?month=${month}${roomType ? `&roomType=${encodeURIComponent(roomType)}` : ""}`).then((r) => r.json()).then((d) => { if (live) setData({ totalRooms: d.totalRooms ?? 0, days: d.days ?? [] }); }).catch(() => undefined);
    return () => { live = false; };
  }, [month, roomType]);
  const shift = (n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(pmsLocale(lang), { weekday: "narrow", timeZone: "UTC" })), [lang]);
  return (
    <div className="wCalendar">
      <div className="calHead">
        <b>{first.toLocaleDateString(pmsLocale(lang), { month: "long", year: "numeric", timeZone: "UTC" })}</b>
        <span><button type="button" aria-label={t("w.prev")} onClick={() => shift(-1)}>‹</button><button type="button" aria-label={t("w.next")} onClick={() => shift(1)}>›</button></span>
      </div>
      <div className="calTools">
        <select value={roomType} aria-label={t("w.cal.filter")} onChange={(e) => setRoomType(e.target.value)}><option value="">{t("w.cal.allRooms")}</option>{roomTypes.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {canCreate && <Link className="smallButton" href="/pms/reservations/new">{t("app.newReservation")}</Link>}
      </div>
      <div className="calGrid">
        {weekdays.map((w, i) => <span key={i} className="wd">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
        {data?.days.map((d) => {
          const pct = data.totalRooms ? d.occupied / data.totalRooms : 0;
          const level = pct >= 0.9 ? "full" : pct >= 0.6 ? "high" : pct > 0 ? "low" : "none";
          return <Link key={d.day} href={`/pms/rooms?start=${addDays(d.day, -2)}`} className={`calDay ${level}${d.day === today ? " today" : ""}`} title={`${shortDate(lang, d.day)} · ${d.occupied}/${data.totalRooms} · ↘${d.arrivals} ↗${d.departures}`}><b>{Number(d.day.slice(8))}</b><small>{d.occupied}/{data.totalRooms}</small></Link>;
        })}
      </div>
    </div>
  );
}

/* ---------- Small lists ---------- */
export function LatestBookings({ t, lang, rows }: { t: T; lang: PmsLang; rows: Recent[] }) {
  return rows.length ? <ul className="wList">{rows.map((r) => <li key={r.id}><Link href={`/pms/reservations/${r.id}`}><b>{r.reference}</b> · {r.guest_name}</Link><small>{shortDate(lang, r.check_in)} → {shortDate(lang, r.check_out)} · {r.channel} · {pmsStatus(lang, r.status)}</small></li>)}</ul> : <p className="muted">{t("w.none")}</p>;
}

export function RoomsToday({ t, rooms }: { t: T; rooms: RoomToday[] }) {
  const state = (r: RoomToday) => (r.operational_status === "out_of_order" ? "ooo" : r.guest_name ? "occupied" : r.operational_status === "dirty" ? "dirty" : "free");
  return (
    <div className="roomTiles">
      {rooms.map((r) => {
        const s = state(r);
        const tile = <><b>{r.code}</b><small>{r.guest_name ?? t(`w.rooms.${s}` as PmsKey)}</small></>;
        return r.booking_id ? <Link key={r.id} href={`/pms/reservations/${r.booking_id}`} className={`roomTile ${s}`} title={r.room_type}>{tile}</Link> : <span key={r.id} className={`roomTile ${s}`} title={r.room_type}>{tile}</span>;
      })}
    </div>
  );
}

export function Finance({ t, lang, paymentsToday, balances }: { t: T; lang: PmsLang; paymentsToday: number; balances: Balance[] }) {
  const due = balances.reduce((a, b) => a + Number(b.balance_cents), 0);
  return (
    <div className="wFinance">
      <div className="fStats two"><div><small>{t("w.fin.today")}</small><b>{money(lang, paymentsToday)}</b></div><div><small>{t("w.fin.outstanding")}</small><b>{money(lang, due)}</b></div></div>
      <ul className="wList">{balances.slice(0, 5).map((b) => <li key={b.id}><Link href={`/pms/reservations/${b.id}`}><b>{b.reference}</b> · {b.guest_name}</Link><small>{money(lang, Number(b.balance_cents))} · {shortDate(lang, b.check_out)}</small></li>)}</ul>
      <Link href="/pms/payments" className="wMore">{t("w.fin.all")} ›</Link>
    </div>
  );
}

export function Housekeeping({ t, counts }: { t: T; counts: { todo: number; inProgress: number; review: number; ooo: number; openDefects: number } }) {
  return (
    <div className="wHousekeeping">
      <div className="fStats two">
        <div><small>{t("w.hk.todo")}</small><b>{counts.todo}</b></div>
        <div><small>{t("w.hk.inProgress")}</small><b>{counts.inProgress}</b></div>
        <div><small>{t("w.hk.review")}</small><b>{counts.review}</b></div>
        <div><small>{t("w.hk.defects")}</small><b>{counts.openDefects}</b></div>
      </div>
      <Link href="/pms/housekeeping" className="wMore">{t("nav.housekeeping")} ›</Link> <Link href="/pms/maintenance" className="wMore">{t("nav.maintenance")} ›</Link>
    </div>
  );
}

export function Notifications({ t, lang, items }: { t: T; lang: PmsLang; items: Feed[] }) {
  return items.length ? <ul className="wList">{items.slice(0, 8).map((n) => <li key={n.key} className={n.read ? "read" : undefined}>{n.link ? <Link href={n.link}>{n.title}</Link> : <span>{n.title}</span>}<small>{new Date(Number(n.created_at)).toLocaleString(pmsLocale(lang), { dateStyle: "short", timeStyle: "short" })}</small></li>)}</ul> : <p className="muted">{t("w.none")}</p>;
}
