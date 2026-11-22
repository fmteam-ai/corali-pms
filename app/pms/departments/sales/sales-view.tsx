"use client";
import { useState } from "react";
import { DepartmentIcon } from "@/app/manage-booking/department-icon";
import type { PosLink, SalesReport } from "@/lib/department-sales";
import { salesError, salesT } from "@/lib/department-sales-texts";
import type { DepartmentIcon as IconKey } from "@/lib/guest-portal-core";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

type Dept = { id: number; name: string; icon: IconKey };
const PAYMENTS = ["cash", "card", "room", "other"] as const;

/** Sales per department (period, figures, charts), POS connection per department and CSV import. */
export function SalesView({ lang, initial, initialPos, departments, canConnect }: { lang: PmsLang; initial: SalesReport; initialPos: PosLink[]; departments: Dept[]; canConnect: boolean }) {
  const t = salesT(lang);
  const [report, setReport] = useState(initial);
  const [pos, setPos] = useState(initialPos);
  const [range, setRange] = useState({ from: initial.from, to: initial.to });
  const [open, setOpen] = useState<number | null>(initial.departments[0]?.departmentId ?? null);
  const [key, setKey] = useState<{ departmentId: number; key: string } | null>(null);
  const [csv, setCsv] = useState<{ departmentId: number; text: string; name: string }>({ departmentId: departments[0]?.id ?? 0, text: "", name: "" });
  const [csvResult, setCsvResult] = useState<{ added: number; duplicates: number; totalCents: number; errors: string[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR", maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }) : t("pos.never"));
  const name = (id: number) => report.names[id]?.name ?? departments.find((d) => d.id === id)?.name ?? `#${id}`;
  const icon = (id: number) => (report.names[id]?.icon ?? departments.find((d) => d.id === id)?.icon ?? "bell") as IconKey;
  const change = (p: number | null) => (p === null ? <span className="muted">—</span> : <span className={p >= 0 ? "dsUp" : "dsDown"}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}%</span>);

  async function load(from: string, to: string) {
    setBusy(true); setMsg("");
    try {
      const d = await fetch(`/api/pms/department-sales?from=${from}&to=${to}`, { cache: "no-store" }).then((r) => r.json());
      if (d.ok) { setReport(d.report); setPos(d.pos); setRange({ from, to }); } else setMsg(salesError(lang, d.error));
    } finally { setBusy(false); }
  }
  const preset = (days: number | "month") => {
    const to = initial.to;
    const from = days === "month" ? `${to.slice(0, 8)}01` : new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    void load(from, to);
  };
  async function post(body: object) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/department-sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(salesError(lang, d.error)); return null; }
      if (d.pos) setPos(d.pos);
      return d;
    } finally { setBusy(false); }
  }
  async function importCsv() {
    const d = await post({ action: "import_csv", departmentId: csv.departmentId, csv: csv.text });
    if (d?.result) { setCsvResult(d.result); setCsv({ ...csv, text: "", name: "" }); await load(range.from, range.to); }
  }
  const guide = (k: string) => `curl -X POST ${typeof window === "undefined" ? "" : window.location.origin}/api/v1/pos/sales \\\n  -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" \\\n  -d '{"receipt_id":"1001","payment":"room","room":"112","items":[{"name":"Mojito","quantity":2,"unit_price":9.5}]}'`;

  const max = Math.max(1, ...report.departments.map((d) => d.revenueCents));
  return (
    <div className="dsPage">
      <div className="card dsFilters">
        <span className="dsPresets">{([7, 30, 90] as const).map((n) => <button key={n} type="button" className="secondaryButton" disabled={busy} onClick={() => preset(n)}>{t(`sales.days${n}`)}</button>)}<button type="button" className="secondaryButton" disabled={busy} onClick={() => preset("month")}>{t("sales.month")}</button></span>
        <label>{t("sales.from")}<input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label>{t("sales.to")}<input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <button type="button" className="primaryAction" disabled={busy} onClick={() => void load(range.from, range.to)}>{t("sales.show")}</button>
        <a className="secondaryButton" href={`/api/pms/department-sales?from=${report.from}&to=${report.to}&format=csv`}>⬇ {t("sales.csv")}</a>
      </div>
      <p className="notice" role="status">{msg}</p>

      <div className="dsTiles">
        <div className="card dsTile"><small>{t("sales.total")}</small><b>{money(report.totalCents)}</b><span>{report.changePercent === null ? t("sales.noPrev") : <>{change(report.changePercent)} {t("sales.vsPrev")}</>}</span></div>
        <div className="card dsTile"><small>{t("sales.receipts")}</small><b>{report.receipts}</b></div>
        <div className="card dsTile"><small>{t("sales.avg")}</small><b>{money(report.avgTicketCents)}</b></div>
        <div className="card dsTile"><small>{t("sales.perDay")}</small><b>{money(report.perDayCents)}</b><span className="muted">{report.days} {lang === "el" ? "μέρες" : "days"}</span></div>
      </div>

      {report.departments.length === 0 ? <p className="card muted">{t("sales.none")}</p> : (
        <div className="card">
          <div className="tableWrap"><table className="dsTable">
            <thead><tr><th>{t("sales.department")}</th><th>{t("sales.revenue")}</th><th className="dsBarCol">{t("sales.share")}</th><th>{t("sales.receipts")}</th><th>{t("sales.avg")}</th><th>{t("sales.guests")}</th><th>{t("sales.change")}</th></tr></thead>
            <tbody>{report.departments.map((d) => (
              <tr key={d.departmentId} className={open === d.departmentId ? "on" : ""} onClick={() => setOpen(open === d.departmentId ? null : d.departmentId)}>
                <td><button type="button" className="linkButton" aria-expanded={open === d.departmentId}><DepartmentIcon icon={icon(d.departmentId)} /> {name(d.departmentId)}</button></td>
                <td><b>{money(d.revenueCents)}</b></td>
                <td className="dsBarCol"><span className="dsBar" title={`${Math.round((d.revenueCents / Math.max(1, report.totalCents)) * 100)}%`}><i style={{ width: `${(d.revenueCents / max) * 100}%` }} /></span> <small>{Math.round((d.revenueCents / Math.max(1, report.totalCents)) * 100)}%</small></td>
                <td>{d.receipts}</td><td>{money(d.avgTicketCents)}</td>
                <td>{d.guests}{d.penetration !== null ? <small className="muted"> · {d.penetration}% {t("sales.penetration")}</small> : null}</td>
                <td>{change(d.changePercent)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {report.departments.filter((d) => d.departmentId === open).map((d) => {
        const dayMax = Math.max(1, ...d.daily.map((x) => x.revenueCents)), hourMax = Math.max(1, ...d.byHour);
        const paid = PAYMENTS.reduce((s, p) => s + d.byPayment[p], 0) || 1;
        return (
          <div key={d.departmentId} className="card dsDetail">
            <h2><DepartmentIcon icon={icon(d.departmentId)} /> {name(d.departmentId)}</h2>
            <div className="dsMix">
              <div className="dsStack" role="img" aria-label={PAYMENTS.map((p) => `${t(`sales.pay.${p}`)} ${money(d.byPayment[p])}`).join(", ")}>
                {PAYMENTS.filter((p) => d.byPayment[p] > 0).map((p) => <i key={p} className={`pay-${p}`} style={{ flexGrow: d.byPayment[p] / paid }} title={`${t(`sales.pay.${p}`)}: ${money(d.byPayment[p])}`} />)}
              </div>
              <ul className="dsLegend">{PAYMENTS.filter((p) => d.byPayment[p] > 0).map((p) => <li key={p}><span className={`dot pay-${p}`} aria-hidden />{t(`sales.pay.${p}`)} <b>{money(d.byPayment[p])}</b> <small className="muted">{Math.round((d.byPayment[p] / paid) * 100)}%</small></li>)}</ul>
              <p className="muted">{(["app", "pos", "csv"] as const).filter((s) => d.bySource[s] > 0).map((s) => `${t(`sales.src.${s}`)} ${money(d.bySource[s])}`).join(" · ")}</p>
            </div>
            <div className="dsCharts">
              <figure><figcaption>{t("sales.daily")}</figcaption>
                <div className="dsCols">{d.daily.map((x) => <span key={x.date} className="dsCol" tabIndex={0}><i style={{ height: `${(x.revenueCents / dayMax) * 100}%` }} /><em role="tooltip">{x.date.split("-").reverse().slice(0, 2).join("/")} · {money(x.revenueCents)}</em></span>)}</div>
                <div className="dsAxis"><small>{d.daily[0]?.date.split("-").reverse().slice(0, 2).join("/")}</small><small>{d.daily.at(-1)?.date.split("-").reverse().slice(0, 2).join("/")}</small></div>
              </figure>
              <figure><figcaption>{t("sales.byHour")}</figcaption>
                <div className="dsCols">{d.byHour.map((v, h) => <span key={h} className="dsCol" tabIndex={0}><i style={{ height: `${(v / hourMax) * 100}%` }} /><em role="tooltip">{String(h).padStart(2, "0")}:00 · {money(v)}</em></span>)}</div>
                <div className="dsAxis"><small>00</small><small>06</small><small>12</small><small>18</small><small>23</small></div>
              </figure>
            </div>
            {d.topItems.length > 0 && <><h3>{t("sales.topItems")}</h3><div className="tableWrap"><table><tbody>{d.topItems.map((i) => <tr key={i.name}><td>{i.name}</td><td>{i.quantity} {t("sales.qty")}</td><td><b>{money(i.revenueCents)}</b></td></tr>)}</tbody></table></div></>}
          </div>
        );
      })}

      <div className="card">
        <h2>{t("pos.title")}</h2>
        <p className="muted">{t("pos.help")}</p>
        <div className="tableWrap"><table><tbody>{departments.map((d) => {
          const p = pos.find((x) => x.departmentId === d.id);
          return (
            <tr key={d.id}>
              <td><DepartmentIcon icon={d.icon} /> <b>{d.name}</b></td>
              <td>{p ? <span className="dsOk">● {t("pos.connected")}{p.name ? ` · ${p.name}` : ""}</span> : <span className="muted">○ {t("pos.notConnected")}</span>}</td>
              <td className="muted">{p ? `${t("pos.lastSale")}: ${when(p.lastSaleAt)} · ${p.salesToday} ${t("pos.today")} · ${t("pos.lastSeen")}: ${when(p.lastSeenAt)}` : ""}</td>
              <td>{canConnect && <span className="dsActions">
                <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { if (p && !confirm(t("pos.renewConfirm"))) return; const n = p ? p.name : prompt(t("pos.name")) ?? ""; const r = await post({ action: "pos_create", departmentId: d.id, name: n }); if (r?.key) setKey({ departmentId: d.id, key: r.key }); }}>{p ? t("pos.renew") : t("pos.create")}</button>
                {p && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("pos.revokeConfirm"))) void post({ action: "pos_revoke", departmentId: d.id }); }}>{t("pos.revoke")}</button>}
              </span>}</td>
            </tr>
          );
        })}</tbody></table></div>
        {key && (
          <div className="dsKey">
            <p><b>{name(key.departmentId)}</b> · {t("pos.keyOnce")}</p>
            <code>{key.key}</code> <button type="button" className="secondaryButton" onClick={() => void navigator.clipboard.writeText(key.key).then(() => setMsg(t("pos.copied")))}>{t("pos.copy")}</button>
            <details open><summary>{t("pos.guide")}</summary>
              <pre>{guide(key.key)}</pre>
              <ul className="muted">
                <li><code>POST /api/v1/pos/sales</code> — receipt_id, sold_at?, items[{"{"}name, sku?, quantity, unit_price{"}"}], total?, payment (cash · card · room · other), room?, covers?</li>
                <li><code>DELETE /api/v1/pos/sales/&lt;receipt_id&gt;</code> — void (a room charge is reversed)</li>
                <li><code>GET /api/v1/pos/guest?room=112</code> — guest in the room before «charge to room»</li>
                <li><code>GET / PUT /api/v1/pos/items</code> — products of the department (PUT: {"{"} items: [{"{"}sku, name, price, active?{"}"}] {"}"})</li>
              </ul>
            </details>
            <button type="button" className="linkButton" onClick={() => setKey(null)}>✕</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t("csv.title")}</h2>
        <p className="muted">{t("csv.help")}</p>
        <div className="dsCsv">
          <label>{t("sales.department")}<select value={csv.departmentId} onChange={(e) => setCsv({ ...csv, departmentId: Number(e.target.value) })}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>{t("csv.file")}<input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((text) => setCsv({ ...csv, text, name: f.name })); }} /></label>
          <button type="button" className="primaryAction" disabled={busy || !csv.text || !csv.departmentId} onClick={() => void importCsv()}>{t("csv.import")}</button>
        </div>
        {csvResult && <p className="notice">{t("csv.done", { added: csvResult.added, total: money(csvResult.totalCents), dup: csvResult.duplicates })}{csvResult.errors.length > 0 && <><br />{t("csv.errors")} {csvResult.errors.join(" · ")}</>}</p>}
      </div>

      {report.recent.length > 0 && (
        <div className="card"><h2>{t("sales.recent")}</h2><div className="tableWrap"><table>
          <thead><tr><th>{t("sales.when")}</th><th>{t("sales.department")}</th><th>{t("sales.receipt")}</th><th>{t("sales.payment")}</th><th>{t("sales.booking")}</th><th>{t("sales.revenue")}</th></tr></thead>
          <tbody>{report.recent.map((r) => <tr key={r.id} className={r.status === "void" ? "muted" : ""}><td>{when(r.at)}</td><td>{r.department}</td><td>{r.receiptId}{r.source === "csv" ? " · CSV" : ""}</td><td>{t(`sales.pay.${(PAYMENTS as readonly string[]).includes(r.payment) ? r.payment as (typeof PAYMENTS)[number] : "other"}`)}</td><td>{r.reference ?? ""}</td><td>{r.status === "void" ? <s>{money(r.totalCents)}</s> : money(r.totalCents)}{r.status === "void" ? ` · ${t("sales.void")}` : ""}</td></tr>)}</tbody>
        </table></div></div>
      )}
    </div>
  );
}
