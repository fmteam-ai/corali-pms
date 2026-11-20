"use client";
// v178: TV by infrared on PMS → Corali TV (moved from the A/C page): the room's TV remote in its Tuya IR hub and the
// «Power (IR)» key for a TV that does not answer (e.g. after a power cut). The hub itself is set on the A/C page.
import { useCallback, useEffect, useState } from "react";
import type { IrRoom } from "@/lib/room-ir";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { Fold } from "./fold";

export function TvIr({ lang, rooms, canSetup, canSwitch }: { lang: PmsLang; rooms: { id: number; code: string }[]; canSetup: boolean; canSwitch: boolean }) {
  const t = pmsT(lang);
  const [saved, setSaved] = useState<Record<number, IrRoom> | null>(null);
  const [ids, setIds] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  const apply = (list: IrRoom[]) => {
    const by = Object.fromEntries(list.map((r) => [r.roomId, r]));
    setSaved(by);
    setIds(Object.fromEntries(list.map((r) => [r.roomId, r.tvRemoteId])));
  };
  const load = useCallback(async () => {
    const d = await fetch("/api/pms/room-ir", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (d?.ok) apply(d.rooms);
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  async function post(body: object, ok: PmsKey) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/room-ir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.rooms) apply(d.rooms);
      setMsg(r.ok ? t(ok) : d.error === "TV_ANSWERS" ? t("ir.tvAnswers") : d.error === "NO_HUB" ? t("ir.noHub") : `${t("ac.failed")}${d.error ? ` (${d.error})` : ""}`);
    } finally { setBusy(false); }
  }
  // Hidden for users who cannot read the A/C set-up, and when no room has an IR hub.
  if (!saved || !Object.values(saved).some((r) => r.hubId)) return null;
  return (
    <Fold card title={`📺 ${t("ir.tvTitle")}`}>
      <small className="muted">{t("ir.tvHelp")}</small>
      {msg && <p className="muted" role="status">{msg}</p>}
      <div className="tableWrap"><table className="dataTable">
        <thead><tr><th>{t("ac.room")}</th><th>{t("ir.tvRemote")}</th><th>{t("ir.last")}</th>{canSwitch && <th />}</tr></thead>
        <tbody>{rooms.map((room) => { const s = saved[room.id], v = ids[room.id] ?? ""; return (
          <tr key={room.id}>
            <td><b>{room.code}</b></td>
            <td>{s?.hubId ? <>
              <input className="acId" maxLength={64} disabled={!canSetup} value={v} onChange={(e) => setIds({ ...ids, [room.id]: e.target.value.trim() })} />
              {canSetup && v !== (s.tvRemoteId ?? "") && <> <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "tvRemote", roomId: room.id, tvRemoteId: v }, "ac.saved")}>{t("ac.save")}</button></>}
            </> : <small className="muted">{t("ir.noHub")}</small>}</td>
            <td><small>{s?.lastTvAt ? <>📺 Power · {when(s.lastTvAt)}{s.lastTvError ? <span className="debit"> · {s.lastTvError}</span> : <> · {t("ir.sent")}</>}</> : "—"}</small></td>
            {canSwitch && <td>{s?.tvRemoteId && <button type="button" className="secondaryButton" disabled={busy} onClick={() => { if (window.confirm(t("ir.tvConfirm"))) void post({ action: "tv", roomId: room.id }, "ir.sentOk"); }}>{t("ir.tvPower")}</button>}</td>}
          </tr>
        ); })}</tbody>
      </table></div>
    </Fold>
  );
}
