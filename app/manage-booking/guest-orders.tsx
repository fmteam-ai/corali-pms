"use client";
import { useCallback, useEffect, useState } from "react";
import { bookingLocale, type BookingLanguage } from "@/lib/booking-i18n";
import { orderTexts, type OrderKind } from "@/lib/guest-orders-core";
import type { GuestOffer, GuestOrderRow } from "@/lib/guest-orders";

type Pick = { kind: OrderKind; key: string; extraId?: number; roomType?: string; title: string; amountCents: number; askWhen: boolean };

/** Services, late check-out and upgrades the guest can ask for; reception confirms and charges the room account. */
export function GuestOrders({ token, lang, heading = false, source = heading ? "checkin" : "manage" }: { token: string; lang: BookingLanguage; heading?: boolean; source?: "manage" | "checkin" }) {
  const t = orderTexts[lang];
  const [offers, setOffers] = useState<GuestOffer | null>(null);
  const [orders, setOrders] = useState<GuestOrderRow[]>([]);
  const [stay, setStay] = useState<{ checkIn: string; checkOut: string } | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [form, setForm] = useState({ date: "", time: "", note: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (c: number) => new Intl.NumberFormat(bookingLocale[lang], { style: "currency", currency: "EUR" }).format(c / 100);
  const load = useCallback(async () => {
    const r = await fetch(`/api/public/guest-orders?token=${encodeURIComponent(token)}&lang=${lang}`, { cache: "no-store" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.ok) { setOffers(d.offers); setOrders(d.orders); setStay(d.stay); }
  }, [token, lang]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function send() {
    if (!pick) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/public/guest-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, lang, kind: pick.kind, extraId: pick.extraId, roomType: pick.roomType, ...(pick.askWhen ? form : { note: form.note }), source }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setOrders(d.orders); setPick(null); setForm({ date: "", time: "", note: "" }); setMsg(t.sent); } else setMsg(t.failed);
    } finally { setBusy(false); }
  }

  if (!offers) return null;
  const pending = new Set(orders.filter((o) => o.status === "pending").map((o) => o.title));
  const nothing = !offers.extras.length && !offers.lateCheckout && !offers.upgrades.length;
  if (nothing && !orders.length) return null;
  const unit = (mode: string) => (mode === "per_night" ? t.perNight : mode === "per_person" ? t.perPerson : t.perStay);
  const button = (p: Pick) => <button type="button" className="gOrderBtn" onClick={() => { setPick(p); setMsg(""); }}>{t.order}</button>;

  return (
    <section className={heading ? "card gOrders" : "gOrders"}>
      {heading ? <h2>{t.title}</h2> : <h3>{t.title}</h3>}
      <p className="hint">{t.hint}</p>
      {offers.upgrades.length > 0 && (
        <div className="gOrderGroup"><h4>⬆️ {t.upgradeTitle}</h4>
          {offers.upgrades.map((u) => (
            <article key={u.roomType} className="gOrderItem upgrade">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {u.image && <img src={u.image} alt="" loading="lazy" />}
              <div><b>{u.name}</b><small>{u.description}</small><small>{t.upgradeText}</small></div>
              <span className="gOrderPrice">+{money(u.diffCents)}</span>
              {button({ kind: "upgrade", key: `u-${u.roomType}`, roomType: u.roomType, title: t.upgradeName.replace("{room}", u.name), amountCents: u.diffCents, askWhen: false })}
            </article>
          ))}
        </div>
      )}
      {offers.lateCheckout && (
        <div className="gOrderGroup"><h4>🕕 {t.lateTitle}</h4>
          <article className="gOrderItem"><div><b>{t.lateName.replace("{until}", offers.lateCheckout.until)}</b><small>{t.lateText.replace("{until}", offers.lateCheckout.until)}</small></div><span className="gOrderPrice">{money(offers.lateCheckout.amountCents)}</span>
            {button({ kind: "late_checkout", key: "late", title: t.lateName.replace("{until}", offers.lateCheckout.until), amountCents: offers.lateCheckout.amountCents, askWhen: false })}</article>
        </div>
      )}
      {offers.extras.length > 0 && (
        <div className="gOrderGroup"><h4>✨ {t.services}</h4>
          {offers.extras.map((e) => (
            <article key={e.id} className={`gOrderItem${e.recommended ? " rec" : ""}`}>
              <div>{e.recommended && <em className="gOrderRec">★ {t.recommended}</em>}<b>{e.name}</b>{e.description && <small>{e.description}</small>}<small>{money(e.unitCents)} {unit(e.mode)}{e.quantity > 1 ? ` × ${e.quantity}` : ""}</small></div>
              <span className="gOrderPrice">{money(e.amountCents)}</span>
              {button({ kind: "extra", key: `e-${e.id}`, extraId: e.id, title: e.name, amountCents: e.amountCents, askWhen: true })}
            </article>
          ))}
        </div>
      )}
      {nothing && <p className="hint">{t.none}</p>}
      {pick && (
        <div className="gOrderForm" role="dialog" aria-label={pick.title}>
          <b>{pick.title} · {money(pick.amountCents)}</b>
          {pick.askWhen && stay && <div className="gOrderWhen"><label>{t.date}<input type="date" min={stay.checkIn} max={stay.checkOut} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>{t.time}<input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label></div>}
          <label>{t.note}<input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div className="gOrderActions"><button type="button" className="secondary" onClick={() => setPick(null)}>{t.cancel}</button><button type="button" disabled={busy || pending.has(pick.title)} onClick={() => void send()}>{t.send}</button></div>
        </div>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
      {orders.length > 0 && (
        <div className="gOrderGroup"><h4>{t.yourOrders}</h4>
          <ul className="gOrderList">{orders.map((o) => <li key={o.id}><span>{o.title}{o.date ? ` · ${o.date.split("-").reverse().join("/")}` : ""}{o.time ? ` ${o.time}` : ""}</span><b>{money(o.amountCents)}</b><i className={`st-${o.status}`}>{o.status === "pending" ? t.pending : o.status === "confirmed" ? t.confirmed : o.status === "declined" ? t.declined : t.cancelledSt}</i></li>)}</ul>
        </div>
      )}
    </section>
  );
}
