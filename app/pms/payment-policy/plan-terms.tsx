"use client";
import { useState } from "react";
import type { BookingLanguage } from "@/lib/booking-i18n";
import { calculatePayment, planPaymentTerms, type PaymentPolicy } from "@/lib/payment-policy";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Plan = { planKey: string; name: string; active: boolean; depositPercent: number | null; balanceMode: string; balanceDaysBefore: number | null; fullPrepayment: boolean };
const modes = ["general", "cancellation_deadline", "days_before", "at_hotel"] as const;

export function PlanTermsEditor({ lang, plans: initial, general, cancellationDays, canEdit }: { lang: PmsLang; plans: Plan[]; general: PaymentPolicy; cancellationDays: number; canEdit: boolean }) {
  const t = pmsT(lang);
  const [plans, setPlans] = useState(initial);
  const [msg, setMsg] = useState("");
  const [arrival] = useState(() => new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  const set = (i: number, patch: Partial<Plan>) => setPlans((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  // Example on a €1,000 stay arriving in 60 days so staff can see the effect of each setting.
  const example = (p: Plan) => {
    const terms = planPaymentTerms(general, p, cancellationDays);
    const pay = calculatePayment(100000, arrival, terms.policy);
    const when = terms.fullPrepayment ? "" : terms.atHotel ? t("pp.exAtHotel") : t("pp.exAuto", { days: terms.autoChargeDays ?? 0 });
    return terms.fullPrepayment ? t("pp.exFull") : t("pp.exDeposit", { now: (pay.payableNowCents / 100).toFixed(0), rest: (pay.balanceCents / 100).toFixed(0), when });
  };
  async function save() {
    const r = await fetch("/api/pms/payment-policy/plans", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plans: plans.map(({ planKey, depositPercent, balanceMode, balanceDaysBefore, fullPrepayment }) => ({ planKey, depositPercent, balanceMode, balanceDaysBefore, fullPrepayment })) }) });
    setMsg(r.ok ? t("pp.saved") : t("pp.failed"));
  }
  return (
    <article className="card">
      <h2>{t("pp.plans")}</h2>
      <p>{t("pp.plansHelp", { days: cancellationDays })}</p>
      <div className="tableWrap">
        <table className="planTerms">
          <thead><tr><th>{t("pp.plan")}</th><th>{t("pp.fullPrepayment")}</th><th>{t("pp.deposit")}</th><th>{t("pp.balance")}</th><th>{t("pp.days")}</th><th>{t("pp.example")}</th></tr></thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.planKey} className={p.active ? undefined : "inactive"}>
                <td><b>{p.name}</b><small>{p.planKey}</small></td>
                <td><input type="checkbox" aria-label={t("pp.fullPrepayment")} checked={p.fullPrepayment} disabled={!canEdit} onChange={(e) => set(i, { fullPrepayment: e.target.checked })} /></td>
                <td><input type="number" min={0} max={100} placeholder={`${general.depositPercent}`} aria-label={t("pp.deposit")} value={p.depositPercent ?? ""} disabled={!canEdit || p.fullPrepayment} onChange={(e) => set(i, { depositPercent: e.target.value === "" ? null : Math.max(0, Math.min(100, Math.trunc(Number(e.target.value)))) })} /></td>
                <td><select aria-label={t("pp.balance")} value={p.balanceMode} disabled={!canEdit || p.fullPrepayment} onChange={(e) => set(i, { balanceMode: e.target.value })}>{modes.map((m) => <option key={m} value={m}>{t(`pp.mode.${m}` as PmsKey)}</option>)}</select></td>
                <td><input type="number" min={0} max={365} aria-label={t("pp.days")} value={p.balanceMode === "days_before" ? (p.balanceDaysBefore ?? 7) : p.balanceMode === "cancellation_deadline" ? cancellationDays : ""} disabled={!canEdit || p.fullPrepayment || p.balanceMode !== "days_before"} onChange={(e) => set(i, { balanceDaysBefore: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value)) || 0)) })} /></td>
                <td><small>{example(p)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && <div className="actions"><button type="button" onClick={save}>{t("pp.save")}</button></div>}
      <p className="notice" role="status">{msg}</p>
    </article>
  );
}

const langs: { code: BookingLanguage; name: string }[] = [{ code: "el", name: "Ελληνικά" }, { code: "en", name: "English" }, { code: "fr", name: "Français" }, { code: "de", name: "Deutsch" }, { code: "it", name: "Italiano" }, { code: "es", name: "Español" }];

export function PolicyTextsEditor({ lang, initial, canEdit }: { lang: PmsLang; initial: Record<BookingLanguage, string>; canEdit: boolean }) {
  const t = pmsT(lang);
  const [texts, setTexts] = useState(initial);
  const [tab, setTab] = useState<BookingLanguage>(lang);
  const [msg, setMsg] = useState("");
  async function save() {
    const r = await fetch("/api/pms/payment-policy/texts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts }) });
    setMsg(r.ok ? t("pp.saved") : t("pp.failed"));
  }
  return (
    <article className="card">
      <h2>{t("pp.texts")}</h2>
      <p>{t("pp.textsHelp")}</p>
      <div className="segmented" role="group">{langs.map((l) => <button key={l.code} type="button" aria-pressed={tab === l.code} onClick={() => setTab(l.code)}>{l.name}</button>)}</div>
      <textarea className="policyEditor" rows={18} maxLength={8000} disabled={!canEdit} value={texts[tab]} onChange={(e) => setTexts((x) => ({ ...x, [tab]: e.target.value }))} />
      {canEdit && <div className="actions"><button type="button" onClick={save}>{t("pp.save")}</button></div>}
      <p className="notice" role="status">{msg}</p>
    </article>
  );
}
