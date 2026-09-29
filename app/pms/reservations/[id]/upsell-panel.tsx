"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import type { UpsellSuggestion } from "@/lib/upsell-db";

export function UpsellPanel({ lang, bookingId, stays, suggestions, canAdd }: { lang: PmsLang; bookingId: number; stays: number; suggestions: UpsellSuggestion[]; canAdd: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [added, setAdded] = useState<number[]>([]);
  const [msg, setMsg] = useState("");
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  async function add(s: UpsellSuggestion) {
    if (!confirm(t("up.confirm", { name: s.name, amount: money(s.amountCents) }))) return;
    const r = await fetch(`/api/pms/reservations/${bookingId}/folio`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryType: "charge", category: "extra", description: s.quantity > 1 ? `${s.name} × ${s.quantity}` : s.name, amountCents: s.amountCents, payer: "guest" }) });
    if (!r.ok) { setMsg(t("up.failed")); return; }
    setAdded((a) => [...a, s.id]);
    setMsg(t("up.added"));
    router.refresh();
  }
  return (
    <article>
      <h2>{t("up.title")}</h2>
      <small>{stays > 0 ? t("up.returning", { n: stays }) : t("up.firstStay")} · {t("up.noBreakfast")}</small>
      {suggestions.length === 0 && <p>{t("up.none")}</p>}
      <ul className="upsellList">
        {suggestions.map((s) => (
          <li key={s.id}>
            <div><b>{s.name}</b><small>{t(`up.reason.${s.reason}` as PmsKey)} · {s.quantity > 1 ? `${money(s.unitCents)} × ${s.quantity} = ` : ""}{money(s.amountCents)}</small></div>
            {canAdd && <button type="button" disabled={added.includes(s.id)} onClick={() => add(s)}>{added.includes(s.id) ? "✓" : t("up.add")}</button>}
          </li>
        ))}
      </ul>
      <p className="notice" role="status">{msg}</p>
    </article>
  );
}
