"use client";
import { useState } from "react";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";
import type { TvScreenRow } from "@/lib/tv";
import { tvLanguages, type TvLanguage, type TvSettings } from "@/lib/tv-core";

const langNames: Record<TvLanguage, string> = { el: "Ελληνικά", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", es: "Español" };
const ONLINE_MS = 10 * 60_000;

export function TvManager({ lang, initialSettings, initialScreens, canEdit }: { lang: PmsLang; initialSettings: TvSettings; initialScreens: TvScreenRow[]; canEdit: boolean }) {
  const t = pmsT(lang);
  const [settings, setSettings] = useState(initialSettings);
  const [screens, setScreens] = useState(initialScreens);
  const [textLang, setTextLang] = useState<TvLanguage>("el");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkedAt] = useState(() => Date.now());
  const set = (patch: Partial<TvSettings>) => setSettings((s) => ({ ...s, ...patch }));

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/tv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setMsg(t("tv.failed")); return; }
      if (d.settings) setSettings(d.settings);
      if (d.screens) setScreens(d.screens);
      setMsg(done);
    } finally { setBusy(false); }
  }
  const saveScreen = (s: TvScreenRow, patch: Partial<TvScreenRow>) => { const n = { ...s, ...patch }; return post({ action: "screen", roomId: s.room_id, wifiSsid: n.wifi_ssid, wifiPassword: n.wifi_password, active: n.active === 1 }, t("tv.saved")); };
  const editRow = (roomId: number, patch: Partial<TvScreenRow>) => setScreens((v) => v.map((x) => (x.room_id === roomId ? { ...x, ...patch } : x)));

  return (
    <div className="tvAdmin">
      <div className="hubCard">
        <h2>{t("tv.general")}</h2>
        <div className="tvAdminGrid">
          <label>{t("tv.wifiSsid")}<input value={settings.wifiSsid} maxLength={64} disabled={!canEdit} onChange={(e) => set({ wifiSsid: e.target.value })} /></label>
          <label>{t("tv.wifiPassword")}<input value={settings.wifiPassword} maxLength={64} disabled={!canEdit} onChange={(e) => set({ wifiPassword: e.target.value })} /></label>
          <label>{t("tv.checkIn")}<input type="time" value={settings.checkInTime} disabled={!canEdit} onChange={(e) => set({ checkInTime: e.target.value })} /></label>
          <label>{t("tv.checkOut")}<input type="time" value={settings.checkOutTime} disabled={!canEdit} onChange={(e) => set({ checkOutTime: e.target.value })} /></label>
          <label>{t("tv.phone")}<input value={settings.receptionPhone} maxLength={40} disabled={!canEdit} onChange={(e) => set({ receptionPhone: e.target.value })} /></label>
        </div>
        <div className="tvAdminChecks">
          <label className="inline"><input type="checkbox" checked={settings.showWeather} disabled={!canEdit} onChange={(e) => set({ showWeather: e.target.checked })} /> {t("tv.showWeather")}</label>
          <label className="inline"><input type="checkbox" checked={settings.showExtras} disabled={!canEdit} onChange={(e) => set({ showExtras: e.target.checked })} /> {t("tv.showExtras")}</label>
        </div>
        <div className="tvLangTabs" role="tablist">{tvLanguages.map((l) => <button type="button" role="tab" aria-selected={textLang === l} className={textLang === l ? "active" : ""} key={l} onClick={() => setTextLang(l)}>{langNames[l]}</button>)}</div>
        <label>{t("tv.welcome")}<textarea rows={3} maxLength={600} value={settings.welcome[textLang] ?? ""} disabled={!canEdit} onChange={(e) => set({ welcome: { ...settings.welcome, [textLang]: e.target.value } })} /></label>
        <label>{t("tv.tips")}<textarea rows={5} maxLength={1500} value={settings.tips[textLang] ?? ""} disabled={!canEdit} onChange={(e) => set({ tips: { ...settings.tips, [textLang]: e.target.value } })} /><small>{t("tv.tipsHelp")}</small></label>
        {canEdit && <button type="button" disabled={busy} onClick={() => post({ action: "settings", settings }, t("tv.saved"))}>{t("tv.save")}</button>}
      </div>

      <h2>{t("tv.screens")}</h2>
      <p className="muted">{t("tv.screensHelp")}</p>
      <div className="tableWrap"><table><thead><tr><th>{t("tv.room")}</th><th>{t("tv.link")}</th><th>{t("tv.status")}</th><th>{t("tv.roomWifi")}</th><th>{t("tv.active")}</th><th /></tr></thead>
        <tbody>{screens.map((s) => {
          const online = s.last_seen_at !== null && checkedAt - s.last_seen_at < ONLINE_MS;
          return (
            <tr key={s.room_id}>
              <td><b>{s.room_code}</b><small>{s.room_type}</small></td>
              <td className="tvLinkCell"><a href={s.url} target="_blank" rel="noopener noreferrer">{t("tv.open")}</a> · <button type="button" className="linkButton" onClick={() => { void navigator.clipboard?.writeText(s.url); setMsg(t("tv.copied")); }}>{t("tv.copy")}</button></td>
              <td>{online ? <span className="credit">● {t("tv.online")}</span> : s.last_seen_at ? <small>{t("tv.lastSeen")} {new Date(s.last_seen_at).toLocaleString(pmsLocale(lang))}</small> : <small>{t("tv.never")}</small>}</td>
              <td className="tvRoomWifi"><input placeholder={t("tv.useGeneral")} value={s.wifi_ssid} maxLength={64} disabled={!canEdit} onChange={(e) => editRow(s.room_id, { wifi_ssid: e.target.value })} /><input placeholder={t("tv.wifiPassword")} value={s.wifi_password} maxLength={64} disabled={!canEdit || !s.wifi_ssid} onChange={(e) => editRow(s.room_id, { wifi_password: e.target.value })} /></td>
              <td><input type="checkbox" aria-label={t("tv.active")} checked={s.active === 1} disabled={!canEdit} onChange={(e) => void saveScreen(s, { active: e.target.checked ? 1 : 0 })} /></td>
              <td className="rowActions">{canEdit && <><button type="button" disabled={busy} onClick={() => saveScreen(s, {})}>{t("tv.save")}</button><button type="button" className="secondaryButton" disabled={busy} onClick={() => confirm(t("tv.regenerateConfirm")) && post({ action: "regenerate", roomId: s.room_id }, t("tv.regenerated"))}>{t("tv.regenerate")}</button></>}</td>
            </tr>
          );
        })}</tbody></table></div>
      <p className="notice" role="status">{msg}</p>

      <details className="hubCard tvSetup">
        <summary><b>{t("tv.setupTitle")}</b></summary>
        <ol>{["tv.setup1", "tv.setup2", "tv.setup3", "tv.setup4", "tv.setup5", "tv.setup6"].map((k) => <li key={k}>{t(k as Parameters<typeof t>[0])}</li>)}</ol>
      </details>
    </div>
  );
}
