"use client";
import { useCallback, useEffect, useState } from "react";
import type { PmsKey, PmsLang, pmsT } from "@/lib/pms-i18n";
import { requestDetailsSummary, tvRequestLabels } from "@/lib/tv-requests-core";
import type { TvRequestRow } from "@/lib/tv-requests";

type T = ReturnType<typeof pmsT>;
type Stay = { id: number; version: number; guest: string; room: string | null; people: number; status: string };
type Inspect = { id: number; status: string; type: string; room: string; cleanedBy: string; mine: boolean };
type Reception = { arrivals: Stay[]; departures: Stay[]; requests: TvRequestRow[]; inspect: Inspect[] };
type Notice = { id: number; room_code: string; severity: string; description: string; reporter_name: string | null; reported_at: number; photo_ids: number[] };
type Can = { checkInOut: boolean; housekeepingWrite: boolean; resolve: boolean };

const time = (ms: number, lang: PmsLang) => new Date(ms).toLocaleTimeString(lang === "el" ? "el-GR" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

function usePart<D>(part: string, refreshKey: number) {
  const [data, setData] = useState<D | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await (await fetch(`/api/pms/staff-app?part=${part}`, { cache: "no-store" })).json();
      if (d.ok && d[part]) setData(d[part]);
    } catch { /* keep */ }
  }, [part]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);
  return [data, load] as const;
}

async function call(url: string, method: string, body: unknown, t: T, toast: (s: string) => void): Promise<boolean> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const k = `err.${d.error}` as PmsKey; toast(t(k) !== k ? t(k) : t("desk.actionFailed")); }
  return r.ok;
}

/** Front desk on the phone: arrivals and departures, TV requests, rooms waiting for inspection. */
export function ReceptionSection({ lang, t, can, refreshKey, toast }: { lang: PmsLang; t: T; can: Can; refreshKey: number; toast: (s: string) => void }) {
  const [data, load] = usePart<Reception>("reception", refreshKey);
  const [busy, setBusy] = useState(false);
  const act = async (url: string, method: string, body: unknown, ok: string) => {
    setBusy(true);
    try { if (await call(url, method, body, t, toast)) { toast(ok); await load(); } } finally { setBusy(false); }
  };
  if (!data) return <p className="hkEmpty">…</p>;
  const stay = (s: Stay, action: "check_in" | "check_out") => (
    <li key={s.id} className="stRow">
      <span className="hkCode sm">{s.room ?? "—"}</span>
      <span className="stMain"><b>{s.guest}</b><small>{t("stf.people", { n: s.people })} · {t(`stf.status.${s.status}` as PmsKey)}</small></span>
      {can.checkInOut && ((action === "check_in" && s.status === "confirmed") || (action === "check_out" && s.status === "checked_in")) && (
        <button type="button" className="stBtn" disabled={busy} onClick={() => void act(`/api/pms/reservations/${s.id}`, "PATCH", { action, version: s.version }, t(action === "check_in" ? "stf.checkedIn" : "stf.checkedOut"))}>{action === "check_in" ? "Check-in" : "Check-out"}</button>
      )}
    </li>
  );
  return (
    <div className="stSections">
      <section className="stCard"><h2>🧳 {t("stf.arrivals")} <em>{data.arrivals.length}</em></h2>{data.arrivals.length ? <ul>{data.arrivals.map((s) => stay(s, "check_in"))}</ul> : <p className="hkEmpty sm">{t("stf.none")}</p>}</section>
      <section className="stCard"><h2>👋 {t("stf.departures")} <em>{data.departures.length}</em></h2>{data.departures.length ? <ul>{data.departures.map((s) => stay(s, "check_out"))}</ul> : <p className="hkEmpty sm">{t("stf.none")}</p>}</section>
      <section className="stCard">
        <h2>📺 {t("stf.tvRequests")} <em>{data.requests.length}</em></h2>
        {data.requests.length ? <ul>{data.requests.map((q) => { const l = tvRequestLabels[q.kind]; const more = requestDetailsSummary(q.details, lang); return (
          <li key={q.id} className="stRow">
            <span className="hkCode sm">{q.roomCode}</span>
            <span className="stMain"><b>{l.icon} {l[lang]}</b><small>{more ? `${more} · ` : ""}{time(q.createdAt, lang)}</small></span>
            {can.housekeepingWrite && <button type="button" className="stBtn" disabled={busy} onClick={() => void act("/api/pms/tv-requests", "POST", { action: "done", id: q.id }, t("stf.done"))}>✓</button>}
          </li>
        ); })}</ul> : <p className="hkEmpty sm">{t("stf.none")}</p>}
      </section>
      <section className="stCard">
        <h2>🔍 {t("stf.inspect")} <em>{data.inspect.length}</em></h2>
        {data.inspect.length ? <ul>{data.inspect.map((x) => (
          <li key={x.id} className="stRow">
            <span className="hkCode sm">{x.room}</span>
            <span className="stMain"><b>{t(`hkb.st.${x.status}` as PmsKey)}</b><small>{x.cleanedBy}</small></span>
            {can.housekeepingWrite && !x.mine && <>
              <button type="button" className="stBtn" disabled={busy} onClick={() => void act(`/api/pms/housekeeping/${x.id}`, "PATCH", { action: "approve" }, t("hkb.updated"))}>✓ {t("stf.approve")}</button>
              <button type="button" className="stBtn ghost" disabled={busy} onClick={() => { const notes = prompt(t("hkb.inspectionNotes")); if (notes?.trim()) void act(`/api/pms/housekeeping/${x.id}`, "PATCH", { action: "reject", notes: notes.trim() }, t("hkb.updated")); }}>↩</button>
            </>}
          </li>
        ))}</ul> : <p className="hkEmpty sm">{t("stf.none")}</p>}
      </section>
    </div>
  );
}

/** Maintenance on the phone: open defects with photos, and "Repaired". */
export function MaintenanceSection({ lang, t, can, refreshKey, toast }: { lang: PmsLang; t: T; can: Can; refreshKey: number; toast: (s: string) => void }) {
  const [data, load] = usePart<{ notices: Notice[] }>("maintenance", refreshKey);
  const [fix, setFix] = useState<Notice | null>(null);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"clean" | "dirty">("dirty");
  const [busy, setBusy] = useState(false);
  if (!data) return <p className="hkEmpty">…</p>;
  async function resolve() {
    if (!fix) return;
    setBusy(true);
    try {
      if (await call(`/api/pms/maintenance/${fix.id}`, "PATCH", { resolutionNotes: notes.trim(), postRepairState: state }, t, toast)) { toast(t("stf.repaired")); setFix(null); setNotes(""); await load(); }
    } finally { setBusy(false); }
  }
  return (
    <>
      {data.notices.length === 0 ? <p className="hkEmpty">{t("stf.noDefects")}</p> : (
        <ul className="hkList">
          {data.notices.map((n) => (
            <li key={n.id} className={`hkRoom sev-${n.severity}`}>
              <div className="hkRoomHead static">
                <span className="hkCode">{n.room_code}</span>
                <span className="hkWhat"><b>{t(`mnt.sev.${n.severity}` as PmsKey)}</b><small>{n.reporter_name ?? ""} · {new Date(Number(n.reported_at)).toLocaleString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" })}</small></span>
              </div>
              <div className="hkRoomBody">
                <p className="hkNote">{n.description}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {n.photo_ids.length > 0 && <div className="stPhotos">{n.photo_ids.map((p) => <a key={p} href={`/api/pms/maintenance/photos/${p}`} target="_blank" rel="noreferrer"><img src={`/api/pms/maintenance/photos/${p}`} alt="" loading="lazy" /></a>)}</div>}
                {can.resolve && <button type="button" className="hkBig" onClick={() => { setFix(n); setNotes(""); }}>🔧 {t("stf.markRepaired")}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {fix && (
        <div className="hkSheet" role="dialog" aria-modal="true">
          <div className="hkSheetCard">
            <h2>🔧 {t("stf.markRepaired")} · {fix.room_code}</h2>
            <textarea value={notes} maxLength={4000} autoFocus placeholder={t("stf.whatWasDone")} onChange={(e) => setNotes(e.target.value)} />
            <div className="hkLinen">
              {(["dirty", "clean"] as const).map((s) => <button type="button" key={s} className={state === s ? "done" : ""} onClick={() => setState(s)}>{t(s === "dirty" ? "stf.needsCleaning" : "stf.readyClean")}</button>)}
            </div>
            <div className="hkActions">
              <button type="button" onClick={() => setFix(null)}>{t("hkb.cancel")}</button>
              <button type="button" className="primary" disabled={busy || notes.trim().length < 5} onClick={() => void resolve()}>{t("hkb.submit")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
