"use client";
import { useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import type { TvScreenRow } from "@/lib/tv";
import { tvLanguages, type TvLanguage, type TvSettings } from "@/lib/tv-core";
import { defaultInfoSections, MAX_INFO_SECTIONS, type TvInfoSection } from "@/lib/tv-info";
import { defaultTvQuestions, MAX_TV_QUESTIONS, type TvQuestion } from "@/lib/tv-questions";
import { defaultBeaches, windDirections, windNames, type TvBeach } from "@/lib/tv-beaches";
import { channelSource, MAX_TV_CHANNELS, tvChannelCategories, type TvChannel } from "@/lib/tv-channels-core";
import { MAX_TV_APPS, tvAppCatalog, type TvApp } from "@/lib/tv-apps-core";
import type { PowerSettings, RoomPowerState } from "@/lib/tv-power";

const langNames: Record<TvLanguage, string> = { el: "Ελληνικά", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", es: "Español" };
const ONLINE_MS = 10 * 60_000;

export function TvManager({ lang, initialSettings, initialScreens, initialPower, canEdit }: { lang: PmsLang; initialSettings: TvSettings; initialScreens: TvScreenRow[]; initialPower: { settings: PowerSettings; hasKey: boolean }; canEdit: boolean }) {
  const t = pmsT(lang);
  const [settings, setSettings] = useState(initialSettings);
  const [screens, setScreens] = useState(initialScreens);
  const [textLang, setTextLang] = useState<TvLanguage>("el");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkedAt] = useState(() => Date.now());
  const [power, setPower] = useState(initialPower.settings);
  const [hasKey, setHasKey] = useState(initialPower.hasKey);
  const [authKey, setAuthKey] = useState("");
  const [plugStates, setPlugStates] = useState<Record<number, RoomPowerState>>({});
  const powerReady = power.enabled && Boolean(power.server) && hasKey;
  const [appCode, setAppCode] = useState<{ roomId: number; room: string; code: string; expiresAt: number } | null>(null);
  const set = (patch: Partial<TvSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const setInfo = (info: TvInfoSection[]) => set({ info });
  const editQuestion = (i: number, value: string) => set({ assistantQuestions: settings.assistantQuestions.map((q, j): TvQuestion => (j === i ? { ...q, [textLang]: value } : q)) });
  const moveQuestion = (i: number, d: number) => { const qs = [...settings.assistantQuestions]; [qs[i], qs[i + d]] = [qs[i + d], qs[i]]; set({ assistantQuestions: qs }); };
  const editBeach = (i: number, patch: Partial<TvBeach>) => set({ beaches: settings.beaches.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const editInfo = (i: number, patch: Partial<TvInfoSection>) => setInfo(settings.info.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setChannels = (channels: TvChannel[]) => set({ channels });
  const editChannel = (i: number, patch: Partial<TvChannel>) => setChannels(settings.channels.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const moveChannel = (i: number, d: -1 | 1) => { const next = [...settings.channels]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); setChannels(next); };
  const setApps = (apps: TvApp[]) => set({ apps });
  const hasApp = (key: string) => settings.apps.some((a) => a.key === key);
  const toggleApp = (app: TvApp, on: boolean) => setApps(on ? [...settings.apps, { ...app }] : settings.apps.filter((a) => a.key !== app.key));
  const customApps = settings.apps.map((a, i) => ({ a, i })).filter(({ a }) => !tvAppCatalog.some((c) => c.key === a.key));
  const editApp = (i: number, patch: Partial<TvApp>) => setApps(settings.apps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const moveInfo = (i: number, d: -1 | 1) => { const next = [...settings.info]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); setInfo(next); };

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
  async function call(body: Record<string, unknown>) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/tv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.screens) setScreens(d.screens);
      return d;
    } finally { setBusy(false); }
  }
  async function savePower() {
    const d = await call({ action: "powerSettings", settings: power, authKey });
    if (!d.ok) { setMsg(t("tv.failed")); return; }
    setPower(d.power.settings); setHasKey(d.power.hasKey); setAuthKey(""); setMsg(t("tv.saved"));
  }
  async function switchPower(s: TvScreenRow, on: boolean) {
    const d = await call({ action: "power", roomId: s.room_id, on });
    setMsg(d.ok ? t(on ? "tv.powerOnDone" : "tv.powerOffDone").replace("{room}", s.room_code) : `${t("tv.powerFailed")} (${d.error ?? "?"})`);
  }
  async function checkPlugs() {
    const d = await call({ action: "powerStatus" });
    if (!d.ok) { setMsg(t("tv.failed")); return; }
    setPlugStates(Object.fromEntries((d.states as RoomPowerState[]).map((x) => [x.roomId, x])));
  }
  async function makeAppCode(s: TvScreenRow) {
    setBusy(true); setMsg(""); setAppCode(null);
    try {
      const r = await fetch("/api/pms/tv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setupCode", roomId: s.room_id }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) setAppCode({ roomId: s.room_id, room: s.room_code, code: d.code, expiresAt: d.expiresAt }); else setMsg(t("tv.failed"));
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
          <label>{t("tv.whatsapp")}<input value={settings.whatsappNumber} maxLength={20} inputMode="tel" placeholder="+30 69…" disabled={!canEdit} onChange={(e) => set({ whatsappNumber: e.target.value })} /></label>
          <label className="tvWide">{t("tv.guideUrl")}<input type="url" value={settings.travelGuideUrl} maxLength={500} placeholder="https://…" disabled={!canEdit} onChange={(e) => set({ travelGuideUrl: e.target.value })} /></label>
        </div>
        <small>{t("tv.qrHelp")}</small>
        <div className="tvAdminChecks">
          <label className="inline"><input type="checkbox" checked={settings.showWeather} disabled={!canEdit} onChange={(e) => set({ showWeather: e.target.checked })} /> {t("tv.showWeather")}</label>
          <label className="inline"><input type="checkbox" checked={settings.showExtras} disabled={!canEdit} onChange={(e) => set({ showExtras: e.target.checked })} /> {t("tv.showExtras")}</label>
        </div>
        <div className="tvAdminChecks tvAssistantSet">
          <label className="inline"><input type="checkbox" checked={settings.assistant} disabled={!canEdit} onChange={(e) => set({ assistant: e.target.checked })} /> <b>{t("tv.assistant")}</b></label>
          <label className="inline">{t("tv.assistantLimit")} <input type="number" min={5} max={200} value={settings.assistantDailyLimit} disabled={!canEdit} onChange={(e) => set({ assistantDailyLimit: Number(e.target.value) || 40 })} style={{ width: 80 }} /></label>
        </div>
        <small>{t("tv.assistantHelp")}</small>
        <div className="tvLangTabs" role="tablist">{tvLanguages.map((l) => <button type="button" role="tab" aria-selected={textLang === l} className={textLang === l ? "active" : ""} key={l} onClick={() => setTextLang(l)}>{langNames[l]}</button>)}</div>
        <label>{t("tv.welcome")}<textarea rows={3} maxLength={600} value={settings.welcome[textLang] ?? ""} disabled={!canEdit} onChange={(e) => set({ welcome: { ...settings.welcome, [textLang]: e.target.value } })} /></label>
        <label>{t("tv.wifiNote")}<input value={settings.wifiNote[textLang] ?? ""} maxLength={200} disabled={!canEdit} onChange={(e) => set({ wifiNote: { ...settings.wifiNote, [textLang]: e.target.value } })} /></label>
        <label>{t("tv.tips")}<textarea rows={5} maxLength={1500} value={settings.tips[textLang] ?? ""} disabled={!canEdit} onChange={(e) => set({ tips: { ...settings.tips, [textLang]: e.target.value } })} /><small>{t("tv.tipsHelp")}</small></label>
        <h3>{t("tv.infoTitle")}</h3>
        <small>{t("tv.infoHelp")}</small>
        {settings.info.map((x, i) => (
          <div className="tvInfoEdit" key={x.key}>
            <div className="tvInfoEditHead">
              <input className="tvIcon" aria-label="Icon" value={x.icon} maxLength={8} disabled={!canEdit} onChange={(e) => editInfo(i, { icon: e.target.value })} />
              <input aria-label={t("tv.infoName")} placeholder={`${t("tv.infoName")} (${langNames[textLang]})`} value={x.title[textLang] ?? ""} maxLength={60} disabled={!canEdit} onChange={(e) => editInfo(i, { title: { ...x.title, [textLang]: e.target.value } })} />
              {canEdit && <span className="tvInfoActions"><button type="button" className="secondaryButton" disabled={i === 0} onClick={() => moveInfo(i, -1)}>↑</button><button type="button" className="secondaryButton" disabled={i === settings.info.length - 1} onClick={() => moveInfo(i, 1)}>↓</button><button type="button" className="secondaryButton" onClick={() => confirm(t("tv.infoRemoveConfirm")) && setInfo(settings.info.filter((_, j) => j !== i))}>✕</button></span>}
            </div>
            <textarea rows={6} maxLength={2500} placeholder={x.body.en ?? ""} value={x.body[textLang] ?? ""} disabled={!canEdit} onChange={(e) => editInfo(i, { body: { ...x.body, [textLang]: e.target.value } })} />
          </div>
        ))}
        {canEdit && (
          <div className="tvInfoAdd">
            <button type="button" className="secondaryButton" disabled={settings.info.length >= MAX_INFO_SECTIONS} onClick={() => setInfo([...settings.info, { key: `s${Date.now().toString(36)}`, icon: "ℹ️", title: {}, body: {} }])}>+ {t("tv.infoAdd")}</button>
            <button type="button" className="secondaryButton" onClick={() => confirm(t("tv.infoResetConfirm")) && setInfo(defaultInfoSections.map((x) => ({ ...x, title: { ...x.title }, body: { ...x.body } })))}>{t("tv.infoReset")}</button>
          </div>
        )}
        <h3>{t("tv.questionsTitle")}</h3>
        <small>{t("tv.questionsHelp")}</small>
        <div className="tvLangTabs" role="tablist">{tvLanguages.map((l) => <button type="button" role="tab" aria-selected={textLang === l} className={textLang === l ? "active" : ""} key={l} onClick={() => setTextLang(l)}>{langNames[l]}</button>)}</div>
        <div className="tvQuestions">
          {settings.assistantQuestions.map((q, i) => (
            <div className="tvQuestion" key={i}>
              <span className="tvQuestionNo">{i + 1}</span>
              <input aria-label={`${t("tv.question")} ${i + 1}`} placeholder={q.en || q.el || t("tv.question")} value={q[textLang] ?? ""} maxLength={80} disabled={!canEdit} onChange={(e) => editQuestion(i, e.target.value)} />
              {canEdit && <span className="tvInfoActions"><button type="button" className="secondaryButton" aria-label="↑" disabled={i === 0} onClick={() => moveQuestion(i, -1)}>↑</button><button type="button" className="secondaryButton" aria-label="↓" disabled={i === settings.assistantQuestions.length - 1} onClick={() => moveQuestion(i, 1)}>↓</button><button type="button" className="secondaryButton danger" aria-label="✕" onClick={() => confirm(t("tv.infoRemoveConfirm")) && set({ assistantQuestions: settings.assistantQuestions.filter((_, j) => j !== i) })}>✕</button></span>}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="tvInfoAdd">
            <button type="button" className="secondaryButton" disabled={settings.assistantQuestions.length >= MAX_TV_QUESTIONS} onClick={() => set({ assistantQuestions: [...settings.assistantQuestions, {}] })}>+ {t("tv.questionAdd")}</button>
            <button type="button" className="secondaryButton" onClick={() => confirm(t("tv.infoResetConfirm")) && set({ assistantQuestions: defaultTvQuestions.map((q) => ({ ...q })) })}>{t("tv.questionsReset")}</button>
          </div>
        )}
        <h3>{t("tv.beachesTitle")}</h3>
        <small>{t("tv.beachesHelp")}</small>
        <div className="tvBeaches">
          {settings.beaches.map((b, i) => (
            <div className="tvBeach" key={i}>
              <input aria-label={t("tv.beachName")} placeholder={t("tv.beachName")} value={b.name} maxLength={60} disabled={!canEdit} onChange={(e) => editBeach(i, { name: e.target.value })} />
              <label className="inline">{t("tv.beachMinutes")} <input type="number" min={0} max={180} value={b.minutes} disabled={!canEdit} onChange={(e) => editBeach(i, { minutes: Number(e.target.value) || 0 })} /></label>
              <div className="tvWinds" role="group" aria-label={t("tv.beachSheltered")}>
                <span>{t("tv.beachSheltered")}:</span>
                {windDirections.map((d) => <button type="button" key={d} title={windNames[d].el} aria-pressed={b.sheltered.includes(d)} className={b.sheltered.includes(d) ? "on" : ""} disabled={!canEdit} onClick={() => editBeach(i, { sheltered: b.sheltered.includes(d) ? b.sheltered.filter((x) => x !== d) : windDirections.filter((x) => x === d || b.sheltered.includes(x)) })}>{windNames[d].el}</button>)}
              </div>
              <input aria-label={t("tv.beachNote")} placeholder={t("tv.beachNote")} value={b.note} maxLength={200} disabled={!canEdit} onChange={(e) => editBeach(i, { note: e.target.value })} />
              {canEdit && <button type="button" className="secondaryButton" onClick={() => confirm(t("tv.infoRemoveConfirm")) && set({ beaches: settings.beaches.filter((_, j) => j !== i) })}>✕</button>}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="tvInfoAdd">
            <button type="button" className="secondaryButton" disabled={settings.beaches.length >= 20} onClick={() => set({ beaches: [...settings.beaches, { name: "", minutes: 10, sheltered: [], note: "" }] })}>+ {t("tv.beachAdd")}</button>
            <button type="button" className="secondaryButton" onClick={() => confirm(t("tv.infoResetConfirm")) && set({ beaches: defaultBeaches.map((b) => ({ ...b, sheltered: [...b.sheltered] })) })}>{t("tv.infoReset")}</button>
          </div>
        )}
        <h3>{t("tv.appsTitle")}</h3>
        <small>{t("tv.appsHelp")}</small>
        <div className="tvAppsEdit">
          {tvAppCatalog.map((app) => <label key={app.key} className="inline tvAppCheck"><input type="checkbox" checked={hasApp(app.key)} disabled={!canEdit || (!hasApp(app.key) && settings.apps.length >= MAX_TV_APPS)} onChange={(e) => toggleApp(app, e.target.checked)} /><span className="tvAppDot" style={{ background: app.color }} />{app.name}</label>)}
        </div>
        {customApps.map(({ a, i }) => (
          <div className="tvChannelRow tvAppRow" key={i}>
            <input aria-label={t("tv.appName")} placeholder={t("tv.appName")} value={a.name} maxLength={40} disabled={!canEdit} onChange={(e) => editApp(i, { name: e.target.value })} />
            <input aria-label={t("tv.appPackage")} placeholder={t("tv.appPackage")} value={a.packages.join(", ")} maxLength={300} disabled={!canEdit} onChange={(e) => editApp(i, { packages: e.target.value.split(/[\s,]+/).filter(Boolean), key: `custom:${e.target.value.split(/[\s,]+/)[0] ?? ""}` })} />
            <input aria-label="Color" type="color" value={a.color} disabled={!canEdit} onChange={(e) => editApp(i, { color: e.target.value })} />
            {canEdit && <span className="tvInfoActions"><button type="button" className="secondaryButton" onClick={() => setApps(settings.apps.filter((_, j) => j !== i))}>✕</button></span>}
          </div>
        ))}
        {canEdit && <button type="button" className="secondaryButton" disabled={settings.apps.length >= MAX_TV_APPS} onClick={() => setApps([...settings.apps, { key: `custom:new${Date.now()}`, name: "", packages: [], color: "#173e47" }])}>+ {t("tv.appAdd")} ({t("tv.appCustom")})</button>}
        <h3>{t("tv.channelsTitle")}</h3>
        <small>{t("tv.channelsHelp")}</small>
        <div className="tvChannelEdit">
          {settings.channels.map((c, i) => (
            <div className="tvChannelRow" key={i}>
              <input aria-label={t("tv.channelName")} placeholder={t("tv.channelName")} value={c.name} maxLength={60} disabled={!canEdit} onChange={(e) => editChannel(i, { name: e.target.value })} />
              <input aria-label={t("tv.channelUrl")} placeholder={t("tv.channelUrl")} type="url" value={c.url} maxLength={600} disabled={!canEdit} onChange={(e) => editChannel(i, { url: e.target.value })} />
              <input aria-label={t("tv.channelLogo")} placeholder={t("tv.channelLogo")} type="url" value={c.logo} maxLength={500} disabled={!canEdit} onChange={(e) => editChannel(i, { logo: e.target.value })} />
              <select aria-label={t("tv.channelCategory")} value={c.category} disabled={!canEdit} onChange={(e) => editChannel(i, { category: e.target.value as TvChannel["category"] })}>{tvChannelCategories.map((k) => <option key={k} value={k}>{t(`tv.cat.${k}` as PmsKey)}</option>)}</select>
              {canEdit && <span className="tvInfoActions"><button type="button" className="secondaryButton" disabled={i === 0} onClick={() => moveChannel(i, -1)}>↑</button><button type="button" className="secondaryButton" disabled={i === settings.channels.length - 1} onClick={() => moveChannel(i, 1)}>↓</button><button type="button" className="secondaryButton" onClick={() => setChannels(settings.channels.filter((_, j) => j !== i))}>✕</button></span>}
              {c.url && !channelSource(c.url) && <small className="error">{t("tv.channelInvalid")}</small>}
              {c.url && channelSource(c.url) && <small className="muted">{channelSource(c.url)!.kind === "youtube" ? "YouTube" : channelSource(c.url)!.kind === "hls" ? "HLS (.m3u8)" : "Video"}</small>}
            </div>
          ))}
          {canEdit && <button type="button" className="secondaryButton" disabled={settings.channels.length >= MAX_TV_CHANNELS} onClick={() => setChannels([...settings.channels, { name: "", url: "", logo: "", category: "news" }])}>+ {t("tv.channelAdd")}</button>}
        </div>
        {canEdit && <button type="button" disabled={busy} onClick={() => post({ action: "settings", settings }, t("tv.saved"))}>{t("tv.save")}</button>}
      </div>

      <h2>{t("tv.screens")}</h2>
      <p className="muted">{t("tv.screensHelp")}</p>
      <div className="tableWrap"><table><thead><tr><th>{t("tv.room")}</th><th>{t("tv.link")}</th><th>{t("tv.status")}</th><th>{t("tv.roomWifi")}</th><th>{t("tv.plug")}</th><th>{t("tv.active")}</th><th /></tr></thead>
        <tbody>{screens.map((s) => {
          const online = s.last_seen_at !== null && checkedAt - s.last_seen_at < ONLINE_MS;
          return (
            <tr key={s.room_id}>
              <td><b>{s.room_code}</b><small>{s.room_type}</small></td>
              <td className="tvLinkCell"><a href={s.url} target="_blank" rel="noopener noreferrer">{t("tv.open")}</a> · <button type="button" className="linkButton" onClick={() => { void navigator.clipboard?.writeText(s.url); setMsg(t("tv.copied")); }}>{t("tv.copy")}</button></td>
              <td>{online ? <span className="credit">● {t("tv.online")}</span> : s.last_seen_at ? <small>{t("tv.lastSeen")} {new Date(s.last_seen_at).toLocaleString(pmsLocale(lang), { timeZone: "Europe/Athens" })}</small> : <small>{t("tv.never")}</small>}</td>
              <td className="tvRoomWifi"><input placeholder={t("tv.useGeneral")} value={s.wifi_ssid} maxLength={64} disabled={!canEdit} onChange={(e) => editRow(s.room_id, { wifi_ssid: e.target.value })} /><input placeholder={t("tv.wifiPassword")} value={s.wifi_password} maxLength={64} disabled={!canEdit || !s.wifi_ssid} onChange={(e) => editRow(s.room_id, { wifi_password: e.target.value })} /></td>
              <td><div className="tvPlug">
                <input placeholder={t("tv.plugId")} value={s.power_device_id} maxLength={64} disabled={!canEdit} onChange={(e) => editRow(s.room_id, { power_device_id: e.target.value.trim() })} />
                {canEdit && <button type="button" className="linkButton" disabled={busy} onClick={() => void call({ action: "powerDevice", roomId: s.room_id, deviceId: s.power_device_id, channel: s.power_channel }).then((d) => setMsg(d.ok ? t("tv.saved") : t("tv.plugInvalid")))}>{t("tv.save")}</button>}
                {s.power_device_id && (
                  <span className="tvPlugState">
                    {plugStates[s.room_id] ? (plugStates[s.room_id].online ? (plugStates[s.room_id].on ? <b className="credit">● {t("tv.plugOn")}</b> : <b>○ {t("tv.plugOff")}</b>) : <b className="debit">{t("tv.plugOffline")}</b>) : s.power_state !== null && <small>{s.power_state ? t("tv.plugOn") : t("tv.plugOff")}{s.power_changed_at ? ` · ${new Date(s.power_changed_at).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" })}` : ""}</small>}
                    {s.power_error && <small className="debit">{t("tv.powerFailed")}: {s.power_error}</small>}
                    {canEdit && powerReady && <span><button type="button" className="secondaryButton" disabled={busy} onClick={() => void switchPower(s, true)}>{t("tv.powerOn")}</button><button type="button" className="secondaryButton" disabled={busy} onClick={() => void switchPower(s, false)}>{t("tv.powerOff")}</button></span>}
                  </span>
                )}
              </div></td>
              <td><input type="checkbox" aria-label={t("tv.active")} checked={s.active === 1} disabled={!canEdit} onChange={(e) => void saveScreen(s, { active: e.target.checked ? 1 : 0 })} /></td>
              <td className="rowActions">{canEdit && <><button type="button" disabled={busy} onClick={() => saveScreen(s, {})}>{t("tv.save")}</button><button type="button" className="secondaryButton" disabled={busy} onClick={() => confirm(t("tv.regenerateConfirm")) && post({ action: "regenerate", roomId: s.room_id }, t("tv.regenerated"))}>{t("tv.regenerate")}</button><button type="button" className="secondaryButton" disabled={busy || s.active !== 1} onClick={() => void makeAppCode(s)}>{t("tv.appCode")}</button></>}
                {appCode?.roomId === s.room_id && (
                  <div className="tvAppCode" role="status">
                    <span>{t("tv.appCodeFor").replace("{room}", appCode.room)}</span>
                    <b>{appCode.code.slice(0, 3)} {appCode.code.slice(3)}</b>
                    <small>{t("tv.appCodeValid").replace("{time}", new Date(appCode.expiresAt).toLocaleTimeString(pmsLocale(lang), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }))}</small>
                  </div>
                )}</td>
            </tr>
          );
        })}</tbody></table></div>
      <p className="notice" role="status">{msg}</p>

      <div className="hubCard">
        <h2>{t("tv.powerTitle")}</h2>
        <small>{t("tv.powerHelp")}</small>
        <div className="tvAdminChecks"><label className="inline"><input type="checkbox" checked={power.enabled} disabled={!canEdit} onChange={(e) => setPower({ ...power, enabled: e.target.checked })} /> <b>{t("tv.powerEnabled")}</b></label></div>
        <div className="tvAdminGrid">
          <label>{t("tv.shellyServer")}<input value={power.server.replace(/^https:\/\//, "")} placeholder="shelly-123-eu.shelly.cloud" maxLength={120} disabled={!canEdit} onChange={(e) => setPower({ ...power, server: e.target.value })} /></label>
          <label>{t("tv.shellyKey")}<input type="password" autoComplete="off" value={authKey} placeholder={hasKey ? t("tv.shellyKeySaved") : ""} maxLength={400} disabled={!canEdit} onChange={(e) => setAuthKey(e.target.value)} /></label>
          <label>{t("tv.powerOnTime")}<input type="time" value={power.onTime} disabled={!canEdit} onChange={(e) => setPower({ ...power, onTime: e.target.value })} /></label>
        </div>
        <div className="tvAdminChecks">
          <label className="inline"><input type="checkbox" checked={power.autoOn} disabled={!canEdit} onChange={(e) => setPower({ ...power, autoOn: e.target.checked })} /> {t("tv.powerAutoOn")}</label>
          <label className="inline"><input type="checkbox" checked={power.autoOff} disabled={!canEdit} onChange={(e) => setPower({ ...power, autoOff: e.target.checked })} /> {t("tv.powerAutoOff")}</label>
        </div>
        <small>{t("tv.shellyWhere")}</small>
        <div className="tvInfoAdd">
          {canEdit && <button type="button" disabled={busy} onClick={() => void savePower()}>{t("tv.save")}</button>}
          <button type="button" className="secondaryButton" disabled={busy || !powerReady} onClick={() => void checkPlugs()}>{t("tv.plugCheck")}</button>
        </div>
      </div>

      <details className="hubCard tvSetup">
        <summary><b>{t("tv.appTitle")}</b></summary>
        <ol>{["tv.app1", "tv.app2", "tv.app3", "tv.app4", "tv.app5", "tv.app6"].map((k) => <li key={k}>{t(k as Parameters<typeof t>[0])}</li>)}</ol>
      </details>

      <details className="hubCard tvSetup">
        <summary><b>{t("tv.setupTitle")}</b></summary>
        <ol>{["tv.setup1", "tv.setup2", "tv.setup3", "tv.setup4", "tv.setup5", "tv.setup6"].map((k) => <li key={k}>{t(k as Parameters<typeof t>[0])}</li>)}</ol>
      </details>
    </div>
  );
}
