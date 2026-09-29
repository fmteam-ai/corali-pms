"use client";
import { useState } from "react";
import { checklistLabels, checklistProgress, housekeepingChecklist } from "@/lib/housekeeping";
import { housekeepingColors, housekeepingState } from "@/lib/tape-chart";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Task = { id: number; room_code: string; room_type: string; task_type: string; status: string; assigned_to: string | null; assigned_name: string | null; cleaned_by_staff_id: number | null; notes: string | null; inspection_notes: string | null; checklist_json: string };
type Room = { id: number; code: string; operational_status: string; open_task_status: string | null };
type Filter = "mine" | "all" | "review" | "ooo";
type Pending = { taskId: number; action: "report_issue" | "reject" | "repair_done" } | null;

export function HousekeepingBoard({ lang, initialTasks, rooms, userId, canWrite }: { lang: PmsLang; initialTasks: Task[]; rooms: Room[]; userId: number; canWrite: boolean }) {
  const t = pmsT(lang);
  const labels = checklistLabels[lang];
  const [tasks, setTasks] = useState(initialTasks);
  const [checks, setChecks] = useState<Record<number, Record<string, boolean>>>(() => Object.fromEntries(initialTasks.map((x) => { try { return [x.id, JSON.parse(x.checklist_json || "{}")]; } catch { return [x.id, {}]; } })));
  const [filter, setFilter] = useState<Filter>(initialTasks.some((x) => x.assigned_to === String(userId)) ? "mine" : "all");
  const [pending, setPending] = useState<Pending>(null);
  const [notes, setNotes] = useState("");
  const [severe, setSevere] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const label = (prefix: string, key: string) => { const k = `${prefix}.${key}` as PmsKey; return t(k) === k ? key : t(k); };

  async function act(task: Task, action: string, extra: { notes?: string; severe?: boolean } = {}) {
    setBusy(task.id);
    try {
      const r = await fetch(`/api/pms/housekeeping/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, checklist: checks[task.id] ?? {}, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(label("err", d.error ?? "UPDATE_FAILED") === (d.error ?? "UPDATE_FAILED") ? t("desk.actionFailed") : label("err", d.error)); return; }
      setTasks((a) => a.map((v) => (v.id === task.id ? { ...v, ...d.task } : v)));
      setMsg(t("hkb.updated"));
      setPending(null);
      setNotes("");
      setSevere(false);
    } finally {
      setBusy(null);
    }
  }

  const shown = tasks.filter((x) => filter === "all" ? true : filter === "mine" ? x.assigned_to === String(userId) : filter === "review" ? (x.status === "cleaned" || x.status === "repaired") && x.cleaned_by_staff_id !== userId : x.status === "out_of_order");
  const counts: Record<Filter, number> = { mine: tasks.filter((x) => x.assigned_to === String(userId) && x.status !== "ready").length, all: tasks.filter((x) => x.status !== "ready").length, review: tasks.filter((x) => (x.status === "cleaned" || x.status === "repaired") && x.cleaned_by_staff_id !== userId).length, ooo: tasks.filter((x) => x.status === "out_of_order").length };

  return (
    <>
      <div className="hkRooms" aria-label={t("hkb.rooms")}>
        {rooms.map((r) => { const state = housekeepingState(r.operational_status, r.open_task_status); return <span key={r.id} title={t(`hk.${state}` as PmsKey)}><i style={{ background: housekeepingColors[state] }} />{r.code}</span>; })}
      </div>
      <div className="segmented hkFilters" role="group">
        {(["mine", "all", "review", "ooo"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(f === "mine" ? "hkb.mine" : f === "all" ? "hkb.all" : f === "review" ? "hkb.review" : "hkb.ooo")} · {counts[f]}</button>)}
      </div>
      <p className="notice" role="status">{msg}</p>
      {shown.length === 0 && <p>{t("hkb.empty")}</p>}
      <div className="hkBoard">
        {shown.map((task) => {
          const done = checklistProgress(checks[task.id]);
          const reviewer = task.cleaned_by_staff_id !== userId;
          const form = pending?.taskId === task.id ? pending : null;
          return (
            <article key={task.id} className={`hkCard st-${task.status}`}>
              <header>
                <div><h2>{t("hkb.room", { code: task.room_code })}</h2><small>{task.room_type} · {label("hkb.type", task.task_type)}</small></div>
                <span className={`hkStatus st-${task.status}`}>{label("hkb.st", task.status)}</span>
              </header>
              <p className="hkAssigned">{t("hkb.assigned")}: {task.assigned_name ?? t("hkb.unassigned")}</p>
              {task.notes && <p className="hkIssue"><b>{t("hkb.notes")}:</b> {task.notes}</p>}
              {task.inspection_notes && task.status !== "ready" && <p className="hkIssue"><b>{t("hkb.inspectionNotes")}:</b> {task.inspection_notes}</p>}
              {task.status === "in_progress" && (
                <fieldset className="hkChecklist">
                  <legend>{t("hkb.checklist")} · {t("hkb.progress", { done, total: housekeepingChecklist.length })}</legend>
                  <progress max={housekeepingChecklist.length} value={done} />
                  {housekeepingChecklist.map((key, i) => (
                    <label key={key} className={checks[task.id]?.[key] ? "done" : undefined}>
                      <input type="checkbox" disabled={!canWrite} checked={checks[task.id]?.[key] ?? false} onChange={(e) => setChecks((a) => ({ ...a, [task.id]: { ...a[task.id], [key]: e.target.checked } }))} />
                      <span>{i + 1}. {labels[key]}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {form && (
                <div className="hkForm">
                  <label>{t("hkb.describe")}<textarea value={notes} maxLength={2000} autoFocus onChange={(e) => setNotes(e.target.value)} /></label>
                  {form.action === "report_issue" && <label className="hkSevere"><input type="checkbox" checked={severe} onChange={(e) => setSevere(e.target.checked)} /> {t("hkb.severe")}</label>}
                  <div className="actions">
                    <button type="button" disabled={!notes.trim() || busy === task.id} onClick={() => act(task, form.action, { notes: notes.trim(), severe: form.action === "report_issue" ? severe : undefined })}>{t("hkb.submit")}</button>
                    <button type="button" className="secondaryButton" onClick={() => { setPending(null); setNotes(""); setSevere(false); }}>{t("hkb.cancel")}</button>
                  </div>
                </div>
              )}
              {canWrite && !form && (
                <div className="actions hkActions">
                  {task.status === "todo" && <button disabled={busy === task.id} onClick={() => act(task, "start")}>{t("hkb.start")}</button>}
                  {task.status === "in_progress" && <button disabled={busy === task.id || done < housekeepingChecklist.length} onClick={() => act(task, "complete")}>{t("hkb.complete")}</button>}
                  {(task.status === "cleaned" || task.status === "repaired") && (reviewer
                    ? <><button disabled={busy === task.id} onClick={() => act(task, "approve")}>{t("hkb.approve")}</button><button className="danger" onClick={() => setPending({ taskId: task.id, action: "reject" })}>{t("hkb.reject")}</button></>
                    : <small>{t("hkb.secondPerson")}</small>)}
                  {task.status === "out_of_order" && <button onClick={() => setPending({ taskId: task.id, action: "repair_done" })}>{t("hkb.repairDone")}</button>}
                  {(task.status === "todo" || task.status === "in_progress") && <button className="danger" onClick={() => setPending({ taskId: task.id, action: "report_issue" })}>{t("hkb.report")}</button>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
