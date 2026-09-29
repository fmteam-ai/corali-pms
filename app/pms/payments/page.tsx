import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { documentsBetween, paymentsBetween, takingsByMethod } from "@/lib/payments-report";
import { pmsLocale, type PmsKey } from "@/lib/pms-i18n";
import { getPmsT } from "@/lib/pms-lang";
import { hotelToday } from "@/lib/tape-chart";

const date = /^\d{4}-\d{2}-\d{2}$/;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; method?: string; tab?: string }> }) {
  const u = await requireUser("reports.financial");
  const { lang, t } = await getPmsT();
  const p = await searchParams;
  const today = hotelToday();
  const from = p.from && date.test(p.from) ? p.from : `${today.slice(0, 7)}-01`;
  const to = p.to && date.test(p.to) ? p.to : today;
  const tab = p.tab === "documents" ? "documents" : "payments";
  const method = p.method || null;
  const [payments, documents] = await Promise.all([paymentsBetween(u.ownerId, from, to, method), documentsBetween(u.ownerId, from, to)]);
  const locale = pmsLocale(lang);
  const money = (c: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(c / 100);
  const when = (ms: number) => new Date(ms).toLocaleString(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const methodLabel = (m: string | null) => { const k = `pay.m.${m || "other"}` as PmsKey; return t(k) !== k ? t(k) : m || "—"; };
  const takings = takingsByMethod(payments);
  const net = takings.reduce((a, x) => a + x.cents, 0);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ from, to, ...(method ? { method } : {}), tab, ...extra }).toString();
  const docTotal = documents.filter((d) => d.status !== "cancelled").reduce((a, d) => a + d.total_cents, 0);
  return (
    <section className="paymentsPage">
      <div className="pageTitle"><div><h1>{t("pay.title")}</h1><p>{t("pay.subtitle")}</p></div></div>
      <form className="search inlineDates">
        <label>{t("rev.from")}<input type="date" name="from" defaultValue={from} /></label>
        <label>{t("rev.to")}<input type="date" name="to" defaultValue={to} /></label>
        <input type="hidden" name="tab" value={tab} />
        {tab === "payments" && <label>{t("pay.method")}<select name="method" defaultValue={method ?? ""}><option value="">{t("pay.allMethods")}</option>{["card", "stripe", "cash", "bank_transfer", "pos", "prior", "other"].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></label>}
        <button>{t("rev.apply")}</button>
        <a className="secondaryLink" href={`/api/pms/payments/export?${qs({ kind: tab })}`}>{t("pay.export")}</a>
      </form>
      <div className="segmented" role="tablist">
        <Link role="tab" aria-selected={tab === "payments"} className={tab === "payments" ? "on" : undefined} href={`/pms/payments?${qs({ tab: "payments" })}`}>{t("pay.tabPayments")} · {payments.length}</Link>
        <Link role="tab" aria-selected={tab === "documents"} className={tab === "documents" ? "on" : undefined} href={`/pms/payments?${qs({ tab: "documents" })}`}>{t("pay.tabDocuments")} · {documents.length}</Link>
      </div>
      {tab === "payments" ? (
        <>
          <div className="kpiRow">
            <div><small>{t("pay.net")}</small><b>{money(net)}</b></div>
            {takings.map((x) => <div key={x.method}><small>{methodLabel(x.method)}</small><b>{money(x.cents)}</b></div>)}
          </div>
          <div className="tableWrap">
            <table className="numeric">
              <thead><tr><th>{t("pay.date")}</th><th>{t("pay.reservation")}</th><th>{t("pay.type")}</th><th>{t("pay.method")}</th><th>{t("pay.description")}</th><th>{t("pay.payer")}</th><th>{t("pay.amount")}</th><th>{t("pay.receipt")}</th><th>{t("pay.user")}</th></tr></thead>
              <tbody>
                {payments.map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.created_at)}</td>
                    <td><Link href={`/pms/reservations/${r.booking_id}`}>{r.reference}</Link><small>{r.guest_name}</small></td>
                    <td>{t(r.entry_type === "refund" ? "pay.refund" : "pay.payment")}</td>
                    <td>{methodLabel(r.payment_method)}</td>
                    <td>{r.description}</td>
                    <td>{r.payer}</td>
                    <td className={r.entry_type === "refund" ? "neg" : "pos"}><b>{money(-r.amount_cents)}</b></td>
                    <td>{r.receipt_reference ?? "—"}</td>
                    <td>{r.actor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {payments.length === 0 && <p>{t("pay.none")}</p>}
        </>
      ) : (
        <>
          <div className="kpiRow">
            <div><small>{t("pay.docTotal")}</small><b>{money(docTotal)}</b></div>
            <div><small>{t("pay.receipts")}</small><b>{documents.filter((d) => d.invoice_type.startsWith("11")).length}</b></div>
            <div><small>{t("pay.invoices")}</small><b>{documents.filter((d) => d.invoice_type.startsWith("2")).length}</b></div>
            <div><small>{t("pay.pendingMydata")}</small><b>{documents.filter((d) => d.status !== "sent" && d.status !== "cancelled").length}</b></div>
          </div>
          <div className="tableWrap">
            <table className="numeric">
              <thead><tr><th>{t("pay.date")}</th><th>{t("pay.docType")}</th><th>{t("pay.number")}</th><th>{t("pay.reservation")}</th><th>{t("pay.payer")}</th><th>{t("pay.amount")}</th><th>{t("pay.status")}</th><th>MARK</th><th /></tr></thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.issue_date}</td>
                    <td>{d.invoice_type.startsWith("11") ? t("pay.receipt") : t("pay.invoice")} <small>{d.invoice_type}</small></td>
                    <td>{d.series}-{d.aa}</td>
                    <td><Link href={`/pms/reservations/${d.booking_id}`}>{d.reference}</Link><small>{d.guest_name}</small></td>
                    <td>{d.payer}</td>
                    <td><b>{money(d.total_cents)}</b></td>
                    <td><span className={`noticeStatus ${d.status === "sent" ? "" : "open"}`}>{t(`pay.st.${d.status}` as PmsKey) === `pay.st.${d.status}` ? d.status : t(`pay.st.${d.status}` as PmsKey)}</span>{d.last_error && d.status !== "sent" ? <small title={d.last_error}>⚠️ {d.last_error.slice(0, 40)}</small> : null}</td>
                    <td>{d.mark ?? "—"}</td>
                    <td>{d.qr_url ? <a href={d.qr_url} target="_blank" rel="noopener noreferrer">QR</a> : null} <Link href={`/pms/reservations/${d.booking_id}#fiscal`}>{t("pay.open")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {documents.length === 0 && <p>{t("pay.noneDocs")}</p>}
        </>
      )}
    </section>
  );
}
