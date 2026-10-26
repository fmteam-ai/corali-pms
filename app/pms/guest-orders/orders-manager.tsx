"use client";
import Link from "next/link";
import { useState } from "react";
import type { listOrders } from "@/lib/guest-orders";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Order = Awaited<ReturnType<typeof listOrders>>[number];

export function GuestOrdersManager({ lang, initial, canHandle }: { lang: PmsLang; initial: Order[]; canHandle: boolean }) {
  const t = pmsT(lang);
  const [orders, setOrders] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
  async function act(body: object, id: number) {
    setBusy(id); setMsg("");
    try {
      const r = await fetch("/api/pms/guest-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `go.err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("go.failed")); return; }
      setOrders(d.orders); setMsg(t("go.done"));
    } finally { setBusy(null); }
  }
  const pending = orders.filter((o) => o.status === "pending");
  return (
    <div className="goList">
      <p className="notice" role="status">{msg}</p>
      {orders.length === 0 && <p className="muted">{t("go.empty")}</p>}
      {orders.map((o) => (
        <article key={o.id} className={`card goItem st-${o.status}`}>
          <div className="goMain">
            <b>{o.kind === "upgrade" ? "⬆️" : o.kind === "late_checkout" ? "🕕" : "✨"} {o.title}</b>
            <span><Link href={`/pms/reservations?q=${encodeURIComponent(o.reference)}`}>{o.reference}</Link> · {o.guest}{o.room ? ` · ${t("hkb.room", { code: o.room })}` : ""} · {o.checkIn.split("-").reverse().join("/")} → {o.checkOut.split("-").reverse().join("/")}</span>
            {(o.date || o.time) && <span>📅 {o.date ? o.date.split("-").reverse().join("/") : ""} {o.time ?? ""}</span>}
            {o.note && <span>📝 {o.note}</span>}
            <small className="muted">{when(o.createdAt)} · {t(o.source === "checkin" ? "go.fromCheckin" : "go.fromManage")}{o.declineReason ? ` · ${o.declineReason}` : ""}</small>
          </div>
          <strong className="goAmount">{money(o.amountCents)}</strong>
          {o.status === "pending" && canHandle ? (
            <div className="goActions">
              <button type="button" className="primaryAction" disabled={busy === o.id} onClick={() => void act({ action: "confirm", id: o.id }, o.id)}>✓ {t("go.confirm")}</button>
              <button type="button" className="secondaryButton" disabled={busy === o.id} onClick={() => { const reason = prompt(t("go.reason")); if (reason !== null) void act({ action: "decline", id: o.id, reason }, o.id); }}>{t("go.decline")}</button>
            </div>
          ) : <span className={`goStatus st-${o.status}`}>{t(`go.st.${o.status}` as PmsKey)}</span>}
        </article>
      ))}
      {pending.length > 0 && <small className="muted">{t("go.help")}</small>}
    </div>
  );
}
