"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutoPricingStatus } from "@/lib/auto-pricing";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";

type Settings = AutoPricingStatus["settings"];
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const eur = (cents: number) => `€${Math.round(cents / 100)}`;

export function AutoPricing({ lang, canEdit }: { lang: PmsLang; canEdit: boolean }) {
  const t = pmsT(lang);
  const [data, setData] = useState<AutoPricingStatus | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("");

  const apply = (d: AutoPricingStatus) => { setData(d); setS(d.settings); setType((x) => x || d.roomTypes.find((r) => d.settings.types[r.roomType]?.enabled)?.roomType || d.roomTypes[0]?.roomType || ""); };
  const load = useCallback(async () => { const r = await fetch("/api/pms/auto-pricing", { cache: "no-store" }); const d = await r.json().catch(() => null); if (d?.ok) apply(d); }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  async function post(body: object) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/auto-pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(t("ap.failed")); return; }
      apply(d); setMsg(t("ap.saved"));
    } finally { setBusy(false); }
  }
  const days = useMemo(() => (data?.days ?? []).filter((d) => d.roomType === type), [data, type]);
  if (!data || !s) return <p className="muted">{t("ap.loading")}</p>;
  const set = (x: Partial<Settings>) => setS({ ...s, ...x });
  const setType1 = (k: string, x: Partial<Settings["types"][string]>) => set({ types: { ...s.types, [k]: { ...(s.types[k] ?? { enabled: false, minEur: 0, maxEur: 0 }), ...x } } });
  const dis = !canEdit || busy;
  const changed = days.filter((d) => d.priceCents !== d.baseCents);
  const fmt = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="apPage">
      {msg && <p className="notice" role="status">{msg}</p>}
      <section className="card apHead">
        <label className="apSwitch"><input type="checkbox" disabled={dis} checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <b>{t("ap.enabled")}</b></label>
        <div className="apModes">
          <label><input type="radio" name="apmode" disabled={dis} checked={s.mode === "suggest"} onChange={() => set({ mode: "suggest" })} /> {t("ap.mode.suggest")}</label>
          <label><input type="radio" name="apmode" disabled={dis} checked={s.mode === "auto"} onChange={() => set({ mode: "auto" })} /> {t("ap.mode.auto")}</label>
        </div>
        <p className="muted">{s.mode === "auto" ? t("ap.mode.autoHelp") : t("ap.mode.suggestHelp")}</p>
        <small className="muted">{t("ap.lastRun")}: {data.lastRunAt ? new Date(data.lastRunAt).toLocaleString(pmsLocale(lang), { timeZone: "Europe/Athens" }) : "—"}{data.lastSummary ? ` · ${data.lastSummary}` : ""} · {t("ap.applied", { n: String(data.appliedNights) })}</small>
      </section>

      <section className="card">
        <h2>{t("ap.limits")}</h2>
        <p className="muted">{t("ap.limitsHelp")}</p>
        <table className="apTable"><thead><tr><th>{t("ap.roomType")}</th><th>{t("ap.on")}</th><th>{t("ap.base")}</th><th>{t("ap.min")} €</th><th>{t("ap.max")} €</th></tr></thead>
          <tbody>{data.roomTypes.map((rt) => { const x = s.types[rt.roomType] ?? { enabled: false, minEur: 0, maxEur: 0 }; return (
            <tr key={rt.roomType}><td><b>{rt.roomType}</b> <small className="muted">({rt.rooms})</small></td>
              <td><input type="checkbox" disabled={dis} checked={x.enabled} onChange={(e) => setType1(rt.roomType, { enabled: e.target.checked })} /></td>
              <td>{eur(rt.baseCents)}</td>
              <td><input type="number" min={0} disabled={dis} value={x.minEur || ""} onChange={(e) => setType1(rt.roomType, { minEur: num(e.target.value) })} /></td>
              <td><input type="number" min={0} disabled={dis} value={x.maxEur || ""} onChange={(e) => setType1(rt.roomType, { maxEur: num(e.target.value) })} /></td></tr>
          ); })}</tbody></table>
      </section>

      <section className="card">
        <h2>{t("ap.rules")}</h2>
        <div className="apRules">
          <fieldset><legend>{t("ap.demand")}</legend>
            {s.demand.map((b, i) => (
              <div key={i} className="apRow">{t("ap.occAtLeast")} <input type="number" min={1} max={100} disabled={dis} value={b.occupancy} onChange={(e) => set({ demand: s.demand.map((x, j) => (j === i ? { ...x, occupancy: num(e.target.value) } : x)) })} />% → <input type="number" min={-50} max={100} disabled={dis} value={b.percent} onChange={(e) => set({ demand: s.demand.map((x, j) => (j === i ? { ...x, percent: num(e.target.value) } : x)) })} />%
                {canEdit && <button type="button" className="secondaryButton" disabled={dis} onClick={() => set({ demand: s.demand.filter((_, j) => j !== i) })}>✕</button>}</div>
            ))}
            {canEdit && s.demand.length < 8 && <button type="button" className="secondaryButton" disabled={dis} onClick={() => set({ demand: [...s.demand, { occupancy: 50, percent: 0 }] })}>+ {t("ap.addBand")}</button>}
          </fieldset>
          <fieldset><legend>{t("ap.lastMinute")}</legend>
            <div className="apRow">{t("ap.within")} <input type="number" min={0} max={60} disabled={dis} value={s.lastMinute.days} onChange={(e) => set({ lastMinute: { ...s.lastMinute, days: num(e.target.value) } })} /> {t("ap.days")}, {t("ap.occBelow")} <input type="number" min={0} max={100} disabled={dis} value={s.lastMinute.belowOccupancy} onChange={(e) => set({ lastMinute: { ...s.lastMinute, belowOccupancy: num(e.target.value) } })} />% → <input type="number" min={-50} max={50} disabled={dis} value={s.lastMinute.percent} onChange={(e) => set({ lastMinute: { ...s.lastMinute, percent: num(e.target.value) } })} />%</div>
          </fieldset>
          <fieldset><legend>{t("ap.other")}</legend>
            <div className="apRow">{t("ap.earlyBird")} <input type="number" min={0} max={365} disabled={dis} value={s.earlyBird.days} onChange={(e) => set({ earlyBird: { ...s.earlyBird, days: num(e.target.value) } })} /> {t("ap.days")} → <input type="number" min={-50} max={50} disabled={dis} value={s.earlyBird.percent} onChange={(e) => set({ earlyBird: { ...s.earlyBird, percent: num(e.target.value) } })} />%</div>
            <div className="apRow">{t("ap.weekend")} <input type="number" min={-50} max={100} disabled={dis} value={s.weekendPercent} onChange={(e) => set({ weekendPercent: num(e.target.value) })} />%</div>
            <div className="apRow"><label><input type="checkbox" disabled={dis} checked={s.compset.enabled} onChange={(e) => set({ compset: { ...s.compset, enabled: e.target.checked } })} /> {t("ap.compset")}</label> <input type="number" min={0} max={100} disabled={dis} value={s.compset.weight} onChange={(e) => set({ compset: { ...s.compset, weight: num(e.target.value) } })} />%</div>
            <div className="apRow">{t("ap.maxChange")} ±<input type="number" min={0} max={100} disabled={dis} value={s.maxChangePercent} onChange={(e) => set({ maxChangePercent: num(e.target.value) })} />% · {t("ap.horizon")} <input type="number" min={7} max={365} disabled={dis} value={s.horizonDays} onChange={(e) => set({ horizonDays: num(e.target.value) })} /> {t("ap.days")}</div>
          </fieldset>
        </div>
        {canEdit && <div className="apRow"><button type="button" className="primaryAction" disabled={busy} onClick={() => void post({ action: "save", settings: s })}>{t("ap.save")}</button><button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "run" })}>{t("ap.runNow")}</button></div>}
      </section>

      <section className="card">
        <div className="apRow apPreviewHead"><h2>{t("ap.preview")}</h2>
          <select value={type} onChange={(e) => setType(e.target.value)}>{data.roomTypes.map((r) => <option key={r.roomType} value={r.roomType}>{r.roomType}</option>)}</select>
          <small className="muted">{t("ap.changedNights", { n: String(changed.length), all: String(days.length) })}</small></div>
        {days.length ? (
          <div className="apCal">{days.map((d) => { const diff = d.priceCents - d.baseCents; return (
            <div key={d.date} className={`apDay${diff > 0 ? " up" : diff < 0 ? " down" : ""}`} title={d.reasons}>
              <small>{fmt(d.date)}</small><b>{eur(d.priceCents)}</b>
              <span>{diff ? `${diff > 0 ? "▲" : "▼"} ${eur(Math.abs(diff))}` : "="} · {d.occupancy}%</span>
            </div>
          ); })}</div>
        ) : <p className="muted">{t("ap.noPreview")}</p>}
      </section>
    </div>
  );
}
