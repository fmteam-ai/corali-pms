"use client";
import { useEffect, useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Doc = { id: number; payer: string; invoice_type: string; series: string; aa: number; issue_date: string; total_cents: number; status: string; mark: string | null; qr_url: string | null; last_error: string | null; environment: string };

export function FiscalPanel({ lang, bookingId, canWrite, payersWithDetails }: { lang: PmsLang; bookingId: number; canWrite: boolean; payersWithDetails: string[] }) {
  const t = pmsT(lang);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(Number(c) / 100);
  const label = (key: string) => { const k = key as PmsKey; return t(k) === k ? key : t(k); };

  useEffect(() => {
    fetch(`/api/pms/reservations/${bookingId}/fiscal`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setDocs(d.documents)).catch(() => undefined);
  }, [bookingId]);

  async function act(body: object, confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/pms/reservations/${bookingId}/fiscal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.documents) setDocs(d.documents);
      setMsg(r.ok ? t("fiscal.issued") : label(`err.${d.error}`) === `err.${d.error}` ? t("res.failed") : label(`err.${d.error}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fiscal">
      <h3>{t("fiscal.title")}</h3>
      <p className="hint">{t("fiscal.hint")}</p>
      {canWrite && (
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => act({ action: "issue", payer: "guest" }, t("fiscal.confirm"))}>{t("fiscal.issueReceipt")}</button>
          {payersWithDetails.includes("company") && <button type="button" disabled={busy} onClick={() => act({ action: "issue", payer: "company" }, t("fiscal.confirm"))}>{t("fiscal.issueCompany")}</button>}
          {payersWithDetails.includes("agency") && <button type="button" disabled={busy} onClick={() => act({ action: "issue", payer: "agency" }, t("fiscal.confirm"))}>{t("fiscal.issueAgency")}</button>}
        </div>
      )}
      {docs.length === 0 ? <p>{t("fiscal.none")}</p> : (
        <div className="tableWrap"><table><thead><tr><th>{t("fiscal.doc")}</th><th>{t("folio.payer")}</th><th>{t("folio.when")}</th><th>{t("res.total")}</th><th>{t("fiscal.status")}</th><th>MARK</th><th /></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id}>
              <td>{label(`fiscal.type.${d.invoice_type}`)}<small>{d.series}-{d.aa}{d.environment !== "prod" ? ` · ${t("fiscal.test")}` : ""}</small></td>
              <td>{t(`folio.payer.${d.payer}` as PmsKey)}</td>
              <td>{d.issue_date}</td>
              <td>{money(d.total_cents)}</td>
              <td><span className={`fiscalStatus st-${d.status}`}>{label(`fiscal.st.${d.status}`)}</span>{d.last_error && d.status === "failed" && <small title={d.last_error}>{d.last_error.slice(0, 80)}</small>}</td>
              <td>{d.mark ?? "—"}{d.qr_url && <small><a href={d.qr_url} target="_blank" rel="noopener noreferrer">{t("fiscal.qr")}</a></small>}</td>
              <td className="rowActions">
                {canWrite && (d.status === "failed" || d.status === "pending") && <button type="button" disabled={busy} onClick={() => act({ action: "retry", documentId: d.id }, t("fiscal.confirm"))}>{t("fiscal.retry")}</button>}
                {canWrite && d.status !== "cancelled" && <button type="button" className="danger" disabled={busy} onClick={() => act({ action: "cancel", documentId: d.id }, t("fiscal.confirmCancel"))}>{t("fiscal.cancel")}</button>}
              </td>
            </tr>
          ))}</tbody></table></div>
      )}
      <p className="notice" role="status">{msg}</p>
    </section>
  );
}
