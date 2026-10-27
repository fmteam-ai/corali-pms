"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AcStatus } from "@/lib/room-ac";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type State = AcStatus;
type Live = Record<number, { online: boolean; on: boolean | null; power: number | null }>;

export function RoomAc({ lang, canSetup, canSwitch }: { lang: PmsLang; canSetup: boolean; canSwitch: boolean }) {
  const t = pmsT(lang);
  const [data, setData] = useState<State | null>(null);
  const [ids, setIds] = useState<Record<number, string>>({});
  const [sensors, setSensors] = useState<Record<number, string>>({});
  const [away, setAway] = useState(20);
  const [live, setLive] = useState<Live>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

  const apply = (d: State) => { setData(d); setAway(d.awayMinutes); setIds(Object.fromEntries(d.rooms.map((r) => [r.roomId, r.deviceId]))); setSensors(Object.fromEntries(d.rooms.map((r) => [r.roomId, r.presenceDeviceId]))); };
  const load = useCallback(async () => { const r = await fetch("/api/pms/room-ac", { cache: "no-store" }); const d = await r.json().catch(() => null); if (d?.ok) apply(d); }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  async function post(body: object, ok: PmsKey = "ac.saved") {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/room-ac", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.rooms) apply(d);
      if (d.live) setLive(d.live);
      setMsg(r.ok ? t(ok) : `${t("ac.failed")}${d.error ? ` (${d.error})` : ""}`);
    } finally { setBusy(false); }
  }

  if (!data) return <p className="muted">{t("ac.loading")}</p>;
  const linked = data.rooms.filter((r) => r.deviceId);
  return (
    <div className="acPage">
      {msg && <p className="notice" role="status">{msg}</p>}
      <section className="card acHead">
        <label className="apSwitch"><input type="checkbox" disabled={!canSetup || busy} checked={data.enabled} onChange={(e) => void post({ action: "enabled", enabled: e.target.checked, presence: data.presence, awayMinutes: away })} /> <b>{t("ac.enabled")}</b></label>
        <p className="muted">{t("ac.rule")}</p>
        <div className="acPresence">
          <label className="apSwitch"><input type="checkbox" disabled={!canSetup || busy} checked={data.presence} onChange={(e) => void post({ action: "enabled", enabled: data.enabled, presence: e.target.checked, awayMinutes: away })} /> <b>{t("ac.presence")}</b></label>
          <div className="apRow">{t("ac.awayAfter")} <input type="number" min={5} max={240} disabled={!canSetup || busy} value={away} onChange={(e) => setAway(Number(e.target.value) || 20)} /> {t("ac.minutes")}
            {canSetup && away !== data.awayMinutes && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "enabled", enabled: data.enabled, presence: data.presence, awayMinutes: away })}>{t("ac.save")}</button>}</div>
          <small className="muted">{t("ac.presenceHelp")}</small>
          {data.presence && !data.tuyaReady && <p className="notice">{t("ac.noTuya")} <Link href="/pms/integrations">{t("ac.tuyaLink")}</Link></p>}
        </div>
        {!data.cloudReady && <p className="notice">{t("ac.noCloud")} <Link href="/pms/tv">{t("ac.cloudLink")}</Link></p>}
        <div className="apRow">
          <small className="muted">{t("ac.count", { n: String(linked.length), on: String(linked.filter((r) => r.state).length) })}</small>
          {data.cloudReady && linked.length > 0 && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "live" }, "ac.checked")}>{t("ac.check")}</button>}
        </div>
      </section>
      <section className="card">
        <table className="apTable acTable">
          <thead><tr><th>{t("ac.room")}</th><th>{t("ac.guest")}</th><th>{t("ac.device")}</th>{data.presence && <th>{t("ac.sensor")}</th>}<th>{t("ac.power")}</th><th>{t("ac.mode")}</th>{canSwitch && <th />}</tr></thead>
          <tbody>{data.rooms.map((r) => { const l = live[r.roomId]; return (
            <tr key={r.roomId} className={r.occupied ? "occ" : ""}>
              <td><b>{r.code}</b> <small className="muted">{r.roomType}</small></td>
              <td>{r.occupied ? <span className="credit">● {r.guest}</span> : <span className="muted">{t("ac.empty")}</span>}</td>
              <td>
                <div className="apRow">
                  <input className="acId" placeholder={t("ac.deviceId")} maxLength={64} disabled={!canSetup} value={ids[r.roomId] ?? ""} onChange={(e) => setIds({ ...ids, [r.roomId]: e.target.value.trim() })} />
                  {canSetup && ((ids[r.roomId] ?? "") !== r.deviceId || (sensors[r.roomId] ?? "") !== r.presenceDeviceId) && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "device", roomId: r.roomId, deviceId: ids[r.roomId] ?? "", channel: 0, presenceDeviceId: sensors[r.roomId] ?? "" })}>{t("ac.save")}</button>}
                </div>
              </td>
              {data.presence && <td>
                <input className="acId" placeholder={t("ac.sensorId")} maxLength={64} disabled={!canSetup} value={sensors[r.roomId] ?? ""} onChange={(e) => setSensors({ ...sensors, [r.roomId]: e.target.value.trim() })} />
                {r.presenceDeviceId && r.occupied && <div><small>{r.presenceNow === null ? <span className="muted">{t("ac.noReading")}</span> : r.presenceNow ? <span className="credit">👤 {t("ac.present")}</span> : <span>{t("ac.away")}{r.presenceSeenAt ? ` · ${t("ac.lastSeen")} ${when(r.presenceSeenAt)}` : ""}</span>}</small></div>}
              </td>}
              <td>
                {!r.deviceId ? <span className="muted">—</span> : l ? (l.online ? <b className={l.on ? "credit" : ""}>{l.on ? `● ${t("ac.on")}` : `○ ${t("ac.off")}`}{l.power !== null ? ` · ${Math.round(l.power)} W` : ""}</b> : <b className="debit">{t("ac.offline")}</b>)
                  : r.state === null ? <span className="muted">?</span> : <span>{r.state ? `● ${t("ac.on")}` : `○ ${t("ac.off")}`}{r.changedAt ? <small className="muted"> · {when(r.changedAt)}</small> : null}</span>}
                {r.error && <div><small className="debit">{r.error}</small></div>}
              </td>
              <td>{r.overrideUntil ? <span>✋ {t(r.overrideOn ? "ac.manualOn" : "ac.manualOff")}<small className="muted"> · {r.occupied ? t("ac.untilChange") : `${t("ac.until")} ${when(r.overrideUntil)}`}</small></span> : <span className="muted">{t("ac.auto")}</span>}</td>
              {canSwitch && <td>{r.deviceId && data.enabled && data.cloudReady && <div className="apRow">
                <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "switch", roomId: r.roomId, on: true }, "ac.switched")}>{t("ac.turnOn")}</button>
                <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "switch", roomId: r.roomId, on: false }, "ac.switched")}>{t("ac.turnOff")}</button>
                {r.overrideUntil && <button type="button" className="linkButton" disabled={busy} onClick={() => void post({ action: "auto", roomId: r.roomId })}>{t("ac.backAuto")}</button>}
              </div>}</td>}
            </tr>
          ); })}</tbody>
        </table>
      </section>
      <section className="card acHelp">
        <h3>{t("ac.howTitle")}</h3>
        <ol>
          <li>{t("ac.how1")}</li>
          <li>{t("ac.how2")}</li>
          <li>{t("ac.how3")}</li>
          <li>{t("ac.how4")}</li>
          <li>{t("ac.how5")}</li>
        </ol>
      </section>
    </div>
  );
}
