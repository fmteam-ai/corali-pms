"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DefectForm } from "@/app/pms/maintenance/defect-form";
import type { HkRoom } from "@/lib/hk-mobile";
import { hkChanges, type HkSnapshot } from "@/lib/hk-mobile-core";
import type { HkService } from "@/lib/hk-services-core";
import { checklistFor, checklistLabels, checklistProgress } from "@/lib/housekeeping";
import type { PmsKey, PmsLang, pmsT } from "@/lib/pms-i18n";

type T = ReturnType<typeof pmsT>;
const snapshot = (rooms: HkRoom[], me: number): HkSnapshot => ({
  rooms: rooms.map((r) => ({ code: r.code, departed: Boolean(r.departure?.departed), task: r.task ? { id: r.task.id, assignedToMe: r.task.assignedTo === String(me) } : null })),
  messages: [],
});

/** Today's rooms: departures/arrivals/stayovers, sheets & towels, cleaning steps and problems. */
export function HousekeepingSection({ lang, t, me, canWrite, isHousekeeper, refreshKey, ring, toast, writeTo }: {
  lang: PmsLang; t: T; me: number; canWrite: boolean; isHousekeeper: boolean; refreshKey: number;
  ring: (line: string) => void; toast: (line: string) => void; writeTo: (room: { id: number; code: string }) => void;
}) {
  const [rooms, setRooms] = useState<HkRoom[] | null>(null);
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [problem, setProblem] = useState<HkRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const prev = useRef<HkSnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/pms/hk-mobile", { cache: "no-store" })).json();
      if (!d.ok) return;
      setRooms(d.rooms);
      const next = snapshot(d.rooms, me), c = hkChanges(prev.current, next);
      prev.current = next;
      const parts = [c.departed.length ? t("hkm.alertDeparted", { rooms: c.departed.join(", ") }) : "", c.tasks.length ? t("hkm.alertTasks", { rooms: c.tasks.join(", ") }) : ""].filter(Boolean);
      if (parts.length) ring(parts.join(" · "));
    } catch { /* offline: keep the list */ }
  }, [me, ring, t]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  async function task(room: HkRoom, action: "start" | "complete" | "report_issue", extra: Record<string, unknown> = {}) {
    if (!room.task) return false;
    setBusy(true);
    try {
      const r = await fetch(`/api/pms/housekeeping/${room.task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, checklist: room.task.checklist, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `err.${d.error}` as PmsKey; toast(t(k) !== k ? t(k) : t("desk.actionFailed")); return false; }
      await load();
      return true;
    } finally { setBusy(false); }
  }
  function tick(room: HkRoom, key: string) {
    if (!room.task) return;
    const checklist = { ...room.task.checklist, [key]: !room.task.checklist[key] };
    setRooms((list) => list?.map((x) => (x.id === room.id && x.task ? { ...x, task: { ...x.task, checklist } } : x)) ?? null);
  }
  async function linen(room: HkRoom, service: HkService) {
    if (!room.stay) return;
    const done = !room.done.includes(service);
    setRooms((list) => list?.map((x) => (x.id === room.id ? { ...x, done: done ? [...x.done, service] : x.done.filter((s) => s !== service) } : x)) ?? null);
    await fetch("/api/pms/housekeeping/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "done", bookingId: room.stay.bookingId, service, done }) }).catch(() => {});
  }

  const all = rooms ?? [];
  const shown = mine ? all.filter((r) => r.task?.assignedTo === String(me)) : all;
  const count = (f: (r: HkRoom) => boolean) => all.filter(f).length;
  const labels = checklistLabels[lang];
  // A free room with open work is named after the work (e.g. departure clean), not "vacant".
  const kindLabel = (r: HkRoom) => (r.kind === "vacant" && r.task ? t(`hkb.type.${r.task.type}` as PmsKey) : t(`hkm.kind.${r.kind}` as PmsKey));

  return (
    <>
      <div className="hkSummary">
        <span>{t("hkm.sumDepartures")} <b>{count((r) => r.kind === "departure" || r.kind === "turnover")}</b></span>
        <span>{t("hkm.sumArrivals")} <b>{count((r) => r.arrival != null)}</b></span>
        <span>{t("hkm.sheets")} <b>{count((r) => r.due.includes("sheets") && !r.done.includes("sheets"))}</b></span>
        <span>{t("hkm.towels")} <b>{count((r) => r.due.includes("towels") && !r.done.includes("towels"))}</b></span>
      </div>
      {isHousekeeper && <label className="hkMine"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t("hkm.onlyMine")}</label>}
      {rooms === null ? <p className="hkEmpty">…</p> : shown.length === 0 ? <p className="hkEmpty">{t("hkm.nothing")}</p> : (
        <ul className="hkList">
          {shown.map((r) => {
            const tk = r.task, list = tk ? checklistFor(tk.type) : [], doneSteps = tk ? checklistProgress(tk.checklist, tk.type) : 0, expanded = open === r.id;
            return (
              <li key={r.id} className={`hkRoom k-${r.kind}${r.dnd ? " dnd" : ""}`}>
                <button type="button" className="hkRoomHead" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.id)}>
                  <span className="hkCode">{r.code}</span>
                  <span className="hkWhat">
                    <b>{kindLabel(r)}</b>
                    {r.departure && <small>{r.departure.departed ? `✓ ${t("hkm.departed")}` : `⏳ ${t("hkm.notDeparted")}`}</small>}
                    {r.arrival && <small>🧳 {t("hkm.arriving", { n: r.arrival.people })}{r.arrival.checkedIn ? ` · ✓ ${t("hkm.checkedIn")}` : ""}</small>}
                    {r.stay && <small>{t("hkm.night", { n: r.stay.night, total: r.stay.nights })}</small>}
                  </span>
                  <span className="hkChips">
                    {r.dnd && <i className="chip dnd">🚫 {t("hk.dnd")}</i>}
                    {r.due.filter((s) => !r.done.includes(s)).map((s) => <i key={s} className="chip due">{s === "sheets" ? "🛏" : "🧺"} {t(s === "sheets" ? "hkm.sheets" : "hkm.towels")}</i>)}
                    {r.notices > 0 && <i className="chip warn">⚠ {r.notices}</i>}
                    {r.arrival && r.arrival.prefs.length > 0 && <i className="chip pref">⭐ {r.arrival.prefs.length}</i>}
                    {tk && <i className={`chip st-${tk.status}`}>{t(`hkb.st.${tk.status}` as PmsKey)}</i>}
                  </span>
                </button>
                {expanded && (
                  <div className="hkRoomBody">
                    {r.arrival && r.arrival.prefs.length > 0 && <p className="hkNote pref">⭐ {t("gp.prepare")}: {r.arrival.prefs.join(" · ")}</p>}
                    {tk?.notes && <p className="hkNote">📝 {tk.notes}</p>}
                    {tk?.inspectionNotes && tk.status === "in_progress" && <p className="hkNote warn">↩ {tk.inspectionNotes}</p>}
                    {r.stay && (
                      <div className="hkLinen">
                        {(["sheets", "towels"] as const).map((s) => (
                          <button type="button" key={s} disabled={!canWrite} className={`${r.due.includes(s) ? "due" : ""}${r.done.includes(s) ? " done" : ""}`} onClick={() => void linen(r, s)}>
                            {r.done.includes(s) ? "✓ " : ""}{t(s === "sheets" ? "hkm.sheetsChanged" : "hkm.towelsChanged")}
                          </button>
                        ))}
                      </div>
                    )}
                    {tk && canWrite && tk.status === "todo" && <button type="button" className="hkBig" disabled={busy} onClick={() => void task(r, "start")}>▶ {t("hkb.start")} · {t(`hkb.type.${tk.type}` as PmsKey)}</button>}
                    {tk && canWrite && tk.status === "in_progress" && (
                      <>
                        <p className="hkProgress">{t("hkb.progress", { done: doneSteps, total: list.length })}</p>
                        <ul className="hkChecklist">
                          {list.map((k) => <li key={k}><label><input type="checkbox" checked={Boolean(tk.checklist[k])} onChange={() => tick(r, k)} /> {labels[k]}</label></li>)}
                        </ul>
                        <button type="button" className="hkBig" disabled={busy || doneSteps < list.length} onClick={() => void task(r, "complete")}>✓ {t("hkm.finished")}</button>
                      </>
                    )}
                    {tk && tk.status === "cleaned" && <p className="hkNote">⏳ {t("hkb.st.cleaned")}</p>}
                    <div className="hkActions">
                      {canWrite && <button type="button" className="danger" onClick={() => setProblem(r)}>⚠ {t("hkm.problem")}</button>}
                      <button type="button" onClick={() => writeTo({ id: r.id, code: r.code })}>💬 {t("hkm.toReception")}</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problem && (
        <div className="hkSheet" role="dialog" aria-modal="true">
          <div className="hkSheetCard">
            <h2>⚠ {t("hkm.problem")} · {problem.code}</h2>
            {problem.task && (problem.task.status === "todo" || problem.task.status === "in_progress")
              ? <DefectForm lang={lang} onCancel={() => setProblem(null)} onDone={() => { setProblem(null); toast(t("hkm.problemSent")); }} onSubmit={(x) => task(problem, "report_issue", { notes: x.description, severity: x.severity, photos: x.photos })} />
              : <DefectForm lang={lang} roomId={problem.id} onCancel={() => setProblem(null)} onDone={() => { setProblem(null); toast(t("hkm.problemSent")); void load(); }} />}
          </div>
        </div>
      )}
    </>
  );
}
