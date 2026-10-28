"use client";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { bookingLocale, type BookingLanguage } from "@/lib/booking-i18n";
import type { GuestPartner, OrderView } from "@/lib/partners";
import { partnerTexts } from "@/lib/partners-texts";

type Pass = { qr: string; code: string; firstName: string; checkOut: string; refreshInMs: number };
type Data = { partners: GuestPartner[]; orders: OrderView[]; pass: Pass | null; canOrder: boolean };

/** "My booking" → partner businesses: hotel-guest offers first, catalogue and order (paid at the business), guest pass. */
export function GuestPartners({ token, lang }: { token: string; lang: BookingLanguage }) {
  const t = partnerTexts[lang];
  const [data, setData] = useState<Data | null>(null);
  const [cat, setCat] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [form, setForm] = useState({ fulfilment: "pickup", wantedAt: "", note: "", payMethod: "", code: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const money = (c: number) => new Intl.NumberFormat(bookingLocale[lang], { style: "currency", currency: "EUR" }).format(c / 100);
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(bookingLocale[lang], { day: "numeric", month: "short", timeZone: "UTC" });
  const uses = (n: number | null) => (n === null ? t.unlimited : n === 1 ? t.once : t.times.replace("{n}", String(n)));

  const load = useCallback(async () => {
    const r = await fetch(`/api/public/partners?token=${encodeURIComponent(token)}&lang=${lang}`, { cache: "no-store" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.ok) setData(d);
  }, [token, lang]);
  useEffect(() => { queueMicrotask(() => void load()); const id = setInterval(() => void load(), 60_000); return () => clearInterval(id); }, [load]);

  if (!data || (!data.partners.length && !data.orders.length)) return null;
  const cats = [...new Map(data.partners.map((p) => [p.category, `${p.icon} ${p.categoryLabel}`])).entries()];
  const shown = data.partners.filter((p) => !cat || p.category === cat);
  const open = data.partners.find((p) => p.id === openId) ?? null;
  const lines = open ? open.items.filter((i) => cart[i.id]).map((i) => ({ ...i, qty: cart[i.id] })) : [];
  const subtotal = lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
  const codeOffer = open?.offers.find((o) => o.code && o.code === form.code.trim().toUpperCase() && o.discountPercent);
  const discount = codeOffer ? Math.round((subtotal * Number(codeOffer.discountPercent)) / 100) : 0;

  const choose = (p: GuestPartner) => { setOpenId(p.id); setCart({}); setMsg(""); setForm({ fulfilment: p.pickup ? "pickup" : "delivery", wantedAt: "", note: "", payMethod: p.payMethods[0] ?? "cash", code: "" }); scrollTo({ top: (document.querySelector(".gPartners")?.getBoundingClientRect().top ?? 0) + scrollY - 10, behavior: "smooth" }); };
  async function post(body: object) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/public/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, lang, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setData({ ...data!, orders: d.orders }); return true; }
      setMsg((t as Record<string, string>)[`err${d.error}`] ?? t.errFailed);
      return false;
    } finally { setBusy(false); }
  }

  return (
    <section className="gOrders gPartners">
      <div className="gpHead">
        <h3>{t.title}</h3>
        {data.pass && <button type="button" className="gPassBtn" onClick={() => setShowPass(true)}>{t.pass}</button>}
      </div>
      <p className="hint">{data.canOrder ? t.hint : t.notInHouse}</p>
      {showPass && data.pass && <GuestPass pass={data.pass} t={t} day={day} onClose={() => setShowPass(false)} reload={load} />}

      {!open && (
        <>
          {cats.length > 1 && (
            <div className="gpTabs" role="tablist">
              <button type="button" role="tab" aria-selected={!cat} className={!cat ? "on" : ""} onClick={() => setCat("")}>{t.all}</button>
              {cats.map(([k, label]) => <button type="button" role="tab" key={k} aria-selected={cat === k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{label}</button>)}
            </div>
          )}
          <div className="gpList">
            {shown.map((p) => (
              <article key={p.id} className={`gpCard${p.guestDiscount !== null ? " guests" : ""}`} onClick={() => choose(p)}>
                {p.guestDiscount !== null && <span className="gpRibbon">⭐ {t.guestsOnly}{p.guestDiscount ? ` · −${p.guestDiscount}%` : ""}</span>}
                <div className="gpCardRow">
                  {p.logo ? <img src={p.logo} alt="" /> : <span className="gpIcon">{p.icon}</span>}
                  <div><b>{p.name}</b><small>{p.categoryLabel}{p.hours ? ` · ${p.hours}` : ""}</small>{p.description && <small className="gpDesc">{p.description}</small>}</div>
                </div>
                {p.offers.slice(0, 2).map((o) => <p key={o.id} className="gpOffer">🏷️ {o.title}{o.discountPercent ? ` −${o.discountPercent}%` : ""}{o.timeFrom ? ` · ${t.hours.replace("{from}", o.timeFrom).replace("{to}", o.timeTo)}` : ""}</p>)}
              </article>
            ))}
          </div>
        </>
      )}

      {open && (
        <div className="gpDetail">
          <button type="button" className="linkButton" onClick={() => setOpenId(null)}>{t.back}</button>
          <div className="gpCardRow">
            {open.logo ? <img src={open.logo} alt="" /> : <span className="gpIcon">{open.icon}</span>}
            <div><b>{open.name}</b><small>{open.categoryLabel}{open.hours ? ` · ${open.hours}` : ""}</small>{open.address && <small>📍 {open.address}</small>}</div>
          </div>
          {open.description && <p className="hint">{open.description}</p>}
          <div className="gpLinks">
            {open.phone && <a href={`tel:${open.phone.replace(/\s/g, "")}`}>📞 {t.call}</a>}
            {open.menuUrl && <a href={open.menuUrl} target="_blank" rel="noreferrer">📋 {t.menuLink}</a>}
            {open.website && <a href={open.website} target="_blank" rel="noreferrer">🌐 Web</a>}
          </div>
          {open.offers.map((o) => (
            <div key={o.id} className={`gpOfferBox${o.guestsOnly ? " guests" : ""}`}>
              {o.guestsOnly && <small className="gpRibbon">⭐ {t.guestsOnly}</small>}
              <b>{o.title}{o.discountPercent ? ` · −${o.discountPercent}%` : ""}</b>
              {o.body && <small>{o.body}</small>}
              <small>{t.until.replace("{date}", day(o.endsOn))}{o.timeFrom ? ` · ${t.hours.replace("{from}", o.timeFrom).replace("{to}", o.timeTo)}` : ""} · {uses(o.maxUses)}{o.code ? <> · <code>{o.code}</code></> : ""}</small>
              {o.guestsOnly && !o.code && <small>{t.discountAtShop}</small>}
            </div>
          ))}
          {open.items.length > 0 && <h4>{t.catalogue}</h4>}
          {open.items.map((i, n) => (
            <div key={i.id}>
              {i.section && i.section !== open.items[n - 1]?.section && <h5 className="gpSection">{i.section}</h5>}
              <article className="gOrderItem">
                <div><b>{i.name}</b>{i.description && <small>{i.description}</small>}</div>
                <span className="gOrderPrice">{money(i.priceCents)}</span>
                {cart[i.id] ? (
                  <span className="gpQty"><button type="button" aria-label="−" onClick={() => setCart({ ...cart, [i.id]: cart[i.id] - 1 })}>−</button><b>{cart[i.id]}</b><button type="button" aria-label="+" disabled={cart[i.id] >= 50} onClick={() => setCart({ ...cart, [i.id]: cart[i.id] + 1 })}>+</button></span>
                ) : <button type="button" className="gOrderBtn" disabled={!data.canOrder} onClick={() => setCart({ ...cart, [i.id]: 1 })}>{t.add}</button>}
              </article>
            </div>
          ))}
          {lines.length > 0 && (
            <form className="gOrderForm" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "order", order: { partnerId: open.id, items: lines.map((l) => ({ id: l.id, qty: l.qty })), ...form, code: form.code.trim().toUpperCase() } })) { setCart({}); setOpenId(null); setMsg(t.sent); } }}>
              <b>🛒 {t.cart}</b>
              <ul className="gpCartLines">{lines.map((l) => <li key={l.id}>{l.qty} × {l.name}<span>{money(l.priceCents * l.qty)}</span></li>)}</ul>
              {open.delivery && open.pickup && (
                <div className="gpChoice">
                  <label className="inline"><input type="radio" name="ful" checked={form.fulfilment === "pickup"} onChange={() => setForm({ ...form, fulfilment: "pickup" })} /> 🏃 {t.pickup}</label>
                  <label className="inline"><input type="radio" name="ful" checked={form.fulfilment === "delivery"} onChange={() => setForm({ ...form, fulfilment: "delivery" })} /> 🚚 {t.delivery}</label>
                </div>
              )}
              {!(open.delivery && open.pickup) && <small>{open.delivery ? `🚚 ${t.delivery}` : `🏃 ${t.pickup}`}</small>}
              <label>{t.when}<input maxLength={60} placeholder={t.whenHint} value={form.wantedAt} onChange={(e) => setForm({ ...form, wantedAt: e.target.value })} /></label>
              <label>{t.note}<input maxLength={400} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              <div className="gpChoice"><span>{t.pay}:</span>{open.payMethods.map((m) => <label className="inline" key={m}><input type="radio" name="pay" checked={form.payMethod === m} onChange={() => setForm({ ...form, payMethod: m })} /> {m === "cash" ? `💶 ${t.cash}` : m === "pos" ? `💳 ${t.pos}` : `🔗 ${t.link}`}</label>)}</div>
              {open.offers.some((o) => o.code) && <label>{t.code} <small>({t.codeHint})</small><input maxLength={30} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>}
              <div className="gpTotals">
                {discount > 0 && <><span>{t.subtotal}</span><span>{money(subtotal)}</span><span>{form.code.toUpperCase()}</span><span>−{money(discount)}</span></>}
                <b>{t.total}</b><b>{money(subtotal - discount)}</b>
              </div>
              <button className="gOrderBtn" disabled={busy || !data.canOrder}>{t.place}</button>
            </form>
          )}
        </div>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}

      {data.orders.length > 0 && (
        <div className="gOrderGroup"><h4>{t.yourOrders}</h4>
          <ul className="gOrderList gpOrders">{data.orders.map((o) => (
            <li key={o.id}>
              <span><b>{o.partner}</b> · {o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}{o.partnerNote ? <><br /><small>💬 {o.partnerNote}</small></> : null}</span>
              <b>{money(o.totalCents)}</b>
              <i className={`st-${["completed", "ready", "accepted"].includes(o.status) ? "done" : ["declined", "cancelled"].includes(o.status) ? "declined" : "confirmed"}`}>{(t as Record<string, string>)[o.status] ?? o.status}</i>
              {o.paymentLink && !o.paid && !["declined", "cancelled"].includes(o.status) && <a className="gOrderBtn" href={o.paymentLink} target="_blank" rel="noreferrer">{t.payNow}</a>}
              {o.status === "placed" && <button type="button" className="linkButton" disabled={busy} onClick={() => void post({ action: "cancel", id: o.id })}>{t.cancel}</button>}
            </li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}

/** QR + 6-digit code for this minute; reloads itself when the minute changes. */
function GuestPass({ pass, t, day, onClose, reload }: { pass: Pass; t: (typeof partnerTexts)["en"]; day: (iso: string) => string; onClose: () => void; reload: () => Promise<void> }) {
  const [img, setImg] = useState("");
  const [left, setLeft] = useState(Math.ceil(pass.refreshInMs / 1000));
  useEffect(() => { void QRCode.toDataURL(pass.qr, { margin: 1, width: 260, errorCorrectionLevel: "M" }).then(setImg); }, [pass.qr]);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((pass.refreshInMs - (Date.now() - started)) / 1000));
      setLeft(s);
      if (s === 0) void reload();
    }, 1000);
    return () => clearInterval(id);
  }, [pass, reload]);
  return (
    <div className="gPassOverlay" role="dialog" aria-label={t.pass} onClick={onClose}>
      <div className="gPassCard" onClick={(e) => e.stopPropagation()}>
        <img src="/hotel-corali-logo.png" alt="Hotel Corali" className="gPassLogo" />
        <b className="gPassName">{pass.firstName}</b>
        <small>{t.passStay.replace("{date}", day(pass.checkOut))}</small>
        {img ? <img src={img} alt="QR" className="gPassQr" /> : <div className="gPassQr" />}
        <div className="gPassCode">{pass.code.slice(0, 3)} {pass.code.slice(3)}</div>
        <small className="gPassTimer">{t.passRefresh.replace("{s}", String(left))}</small>
        <p>{t.passHelp}</p>
        <button type="button" className="gOrderBtn" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  );
}
