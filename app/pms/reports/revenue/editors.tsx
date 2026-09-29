"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type CommissionRow = { channel: string; commissionPercent: number; paymentFeePercent: number };

export function CommissionEditor({ lang, rows: initial, canEdit }: { lang: PmsLang; rows: CommissionRow[]; canEdit: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [channel, setChannel] = useState("");
  const [msg, setMsg] = useState("");
  const set = (i: number, patch: Partial<CommissionRow>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    const r = await fetch("/api/pms/revenue/commissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
    setMsg(r.ok ? t("rev.saved") : t("rev.failed"));
    if (r.ok) router.refresh();
  }
  return (
    <details className="commissionEditor">
      <summary>{t("rev.commissions")}</summary>
      <table>
        <thead><tr><th>{t("rev.channel")}</th><th>{t("rev.commissionPct")}</th><th>{t("rev.feePct")}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.channel}>
              <td>{r.channel}</td>
              <td><input type="number" min={0} max={60} step={0.1} value={r.commissionPercent} disabled={!canEdit} onChange={(e) => set(i, { commissionPercent: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })} /></td>
              <td><input type="number" min={0} max={20} step={0.1} value={r.paymentFeePercent} disabled={!canEdit} onChange={(e) => set(i, { paymentFeePercent: Math.min(20, Math.max(0, Number(e.target.value) || 0)) })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <div className="actions">
          <input placeholder={t("rev.newChannel")} value={channel} maxLength={40} onChange={(e) => setChannel(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} />
          <button type="button" className="secondaryButton" disabled={!channel || rows.some((r) => r.channel === channel)} onClick={() => { setRows((list) => [...list, { channel, commissionPercent: 0, paymentFeePercent: 0 }]); setChannel(""); }}>+ {t("rev.addChannel")}</button>
          <button type="button" onClick={save}>{t("rev.save")}</button>
        </div>
      )}
      <p className="notice" role="status">{msg}</p>
    </details>
  );
}

type Competitor = { id: number; name: string; website: string; source: string; apiUrl: string; active: boolean; lastFetchAt: number | null; lastFetchError: string | null };
const blank = { name: "", website: "", source: "manual", apiUrl: "", active: true };

export function CompetitorManager({ lang, competitors, canEdit }: { lang: PmsLang; competitors: Competitor[]; canEdit: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [form, setForm] = useState<typeof blank & { id?: number }>(blank);
  const [paste, setPaste] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const error = (code: string | undefined) => { const k = `rev.err.${code}` as PmsKey; return t(k) !== k ? t(k) : t("rev.failed"); };
  async function save() {
    const r = await fetch("/api/pms/revenue/competitors", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(error(d.error)); return; }
    setForm(blank);
    setMsg(t("rev.saved"));
    router.refresh();
  }
  async function remove(id: number) {
    if (!confirm(t("rev.confirmDelete"))) return;
    const r = await fetch(`/api/pms/revenue/competitors?id=${id}`, { method: "DELETE" });
    setMsg(r.ok ? t("rev.saved") : t("rev.failed"));
    router.refresh();
  }
  async function saveRates(id: number) {
    const r = await fetch(`/api/pms/revenue/competitors/${id}/rates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: paste[id] ?? "" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(error(d.error)); return; }
    setPaste((p) => ({ ...p, [id]: "" }));
    setMsg(t("rev.ratesSaved", { n: d.saved }));
    router.refresh();
  }
  return (
    <div className="competitorManager">
      <h3>{t("rev.competitors")} ({competitors.length}/5)</h3>
      {competitors.map((c) => (
        <div key={c.id} className="competitorRow">
          <div>
            <b>{c.name}</b> {!c.active && <small>({t("rev.inactive")})</small>}
            <small>{c.source === "api" ? t("rev.sourceApi") : t("rev.sourceManual")}{c.lastFetchAt ? ` · ${new Date(c.lastFetchAt).toLocaleString(pmsLocale(lang), { dateStyle: "short", timeStyle: "short" })}` : ""}{c.lastFetchError ? ` · ⚠️ ${c.lastFetchError}` : ""}</small>
            {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer">{c.website}</a>}
          </div>
          {canEdit && (
            <div className="actions">
              <button type="button" className="secondaryButton" onClick={() => setForm({ id: c.id, name: c.name, website: c.website, source: c.source, apiUrl: c.apiUrl, active: c.active })}>{t("rev.edit")}</button>
              <button type="button" className="danger" onClick={() => remove(c.id)}>{t("rev.delete")}</button>
            </div>
          )}
          {canEdit && (
            <details>
              <summary>{t("rev.manualRates")}</summary>
              <textarea rows={4} placeholder={"2026-10-01;145\n2026-10-02;150\n2026-10-03;sold"} value={paste[c.id] ?? ""} onChange={(e) => setPaste((p) => ({ ...p, [c.id]: e.target.value }))} />
              <button type="button" disabled={!(paste[c.id] ?? "").trim()} onClick={() => saveRates(c.id)}>{t("rev.saveRates")}</button>
            </details>
          )}
        </div>
      ))}
      {canEdit && (competitors.length < 5 || form.id) && (
        <fieldset className="competitorForm">
          <legend>{form.id ? t("rev.edit") : t("rev.addCompetitor")}</legend>
          <label>{t("rev.name")}<input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("rev.website")}<input type="url" placeholder="https://" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
          <label>{t("rev.source")}<select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}><option value="manual">{t("rev.sourceManual")}</option><option value="api">{t("rev.sourceApi")}</option></select></label>
          {form.source === "api" && <label>{t("rev.apiUrl")}<input placeholder="https://api.example.com/rates?hotel=123&from={from}&to={to}" value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} /><small>{t("rev.apiHelp")}</small></label>}
          <label className="inline"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {t("rev.active")}</label>
          <div className="actions">
            <button type="button" disabled={form.name.trim().length < 2} onClick={save}>{t("rev.save")}</button>
            {form.id && <button type="button" className="secondaryButton" onClick={() => setForm(blank)}>{t("rev.cancel")}</button>}
          </div>
        </fieldset>
      )}
      <p className="notice" role="status">{msg}</p>
    </div>
  );
}
