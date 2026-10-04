"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type State = { configured: boolean; authorization: { cents: number; at: number } | null; savedCard: boolean; balanceCents: number; heldDays?: number };

// Stripe virtual terminal: capture / release a held amount, or charge the card saved at booking.
export function StripePanel({ lang, bookingId, canWrite }: { lang: PmsLang; bookingId: number; canWrite: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [capture, setCapture] = useState("");
  const [charge, setCharge] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const euro = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  async function load() {
    const r = await fetch(`/api/pms/reservations/${bookingId}/stripe`, { cache: "no-store" }).catch(() => null);
    const d = r && r.ok ? await r.json() : null;
    if (!d) return;
    setState({ ...d, heldDays: d.authorization ? Math.floor((Date.now() - d.authorization.at) / 86_400_000) : 0 });
    setCapture(d.authorization ? String(d.authorization.cents / 100) : "");
    setCharge(d.balanceCents > 0 ? String(d.balanceCents / 100) : "");
  }
  useEffect(() => { queueMicrotask(() => void load()); }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(body: object, confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/pms/reservations/${bookingId}/stripe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({ ok: false, error: `HTTP_${r.status}` }));
      const code = String(d.error ?? "").split(":")[0];
      setMsg(d.ok ? { ok: true, text: t(`stp.done.${d.action}` as PmsKey) } : { ok: false, text: ["NO_AUTHORIZATION", "NO_SAVED_CARD", "AMOUNT_EXCEEDS_AUTHORIZATION", "AMOUNT_EXCEEDS_BALANCE", "AUTHENTICATION_REQUIRED", "CARD_DECLINED", "AUTHORIZATION_NOT_CAPTURABLE", "PAYMENT_NOT_CONFIGURED"].includes(code) ? t(`stp.err.${code}` as PmsKey) : t("stp.err.other", { code: d.error ?? r.status }) });
      if (d.ok) { await load(); router.refresh(); }
    } finally { setBusy(false); }
  }
  if (!state?.configured || (!state.authorization && !state.savedCard)) return null;
  const cents = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
  return (
    <article className="card stripePanel">
      <h2>💳 {t("stp.title")}</h2>
      {state.authorization && (
        <section>
          <p><b>{t("stp.held", { amount: euro(state.authorization.cents) })}</b><small>{t("stp.heldAgo", { days: state.heldDays ?? 0 })}</small></p>
          {canWrite && <div className="stripeRow">
            <label>{t("stp.amount")}<input type="number" min="0.01" step="0.01" max={state.authorization.cents / 100} value={capture} onChange={(e) => setCapture(e.target.value)} /></label>
            <button type="button" disabled={busy || !(cents(capture) > 0) || cents(capture) > state.authorization.cents} onClick={() => act({ action: "capture", amountCents: cents(capture) }, t("stp.confirmCapture", { amount: euro(cents(capture)) }))}>{t("stp.capture")}</button>
            <button type="button" className="danger" disabled={busy} onClick={() => act({ action: "release" }, t("stp.confirmRelease"))}>{t("stp.release")}</button>
          </div>}
        </section>
      )}
      {state.savedCard && (
        <section>
          <p><b>{t("stp.savedCard")}</b><small>{t("stp.balance", { amount: euro(state.balanceCents) })}</small></p>
          {canWrite && state.balanceCents > 0 && <div className="stripeRow">
            <label>{t("stp.amount")}<input type="number" min="0.01" step="0.01" max={state.balanceCents / 100} value={charge} onChange={(e) => setCharge(e.target.value)} /></label>
            <button type="button" disabled={busy || !(cents(charge) > 0) || cents(charge) > state.balanceCents} onClick={() => act({ action: "charge", amountCents: cents(charge) }, t("stp.confirmCharge", { amount: euro(cents(charge)) }))}>{t("stp.charge")}</button>
          </div>}
        </section>
      )}
      {msg && <p className={`testResult ${msg.ok ? "ok" : "fail"}`} role="status">{msg.ok ? "✅ " : "❌ "}{msg.text}</p>}
    </article>
  );
}
