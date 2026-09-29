"use client";
import { useState } from "react";
import { arrivalLanguages, arrivalModes, type ArrivalLanguage, type ArrivalMode, type ArrivalSettings } from "@/lib/arrival";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

const langNames: Record<ArrivalLanguage, string> = { el: "Ελληνικά", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", es: "Español" };
const slug = (v: string) => v.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `hub_${Date.now() % 100000}`;

export function ArrivalEditor({ lang, initial, canEdit }: { lang: PmsLang; initial: ArrivalSettings; canEdit: boolean }) {
  const t = pmsT(lang);
  const [s, setS] = useState(initial);
  const [mode, setMode] = useState<ArrivalMode>("port");
  const [textLang, setTextLang] = useState<ArrivalLanguage>(lang);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const setMode_ = (m: ArrivalMode, fn: (x: ArrivalSettings["modes"][ArrivalMode]) => ArrivalSettings["modes"][ArrivalMode]) => setS((v) => ({ ...v, modes: { ...v.modes, [m]: fn(v.modes[m]) } }));
  const setHub = (i: number, patch: (h: ArrivalSettings["modes"][ArrivalMode]["hubs"][number]) => ArrivalSettings["modes"][ArrivalMode]["hubs"][number]) => setMode_(mode, (m) => ({ ...m, hubs: m.hubs.map((h, j) => (j === i ? patch(h) : h)) }));
  const setTransfer = (patch: Partial<ArrivalSettings["transfer"]>) => setS((v) => ({ ...v, transfer: { ...v.transfer, ...patch } }));
  const setVehicle = (i: number, patch: Partial<ArrivalSettings["transfer"]["vehicles"][number]>) => setTransfer({ vehicles: s.transfer.vehicles.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/pms/arrival-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: s }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setS(d.settings); setMsg(t("arr.saved")); } else setMsg(t("arr.failed"));
    } finally {
      setBusy(false);
    }
  }

  const m = s.modes[mode];
  return (
    <div className="arrivalEditor">
      <div className="segmented" role="tablist">
        {arrivalModes.map((x) => <button key={x} type="button" aria-pressed={mode === x} onClick={() => setMode(x)}>{t(`arr.mode.${x}` as PmsKey)} · {s.modes[x].hubs.length}</button>)}
      </div>
      <fieldset disabled={!canEdit} className="arrivalMode">
        <label className="inline"><input type="checkbox" checked={m.enabled} onChange={(e) => setMode_(mode, (x) => ({ ...x, enabled: e.target.checked }))} /> {t("arr.enabled")}</label>
        <div className="segmented langTabs" role="group" aria-label={t("arr.textLang")}>
          {arrivalLanguages.map((l) => <button key={l} type="button" aria-pressed={textLang === l} onClick={() => setTextLang(l)}>{langNames[l]}</button>)}
        </div>
        {m.hubs.map((h, i) => (
          <article key={h.key} className="hubCard">
            <div className="two">
              <label>{t("arr.hubName")} (EL)<input value={h.name.el ?? ""} maxLength={120} onChange={(e) => setHub(i, (x) => ({ ...x, name: { ...x.name, el: e.target.value } }))} /></label>
              <label>{t("arr.hubName")} (EN)<input value={h.name.en ?? ""} maxLength={120} onChange={(e) => setHub(i, (x) => ({ ...x, name: { ...x.name, en: e.target.value } }))} /></label>
            </div>
            {textLang !== "el" && textLang !== "en" && <label>{t("arr.hubName")} ({textLang.toUpperCase()})<input value={h.name[textLang] ?? ""} maxLength={120} placeholder={h.name.en} onChange={(e) => setHub(i, (x) => ({ ...x, name: { ...x.name, [textLang]: e.target.value } }))} /></label>}
            <label>{t("arr.instructions")} · {langNames[textLang]}<textarea rows={6} maxLength={3000} value={h.text[textLang] ?? ""} placeholder={textLang !== "en" ? h.text.en : undefined} onChange={(e) => setHub(i, (x) => ({ ...x, text: { ...x.text, [textLang]: e.target.value } }))} /></label>
            {!h.text[textLang] && <small>{t("arr.fallback")}</small>}
            <button type="button" className="secondaryButton" onClick={() => setMode_(mode, (x) => ({ ...x, hubs: x.hubs.filter((_, j) => j !== i) }))}>{t("arr.removeHub")}</button>
          </article>
        ))}
        {m.hubs.length < 12 && <button type="button" className="secondaryButton" onClick={() => { const name = prompt(t("arr.newHubPrompt")); if (name) setMode_(mode, (x) => ({ ...x, hubs: [...x.hubs, { key: slug(name), name: { el: name, en: name }, text: {} }] })); }}>+ {t("arr.addHub")}</button>}
      </fieldset>

      <fieldset disabled={!canEdit} className="transferRules">
        <legend>{t("arr.transfer")}</legend>
        <label className="inline"><input type="checkbox" checked={s.transfer.enabled} onChange={(e) => setTransfer({ enabled: e.target.checked })} /> {t("arr.transferEnabled")}</label>
        <label className="inline"><input type="checkbox" checked={s.transfer.autoFolio} onChange={(e) => setTransfer({ autoFolio: e.target.checked })} /> {t("arr.autoFolio")}</label>
        <div className="inlineChecks">
          <span>{t("arr.transferModes")}:</span>
          {arrivalModes.map((x) => <label key={x} className="inline"><input type="checkbox" checked={s.transfer.modes.includes(x)} onChange={(e) => setTransfer({ modes: e.target.checked ? [...s.transfer.modes, x] : s.transfer.modes.filter((y) => y !== x) })} /> {t(`arr.mode.${x}` as PmsKey)}</label>)}
        </div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>{t("arr.vehicle")} (EL)</th><th>{t("arr.vehicle")} (EN)</th><th>{t("arr.price")}</th><th>{t("arr.maxPax")}</th><th>{t("arr.active")}</th><th /></tr></thead>
            <tbody>
              {s.transfer.vehicles.map((v, i) => (
                <tr key={v.key}>
                  <td><input value={v.name.el ?? ""} maxLength={80} onChange={(e) => setVehicle(i, { name: { ...v.name, el: e.target.value } })} /></td>
                  <td><input value={v.name.en ?? ""} maxLength={80} onChange={(e) => setVehicle(i, { name: { ...v.name, en: e.target.value } })} /></td>
                  <td><input type="number" min={0} step={1} value={v.priceCents / 100} onChange={(e) => setVehicle(i, { priceCents: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })} /></td>
                  <td><input type="number" min={1} max={60} value={v.maxPassengers} onChange={(e) => setVehicle(i, { maxPassengers: Math.max(1, Math.min(60, Math.trunc(Number(e.target.value)) || 1)) })} /></td>
                  <td><input type="checkbox" checked={v.active} onChange={(e) => setVehicle(i, { active: e.target.checked })} /></td>
                  <td><button type="button" className="secondaryButton" onClick={() => setTransfer({ vehicles: s.transfer.vehicles.filter((_, j) => j !== i) })}>{t("arr.remove")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.transfer.vehicles.length < 12 && <button type="button" className="secondaryButton" onClick={() => { const name = prompt(t("arr.newVehiclePrompt")); if (name) setTransfer({ vehicles: [...s.transfer.vehicles, { key: slug(name), name: { el: name, en: name }, priceCents: 0, maxPassengers: 4, active: true }] }); }}>+ {t("arr.addVehicle")}</button>}
      </fieldset>
      {canEdit && <div className="actions"><button type="button" disabled={busy} onClick={save}>{t("arr.save")}</button></div>}
      <p className="notice" role="status">{msg}</p>
    </div>
  );
}
