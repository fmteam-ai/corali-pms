"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { payers, summarizeFolio, type FolioSummary } from "@/lib/folio";
import { FiscalPanel } from "./fiscal-panel";

type Night = { stay_date: string; amount_cents: number; original_cents?: number; payer: string };
type Entry = { id: number; entry_type: string; category: string | null; description: string; amount_cents: number; payer: string; payment_method: string | null; receipt_reference: string | null; created_at: number };
type PayerDetails = { payer_type: string; name: string; vat_number: string; tax_office: string; address: string; email: string };
type Folio = { nights: Night[]; entries: Entry[]; payers: PayerDetails[]; summary: FolioSummary };

const methods = ["cash", "pos", "bank", "stripe", "viva", "other"] as const;

export function FolioPanel({ lang, bookingId, reference, guestName, initial, canWrite, canEditRates }: { lang: PmsLang; bookingId: number; reference: string; guestName: string; initial: Folio; canWrite: boolean; canEditRates: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const locale = pmsLocale(lang);
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
  const [folio, setFolio] = useState(initial);
  const [nights, setNights] = useState(() => initial.nights.map((n) => ({ ...n, value: (Number(n.amount_cents) / 100).toFixed(2) })));
  const [entryType, setEntryType] = useState("charge");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const errorText = (code?: string) => (code && t(`err.${code}` as PmsKey) !== `err.${code}` ? t(`err.${code}` as PmsKey) : t("folio.failed"));

  async function reload() {
    const r = await fetch(`/api/pms/reservations/${bookingId}/folio`, { cache: "no-store" });
    if (!r.ok) return;
    const d = (await r.json()) as Folio;
    setFolio(d);
    setNights(d.nights.map((n) => ({ ...n, value: (Number(n.amount_cents) / 100).toFixed(2) })));
    router.refresh();
  }
  async function send(method: "POST" | "PATCH", body: object, success: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/pms/reservations/${bookingId}/folio`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(errorText(d.error)); return false; }
      setMsg(success);
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }
  async function addEntry(f: FormData) {
    const body = {
      entryType: f.get("entryType"),
      category: f.get("category") ?? "other",
      description: f.get("description"),
      amountCents: Math.round(Number(f.get("amount")) * 100),
      payer: f.get("payer"),
      paymentMethod: f.get("paymentMethod") || undefined,
      receiptReference: f.get("reference") || undefined,
    };
    await send("POST", body, t("folio.added"));
  }
  async function saveNights() {
    await send("PATCH", { action: "nightly", nights: nights.map((n) => ({ date: n.stay_date, amountCents: Math.round(Number(n.value) * 100), payer: n.payer })) }, t("folio.nightsSaved"));
  }
  async function savePayer(payerType: "company" | "agency", f: FormData) {
    await send("PATCH", { action: "payer_details", payerType, name: f.get("name") ?? "", vatNumber: f.get("vat") ?? "", taxOffice: f.get("taxOffice") ?? "", address: f.get("address") ?? "", email: f.get("email") ?? "" }, t("folio.detailsSaved"));
  }

  const draftNights = nights.map((n) => ({ stay_date: n.stay_date, amount_cents: Math.round(Number(n.value || 0) * 100), payer: n.payer }));
  const nightsChanged = nights.some((n, i) => Math.round(Number(n.value) * 100) !== Number(folio.nights[i]?.amount_cents) || n.payer !== folio.nights[i]?.payer);
  const s = nightsChanged ? summarizeFolio(draftNights, folio.entries) : folio.summary;
  const usedPayers = payers.filter((p) => p === "guest" || s.byPayer[p].charges !== 0 || s.byPayer[p].paid !== 0 || folio.payers.some((d) => d.payer_type === p));
  const detail = (p: "company" | "agency") => folio.payers.find((d) => d.payer_type === p);
  const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const typeLabel = (e: Entry) => t(`folio.type.${e.entry_type}` as PmsKey);
  const categoryLabel = (e: Entry) => (e.entry_type === "charge" ? t(`folio.cat.${e.category ?? "other"}` as PmsKey) : "");

  return (
    <article className="wide folio">
      <div className="folioHead">
        <div><h2>{t("folio.title")}</h2><small>{t("folio.notInvoice")}</small></div>
        <button type="button" className="secondaryButton" onClick={() => window.print()}>{t("folio.print")}</button>
      </div>
      <p className="printOnly"><strong>{reference}</strong> · {guestName}</p>
      <div className="folioSummary">
        <div><small>{t("folio.accommodation")}</small><b>{money(s.accommodation)}</b></div>
        <div><small>{t("folio.extras")}</small><b>{money(s.extras)}</b></div>
        <div><small>{t("folio.taxes")}</small><b>{money(s.taxes)}</b></div>
        {(s.adjustments !== 0 || s.discounts !== 0) && <div><small>{t("folio.adjustments")} / {t("folio.discounts")}</small><b>{money(s.adjustments - s.discounts)}</b></div>}
        <div className="total"><small>{t("folio.charges")}</small><b>{money(s.charges)}</b></div>
        <div><small>{t("folio.payments")}</small><b>{money(s.payments)}</b></div>
        {s.refunds > 0 && <div><small>{t("folio.refunds")}</small><b>{money(s.refunds)}</b></div>}
        <div className={s.balance > 0 ? "due" : "settled"}><small>{s.balance < 0 ? t("folio.credit") : t("folio.balance")}</small><b>{money(Math.abs(s.balance))}</b></div>
      </div>

      <h3>{t("folio.byPayer")}</h3>
      <div className="tableWrap"><table><thead><tr><th>{t("folio.payer")}</th><th>{t("folio.charges")}</th><th>{t("folio.paid")}</th><th>{t("folio.balance")}</th></tr></thead>
        <tbody>{usedPayers.map((p) => <tr key={p}><td>{t(`folio.payer.${p}` as PmsKey)}{p !== "guest" && detail(p)?.name ? ` · ${detail(p)?.name}` : ""}</td><td>{money(s.byPayer[p].charges)}</td><td>{money(s.byPayer[p].paid)}</td><td className={s.byPayer[p].balance > 0 ? "debit" : "credit"}>{money(s.byPayer[p].balance)}</td></tr>)}</tbody></table></div>

      <h3>{t("folio.nightly")}</h3>
      {canEditRates && <p className="hint">{t("folio.nightlyHint")}</p>}
      <div className="tableWrap"><table className="nightTable"><thead><tr><th>{t("folio.date")}</th><th>{t("folio.rate")}</th><th>{t("folio.payer")}</th><th>{t("folio.original")}</th></tr></thead>
        <tbody>{nights.map((n, i) => (
          <tr key={n.stay_date}>
            <td>{weekday(n.stay_date)}</td>
            <td>{canEditRates ? <input type="number" min="0" step="0.01" value={n.value} aria-label={`${t("folio.rate")} ${n.stay_date}`} onChange={(e) => setNights((v) => v.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} /> : money(n.amount_cents)}</td>
            <td>{canEditRates ? <select value={n.payer} aria-label={`${t("folio.payer")} ${n.stay_date}`} onChange={(e) => setNights((v) => v.map((x, j) => (j === i ? { ...x, payer: e.target.value } : x)))}>{payers.map((p) => <option key={p} value={p}>{t(`folio.payer.${p}` as PmsKey)}</option>)}</select> : t(`folio.payer.${n.payer}` as PmsKey)}</td>
            <td>{n.original_cents !== undefined && Number(n.original_cents) !== Math.round(Number(n.value) * 100) ? <s>{money(Number(n.original_cents))}</s> : ""}</td>
          </tr>
        ))}</tbody></table></div>
      {canEditRates && nights.length > 0 && (
        <div className="nightTools">
          <label>{t("folio.applyAll")} <input type="number" min="0" step="0.01" onChange={(e) => e.target.value && setNights((v) => v.map((x) => ({ ...x, value: e.target.value })))} /></label>
          <label>{t("folio.allPayer")} <select defaultValue="" onChange={(e) => e.target.value && setNights((v) => v.map((x) => ({ ...x, payer: e.target.value })))}><option value="" />{payers.map((p) => <option key={p} value={p}>{t(`folio.payer.${p}` as PmsKey)}</option>)}</select></label>
          <button type="button" disabled={busy || !nightsChanged || nights.some((n) => n.value === "" || Number(n.value) < 0)} onClick={saveNights}>{t("folio.saveNights")}</button>
        </div>
      )}

      <h3>{t("folio.entries")}</h3>
      <div className="tableWrap"><table><thead><tr><th>{t("folio.when")}</th><th>{t("folio.type")}</th><th>{t("folio.description")}</th><th>{t("folio.payer")}</th><th>{t("folio.method")}</th><th>{t("folio.amount")}</th></tr></thead>
        <tbody>{folio.entries.map((e) => (
          <tr key={`${e.id}-${e.created_at}`}>
            <td>{e.created_at ? new Date(Number(e.created_at)).toLocaleString(locale) : "—"}</td>
            <td>{typeLabel(e)}{categoryLabel(e) && <small>{categoryLabel(e)}</small>}</td>
            <td>{e.description}{e.receipt_reference && <small>{e.receipt_reference}</small>}</td>
            <td>{t(`folio.payer.${e.payer}` as PmsKey)}</td>
            <td>{e.payment_method ? (t(`folio.method.${e.payment_method}` as PmsKey).startsWith("folio.") ? e.payment_method : t(`folio.method.${e.payment_method}` as PmsKey)) : ""}</td>
            <td className={Number(e.amount_cents) < 0 ? "credit" : ""}>{money(Number(e.amount_cents))}</td>
          </tr>
        ))}</tbody></table></div>

      {canWrite && (
        <form action={addEntry} className="adminForm folioForm">
          <select name="entryType" value={entryType} onChange={(e) => setEntryType(e.target.value)} aria-label={t("folio.type")}>{["charge", "payment", "refund", "adjustment", "discount"].map((v) => <option key={v} value={v}>{t(`folio.type.${v}` as PmsKey)}</option>)}</select>
          {entryType === "charge" && <select name="category" defaultValue="extra" aria-label={t("folio.category")}>{["extra", "tax", "fee", "accommodation", "other"].map((v) => <option key={v} value={v}>{t(`folio.cat.${v}` as PmsKey)}</option>)}</select>}
          <input name="description" required minLength={2} placeholder={t("folio.description")} />
          <input name="amount" required type="number" min="0.01" step="0.01" placeholder={t("folio.amount")} />
          <select name="payer" aria-label={t("folio.payer")}>{payers.map((p) => <option key={p} value={p}>{t(`folio.payer.${p}` as PmsKey)}</option>)}</select>
          {(entryType === "payment" || entryType === "refund") && <select name="paymentMethod" aria-label={t("folio.method")}>{methods.map((m) => <option key={m} value={m}>{t(`folio.method.${m}` as PmsKey)}</option>)}</select>}
          {(entryType === "payment" || entryType === "refund") && <input name="reference" placeholder={t("folio.reference")} />}
          <button disabled={busy}>{t("folio.add")}</button>
        </form>
      )}

      {canWrite && (
        <div className="payerDetails">
          {(["company", "agency"] as const).map((p) => (
            <form key={p} action={(f) => savePayer(p, f)} className="policyForm">
              <h3>{t("folio.payerDetails")} · {t(`folio.payer.${p}` as PmsKey)}</h3>
              <label>{t("folio.payerName")}<input name="name" defaultValue={detail(p)?.name ?? ""} maxLength={200} /></label>
              <label>{t("folio.vat")}<input name="vat" defaultValue={detail(p)?.vat_number ?? ""} maxLength={30} /></label>
              <label>{t("folio.taxOffice")}<input name="taxOffice" defaultValue={detail(p)?.tax_office ?? ""} maxLength={100} /></label>
              <label>{t("folio.address")}<input name="address" defaultValue={detail(p)?.address ?? ""} maxLength={300} /></label>
              <label>Email<input name="email" type="email" defaultValue={detail(p)?.email ?? ""} /></label>
              <button disabled={busy}>{t("folio.saveDetails")}</button>
            </form>
          ))}
        </div>
      )}
      <p className="notice" role="status">{msg}</p>
      <FiscalPanel lang={lang} bookingId={bookingId} canWrite={canWrite} payersWithDetails={folio.payers.filter((d) => d.vat_number).map((d) => d.payer_type)} />
    </article>
  );
}
