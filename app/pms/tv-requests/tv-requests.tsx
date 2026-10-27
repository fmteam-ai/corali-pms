"use client";
import { useEffect, useState } from "react";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";
import type { TvRequestRow } from "@/lib/tv-requests";
import { requestDetailsSummary, tvRequestLabels } from "@/lib/tv-requests-core";

type Dnd = { roomId: number; roomCode: string; since: number };
const REFRESH_MS = 30_000;

export function TvRequests({ lang, initialRequests, initialDnd, canHandle }: { lang: PmsLang; initialRequests: TvRequestRow[]; initialDnd: Dnd[]; canHandle: boolean }) {
  const t = pmsT(lang);
  const [requests, setRequests] = useState(initialRequests);
  const [dnd, setDnd] = useState(initialDnd);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const label = (k: TvRequestRow["kind"]) => { const l = tvRequestLabels[k]; return { icon: l.icon, text: lang === "el" ? l.el : l.en }; };
  const time = (ms: number) => new Date(ms).toLocaleTimeString(pmsLocale(lang), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  const ago = (ms: number) => { const n = Math.max(0, Math.round((now - ms) / 60_000)); return n < 60 ? t("tvr.ago").replace("{n}", String(n)) : time(ms); };

  // New requests arrive every 30 s (the notification bell plays the chime).
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/pms/tv-requests${all ? "?all=1" : ""}`, { cache: "no-store" });
        const d = await r.json();
        if (!live || !d.ok) return;
        setRequests(d.requests); setDnd(d.dnd); setNow(Date.now());
      } catch { /* offline: keep the list */ }
    };
    void load();
    const poll = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(poll); };
  }, [all]);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/tv-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setDnd(d.dnd);
      if (!all) setRequests(d.requests);
      else setRequests((rs) => rs.map((x) => d.requests.find((y: TvRequestRow) => y.id === x.id) ?? x));
    } catch {
      setMsg(t("tvr.error"));
    } finally {
      setBusy(false);
    }
  }

  const open = requests.filter((r) => r.status === "open");
  const history = requests.filter((r) => r.status !== "open");
  const startOfDay = new Date(new Date(now).toLocaleDateString("en-CA", { timeZone: "Europe/Athens" }) + "T00:00:00").getTime();
  const doneToday = history.filter((r) => r.status === "done" && (r.handledAt ?? 0) >= startOfDay).length;

  return (
    <div className="tvr">
      <div className="tvrStats">
        <div className={`tvrStat${open.length ? " hot" : ""}`}><span>🔔</span><b>{open.length}</b><small>{t("tvr.open")}</small></div>
        <div className={`tvrStat${dnd.length ? " dnd" : ""}`}><span>🚫</span><b>{dnd.length}</b><small>{t("tvr.dndRooms")}</small></div>
        <div className="tvrStat"><span>✅</span><b>{doneToday}</b><small>{t("tvr.today")}</small></div>
      </div>

      <div className="card tvrDnd">
        <h2>🚫 {t("tvr.dndRooms")}</h2>
        {dnd.length === 0 ? <p className="muted">{t("tvr.noDnd")}</p> : (
          <ul>
            {dnd.map((d) => (
              <li key={d.roomId}>
                <b>{d.roomCode}</b><small>{t("tvr.since").replace("{time}", when(d.since))}</small>
                {canHandle && <button type="button" className="linkButton" disabled={busy} onClick={() => { if (confirm(t("tvr.clearDndConfirm").replace("{room}", d.roomCode))) void post({ action: "clear_dnd", roomId: d.roomId }); }}>{t("tvr.clearDnd")}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && <p className="error" role="alert">{msg}</p>}

      <div className="tvrOpen">
        {open.length === 0 ? <div className="card tvrEmpty"><span>📺</span><p>{t("tvr.none")}</p><small>{t("tvr.howTo")}</small></div> : open.map((r) => { const l = label(r.kind); return (
          <article className="card tvrCard" key={r.id}>
            <span className="tvrIcon" aria-hidden>{l.icon}</span>
            <div>
              <b>{l.text}</b>
              {r.details && <p className="tvrTransfer">{requestDetailsSummary(r.details, lang === "el" ? "el" : "en")}</p>}
              <p>{t("tvr.room")} <strong>{r.roomCode}</strong>{r.guestName ? ` · ${r.guestName}` : ""}</p>
              <small>{ago(r.createdAt)}</small>
            </div>
            {canHandle && <button type="button" className="primaryAction" disabled={busy} onClick={() => post({ action: "done", id: r.id })}>✓ {t("tvr.done")}</button>}
          </article>
        ); })}
      </div>

      <div className="card">
        <div className="tvrHistHead">
          <h2>{all ? t("tvr.all") : t("tvr.history")}</h2>
          <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t("tvr.all")}</label>
        </div>
        <div className="tableWrap">
          <table>
            <tbody>
              {history.map((r) => { const l = label(r.kind); return (
                <tr key={r.id}>
                  <td>{when(r.createdAt)}</td>
                  <td><b>{r.roomCode}</b></td>
                  <td>{l.icon} {l.text}{r.details && <small>{requestDetailsSummary(r.details, lang === "el" ? "el" : "en")}</small>}</td>
                  <td>{r.guestName ?? ""}</td>
                  <td className="muted">{r.status === "info" ? t("tvr.info") : r.status === "cancelled" ? t("tvr.cancelled") : r.handledBy ? t("tvr.doneBy").replace("{name}", r.handledBy) : t("tvr.done")}{r.handledAt ? ` · ${time(r.handledAt)}` : ""}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
