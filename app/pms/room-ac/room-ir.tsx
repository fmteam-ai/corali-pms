"use client";
import { useCallback, useEffect, useState } from "react";
import type { IrRoom, IrSettings } from "@/lib/room-ir";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Room = { roomId: number; code: string; guest: string | null; temp: number | null; climateReadAt: number | null };
type Ids = { hubId: string; acRemoteId: string; tvRemoteId: string };
type Remote = { id: string; name: string; category: number | null };
const MODES: PmsKey[] = ["ir.mode0", "ir.mode1", "ir.mode2", "ir.mode3", "ir.mode4"];
const WINDS: PmsKey[] = ["ir.wind0", "ir.wind1", "ir.wind2", "ir.wind3"];

/** v170: A/C by infrared (v178: the TV part is on PMS → Corali TV) through a Tuya IR hub (e.g. Avatto S16) in each room. IR is one-way: «sent», not «done». */
export function RoomIr({ lang, rooms, canSetup, canSwitch }: { lang: PmsLang; rooms: Room[]; canSetup: boolean; canSwitch: boolean }) {
  const t = pmsT(lang);
  const [settings, setSettings] = useState<IrSettings | null>(null);
  const [saved, setSaved] = useState<Record<number, IrRoom>>({});
  const [ids, setIds] = useState<Record<number, Ids>>({});
  const [remotes, setRemotes] = useState<Remote[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

  const apply = (d: { settings: IrSettings; rooms: IrRoom[] }) => {
    setSettings(d.settings);
    const by = Object.fromEntries(d.rooms.map((r) => [r.roomId, r]));
    setSaved(by);
    setIds(Object.fromEntries(rooms.map((r) => [r.roomId, { hubId: by[r.roomId]?.hubId ?? "", acRemoteId: by[r.roomId]?.acRemoteId ?? "", tvRemoteId: by[r.roomId]?.tvRemoteId ?? "" }])));
  };
  const load = useCallback(async () => { const r = await fetch("/api/pms/room-ir", { cache: "no-store" }); const d = await r.json().catch(() => null); if (d?.ok) apply(d); }, [rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  async function post(body: object, ok: PmsKey = "ac.saved") {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/room-ir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.rooms) apply(d);
      if (d.remotes) setRemotes(d.remotes);
      setMsg(r.ok ? t(ok) : d.error === "TV_ANSWERS" ? t("ir.tvAnswers") : `${t("ac.failed")}${d.error ? ` (${d.error})` : ""}`);
    } finally { setBusy(false); }
  }

  if (!settings) return null;
  const changed = (id: number) => { const a = ids[id], b = saved[id]; return Boolean(a) && (a.hubId !== (b?.hubId ?? "") || a.acRemoteId !== (b?.acRemoteId ?? "") || a.tvRemoteId !== (b?.tvRemoteId ?? "")); };
  const hub = Object.values(ids).find((x) => x.hubId)?.hubId ?? "";
  return (
    <section className="card">
      <h3>{t("ir.title")}</h3>
      <small className="muted">{t("ir.help")}</small>
      <div className="acSettings">
        <label className="apSwitch"><input type="checkbox" disabled={!canSetup || busy} checked={settings.auto} onChange={(e) => setSettings({ ...settings, auto: e.target.checked })} /> <b>{t("ir.auto")}</b></label>
        <label className="inline" style={{ marginLeft: 16 }}>{t("ir.onWith")} <select disabled={!canSetup} value={settings.mode} onChange={(e) => setSettings({ ...settings, mode: Number(e.target.value) })}>{MODES.map((k, i) => <option key={k} value={i}>{t(k)}</option>)}</select>
          {" "}<input type="number" min={16} max={30} disabled={!canSetup} value={settings.temp} onChange={(e) => setSettings({ ...settings, temp: Number(e.target.value) })} />°
          {" "}<select disabled={!canSetup} value={settings.wind} onChange={(e) => setSettings({ ...settings, wind: Number(e.target.value) })}>{WINDS.map((k, i) => <option key={k} value={i}>{t(k)}</option>)}</select></label>
        {canSetup && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "settings", ...settings })}>{t("ac.save")}</button>}
        {hub && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "remotes", hubId: hub }, "ir.found")}>{t("ir.find")}</button>}
      </div>
      <div className="acSettings">
        <label className="apSwitch"><input type="checkbox" disabled={!canSetup || busy} checked={settings.limit} onChange={(e) => setSettings({ ...settings, limit: e.target.checked })} /> <b>{t("ir.limit")}</b></label>
        <label className="inline" style={{ marginLeft: 16 }}>{t("ir.coolMin")} <input type="number" min={16} max={30} disabled={!canSetup} value={settings.coolMin} onChange={(e) => setSettings({ ...settings, coolMin: Number(e.target.value) })} />°</label>
        <label className="inline" style={{ marginLeft: 16 }}>{t("ir.heatMax")} <input type="number" min={16} max={30} disabled={!canSetup} value={settings.heatMax} onChange={(e) => setSettings({ ...settings, heatMax: Number(e.target.value) })} />°</label>
        <label className="inline" style={{ marginLeft: 16 }}><input type="checkbox" disabled={!canSetup} checked={settings.quiet} onChange={(e) => setSettings({ ...settings, quiet: e.target.checked })} /> {t("ir.quiet")}</label>
      </div>
      {settings.limit && <small className="muted">{t("ir.limitHelp")}</small>}
      {remotes && <div className="muted"><small>{remotes.length ? remotes.map((r) => `${r.name || "—"}: ${r.id}`).join(" · ") : t("ir.noRemotes")}</small></div>}
      {msg && <p className="muted" role="status">{msg}</p>}
      <table className="dataTable">
        <thead><tr><th>{t("ac.room")}</th><th>{t("ir.hub")}</th><th>{t("ir.acRemote")}</th><th>{t("ir.last")}</th>{canSwitch && <th />}</tr></thead>
        <tbody>{rooms.map((r) => { const v = ids[r.roomId] ?? { hubId: "", acRemoteId: "", tvRemoteId: "" }; const s = saved[r.roomId]; const set = (k: keyof Ids, val: string) => setIds({ ...ids, [r.roomId]: { ...v, [k]: val.trim() } }); return (
          <tr key={r.roomId}>
            <td><b>{r.code}</b>{r.guest && <><br /><small className="muted">{r.guest}</small></>}</td>
            <td><input className="acId" maxLength={64} disabled={!canSetup} value={v.hubId} onChange={(e) => set("hubId", e.target.value)} /></td>
            <td><input className="acId" maxLength={64} disabled={!canSetup} value={v.acRemoteId} onChange={(e) => set("acRemoteId", e.target.value)} />
              {canSetup && changed(r.roomId) && <><br /><button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "room", roomId: r.roomId, ...v })}>{t("ac.save")}</button></>}</td>
            <td><small>
              {s?.lastAcAt ? <>❄️ {s.lastAc} · {when(s.lastAcAt)}{s.lastAcError ? <span className="debit"> · {s.lastAcError}</span> : <> · {t("ir.sent")}</>}<br /></> : null}
              {r.temp !== null && <span className="muted">🌡️ {r.temp}°{r.climateReadAt ? ` · ${when(r.climateReadAt)}` : ""}</span>}
            </small></td>
            {canSwitch && <td>{s?.acRemoteId && <>
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "ac", roomId: r.roomId, on: true }, "ir.sentOk")}>{t("ir.acOn")}</button>
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "ac", roomId: r.roomId, on: false }, "ir.sentOk")}>{t("ir.acOff")}</button></>}
            </td>}
          </tr>
        ); })}</tbody>
      </table>
    </section>
  );
}
