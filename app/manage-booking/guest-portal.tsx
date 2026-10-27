"use client";
import { useCallback, useEffect, useState } from "react";
import { FaGlassCheers, FaInfoCircle, FaTag, FaUserCircle } from "react-icons/fa";
import { bookingLocale, type BookingLanguage } from "@/lib/booking-i18n";
import type { portalData } from "@/lib/guest-portal";
import { DepartmentIcon } from "./department-icon";

type Data = Awaited<ReturnType<typeof portalData>>;
type Item = Data["departments"][number]["items"][number];

/** Guest portal in "My booking": messages from the hotel, then the departments' services (charged to the room). */
export function GuestPortal({ token, lang, part }: { token: string; lang: BookingLanguage; part: "news" | "services" }) {
  const [data, setData] = useState<Data | null>(null);
  const [dept, setDept] = useState<number | null>(null);
  const [pick, setPick] = useState<Item | null>(null);
  const [form, setForm] = useState({ quantity: 1, date: "", time: "", note: "" });
  const [slots, setSlots] = useState<string[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (c: number) => new Intl.NumberFormat(bookingLocale[lang], { style: "currency", currency: "EUR" }).format(c / 100);
  const load = useCallback(async () => {
    const r = await fetch(`/api/public/guest-portal?token=${encodeURIComponent(token)}&lang=${lang}`, { cache: "no-store" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.ok) setData(d);
  }, [token, lang]);
  useEffect(() => { queueMicrotask(() => void load()); const id = setInterval(() => void load(), 60_000); return () => clearInterval(id); }, [load]);

  const current = data?.departments.find((d) => d.id === dept) ?? data?.departments[0];
  // Appointment: free times of the chosen day.
  useEffect(() => {
    if (!pick || current?.mode !== "appointment" || !form.date) return;
    let live = true;
    void fetch(`/api/public/guest-portal?token=${encodeURIComponent(token)}&slots=${pick.id}&date=${form.date}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live) setSlots(d.slots ?? []); }).catch(() => live && setSlots([]));
    return () => { live = false; };
  }, [pick, form.date, current?.mode, token]);

  if (!data) return null;
  const t = data.texts;
  const choose = (i: Item) => { setPick(i); setMsg(""); setSlots(null); setForm({ quantity: 1, date: current?.mode === "appointment" ? data.days[0] ?? "" : "", time: "", note: "" }); };
  async function post(body: object, okText: (d: Data) => string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/public/guest-portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, lang, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setData(d); setPick(null); setMsg(okText(d)); } else setMsg(t.failed);
    } finally { setBusy(false); }
  }
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(bookingLocale[lang], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const time = (ms: number) => new Date(ms).toLocaleTimeString(bookingLocale[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

  if (part === "news") {
    if (!data.announcements.length) return null;
    return (
      <section className="gpNews" aria-label={t.news}>
        <h2>{t.news}</h2>
        {data.announcements.map((a) => (
          <article key={a.id} className={`gpNote kind-${a.kind}${a.personal ? " personal" : ""}`}>
            <span className="gpNoteIcon">{a.personal ? <FaUserCircle aria-hidden /> : a.kind === "happy_hour" ? <FaGlassCheers aria-hidden /> : a.kind === "offer" ? <FaTag aria-hidden /> : a.departmentIcon ? <DepartmentIcon icon={a.departmentIcon} /> : <FaInfoCircle aria-hidden />}</span>
            <div>
              <small className="gpNoteKind">{a.personal ? t.forYou : t[a.kind]}{a.department ? ` · ${a.department}` : ""}{a.endsAt ? ` · ${t.until.replace("{time}", a.endsAt - a.startsAt < 86_400_000 ? time(a.endsAt) : day(new Date(a.endsAt).toISOString().slice(0, 10)))}` : ""}</small>
              {a.title && <b>{a.title}</b>}
              {a.body && <p>{a.body}</p>}
            </div>
          </article>
        ))}
      </section>
    );
  }

  if (!data.departments.length && !data.orders.length) return null;
  const total = pick ? pick.priceCents * (current?.mode === "appointment" ? 1 : form.quantity) : 0;
  return (
    <section className="gOrders gPortal">
      <h3>{t.title}</h3>
      <p className="hint">{data.canOrder ? t.hint : t.notInHouse}</p>
      {data.departments.length > 0 && (
        <div className="gpTabs" role="tablist">
          {data.departments.map((d) => <button type="button" role="tab" key={d.id} aria-selected={current?.id === d.id} className={current?.id === d.id ? "on" : ""} onClick={() => { setDept(d.id); setPick(null); }}><DepartmentIcon icon={d.icon} />{d.name}</button>)}
        </div>
      )}
      {current && (
        <div className="gOrderGroup">
          {current.description && <p className="hint">{current.description}</p>}
          <small className={`gpHours${current.mode === "order" && !current.openNow ? " closed" : ""}`}>{current.mode === "order" && !current.openNow ? `${t.closed} · ` : ""}{t.openHours.replace("{from}", current.openFrom).replace("{to}", current.openTo)}</small>
          {current.items.map((i) => (
            <article key={i.id} className="gOrderItem">
              <div><b>{i.name}</b>{i.description && <small>{i.description}</small>}{i.durationMin > 0 && <small>⏱ {t.minutes.replace("{n}", String(i.durationMin))}</small>}</div>
              <span className="gOrderPrice">{money(i.priceCents)}</span>
              <button type="button" className="gOrderBtn" disabled={!data.canOrder || (current.mode === "order" && !current.openNow)} onClick={() => choose(i)}>{current.mode === "appointment" ? t.book : t.order}</button>
            </article>
          ))}
        </div>
      )}
      {pick && current && (
        <div className="gOrderForm" role="dialog" aria-label={pick.name}>
          <b>{pick.name}</b>
          {current.mode === "appointment" ? (
            <div className="gOrderWhen">
              <label>{t.date}<select value={form.date} onChange={(e) => { setSlots(null); setForm({ ...form, date: e.target.value, time: "" }); }}>{data.days.map((d) => <option key={d} value={d}>{day(d)}</option>)}</select></label>
              <label>{t.time}<select value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} disabled={!slots?.length}><option value="">—</option>{(slots ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              {slots && !slots.length && <small className="error">{t.noSlots}</small>}
            </div>
          ) : (
            <label className="gpQty">{t.quantity}<span><button type="button" aria-label="−" disabled={form.quantity <= 1} onClick={() => setForm({ ...form, quantity: form.quantity - 1 })}>−</button><b>{form.quantity}</b><button type="button" aria-label="+" disabled={form.quantity >= 20} onClick={() => setForm({ ...form, quantity: form.quantity + 1 })}>+</button></span></label>
          )}
          <label>{t.note}<input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div className="gOrderActions"><button type="button" className="secondary" onClick={() => setPick(null)}>{t.cancel}</button><button type="button" disabled={busy || (current.mode === "appointment" && !form.time)} onClick={() => void post({ action: "order", itemId: pick.id, quantity: form.quantity, date: form.date || undefined, time: form.time || undefined, note: form.note }, () => t.charged.replace("{amount}", money(total)))}>{t.confirm.replace("{amount}", money(total))}</button></div>
        </div>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
      {data.orders.length > 0 && (
        <div className="gOrderGroup"><h4>{t.yourOrders}</h4>
          <ul className="gOrderList gpOrders">{data.orders.map((o) => (
            <li key={o.id}>
              <span>{o.title}{o.date ? ` · ${day(o.date)}` : ""}{o.time ? ` ${o.time}${o.endTime ? `–${o.endTime}` : ""}` : ` · ${time(o.createdAt)}`}</span>
              <b>{money(o.amountCents)}</b>
              <i className={`st-${o.status === "placed" ? "confirmed" : o.status === "cancelled" ? "declined" : "done"}`}>{o.status === "placed" ? t.placed : o.status === "done" ? t.done : t.cancelled}</i>
              {o.canCancel && <button type="button" className="linkButton" disabled={busy} onClick={() => void post({ action: "cancel", id: o.id }, () => t.undone)}>{t.undo}</button>}
            </li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}
