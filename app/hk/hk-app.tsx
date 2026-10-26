"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DefectForm } from "@/app/pms/maintenance/defect-form";
import { LangToggle } from "@/app/pms/lang-toggle";
import type { HkMessage, HkRoom } from "@/lib/hk-mobile";
import { hkChanges, type HkSnapshot } from "@/lib/hk-mobile-core";
import type { HkService } from "@/lib/hk-services-core";
import { checklistFor, checklistLabels, checklistProgress } from "@/lib/housekeeping";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

const REFRESH_MS = 20_000;
type View = "rooms" | "messages";
type Form = { kind: "problem"; room: HkRoom } | { kind: "message"; room: HkRoom | null } | null;

const snapshot = (rooms: HkRoom[], messages: HkMessage[], me: number): HkSnapshot => ({
  rooms: rooms.map((r) => ({ code: r.code, departed: Boolean(r.departure?.departed), task: r.task ? { id: r.task.id, assignedToMe: r.task.assignedTo === String(me) } : null })),
  messages: messages.map((m) => ({ id: m.id, mine: m.fromId === me })),
});

export function HkApp({ lang, me, name, isHousekeeper, canWrite }: { lang: PmsLang; me: number; name: string; isHousekeeper: boolean; canWrite: boolean }) {
  const t = useMemo(() => pmsT(lang), [lang]);
  const router = useRouter();
  const [rooms, setRooms] = useState<HkRoom[] | null>(null);
  const [messages, setMessages] = useState<HkMessage[]>([]);
  const [view, setView] = useState<View>("rooms");
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [text, setText] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const [offline, setOffline] = useState(false);
  const prev = useRef<HkSnapshot | null>(null);

  const ring = useCallback((line: string) => {
    setToast(line);
    setTimeout(() => setToast((x) => (x === line ? "" : x)), 8_000);
    try { navigator.vibrate?.([250, 120, 250]); } catch { /* not supported */ }
    const audio = new Audio("/sounds/pms-request.wav");
    void audio.play().catch(() => { /* sound needs one tap on "Alerts on" first */ });
    if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("Corali", { body: line, icon: "/favicon.svg" });
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/pms/hk-mobile?day=1", { cache: "no-store" });
      if (r.status === 401) { router.replace("/login"); return; }
      const d = await r.json();
      if (!d.ok) return;
      setOffline(false);
      setRooms(d.rooms);
      setMessages(d.messages);
      const next = snapshot(d.rooms, d.messages, me);
      const c = hkChanges(prev.current, next);
      prev.current = next;
      const parts = [
        c.messages ? t("hkm.alertMessages", { n: c.messages }) : "",
        c.departed.length ? t("hkm.alertDeparted", { rooms: c.departed.join(", ") }) : "",
        c.tasks.length ? t("hkm.alertTasks", { rooms: c.tasks.join(", ") }) : "",
      ].filter(Boolean);
      if (parts.length) ring(parts.join(" · "));
    } catch { setOffline(true); }
  }, [me, ring, router, t]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), REFRESH_MS);
    const wake = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", wake); };
  }, [load]);

  async function enableAlerts() {
    // A tap unlocks sound on phones; the browser may also allow notifications while the page is in the background.
    const audio = new Audio("/sounds/pms-request.wav");
    audio.volume = 0.2;
    await audio.play().catch(() => {});
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => "denied");
    setAlerts(true);
  }

  async function task(room: HkRoom, action: "start" | "complete" | "report_issue", extra: Record<string, unknown> = {}) {
    if (!room.task) return false;
    setBusy(true);
    try {
      const r = await fetch(`/api/pms/housekeeping/${room.task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, checklist: room.task.checklist, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `err.${d.error}` as PmsKey; setToast(t(k) !== k ? t(k) : t("desk.actionFailed")); return false; }
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

  async function send() {
    if (form?.kind !== "message" || !text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/pms/hk-mobile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", body: text.trim(), roomId: form.room?.id ?? null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setToast(t("hkm.sendFailed")); return; }
      setMessages(d.messages);
      prev.current = snapshot(rooms ?? [], d.messages, me);
      setText("");
      setForm(null);
      setToast(t("hkm.sent"));
    } finally { setBusy(false); }
  }

  const unread = messages.filter((m) => m.fromId !== me && !m.read && m.direction === (isHousekeeper ? "to_hk" : "to_reception")).length;
  useEffect(() => {
    if (view !== "messages" || !unread) return;
    void fetch("/api/pms/hk-mobile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read" }) }).then((r) => r.json()).then((d) => d.ok && setMessages(d.messages)).catch(() => {});
  }, [view, unread]);

  const all = rooms ?? [];
  const shown = mine ? all.filter((r) => r.task?.assignedTo === String(me)) : all;
  const count = (f: (r: HkRoom) => boolean) => all.filter(f).length;
  const labels = checklistLabels[lang];
  // A free room with open work is named after the work (e.g. departure clean), not "vacant".
  const kindLabel = (r: HkRoom) => (r.kind === "vacant" && r.task ? t(`hkb.type.${r.task.type}` as PmsKey) : t(`hkm.kind.${r.kind}` as PmsKey));
  const time = (ms: number) => new Date(ms).toLocaleTimeString(lang === "el" ? "el-GR" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

  return (
    <main className="hkApp" lang={lang}>
      <header className="hkTop">
        <div><b>{t("hkm.hello", { name: name.split(" ")[0] })}</b><small>{new Date().toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" })}</small></div>
        <span className="hkTopTools">
          <LangToggle lang={lang} label={t("app.language")} />
          <button type="button" className="hkLogout" onClick={async () => { const r = await fetch("/api/auth/logout", { method: "POST" }); if (r.ok) { router.push("/login"); router.refresh(); } }}>{t("hkm.logout")}</button>
        </span>
      </header>
      {!alerts && <button type="button" className="hkAlertsBtn" onClick={() => void enableAlerts()}>🔔 {t("hkm.enableAlerts")}</button>}
      {offline && <p className="hkOffline">{t("hkm.offline")}</p>}
      <nav className="hkTabs">
        <button type="button" aria-pressed={view === "rooms"} onClick={() => setView("rooms")}>🛏 {t("hkm.rooms")}</button>
        <button type="button" aria-pressed={view === "messages"} onClick={() => setView("messages")}>💬 {t("hkm.messages")}{unread > 0 && <span className="hkBadge">{unread}</span>}</button>
      </nav>

      {view === "rooms" ? (
        <>
          <div className="hkSummary">
            <span className="k-departure">{t("hkm.sumDepartures")} <b>{count((r) => r.kind === "departure" || r.kind === "turnover")}</b></span>
            <span className="k-arrival">{t("hkm.sumArrivals")} <b>{count((r) => r.arrival != null)}</b></span>
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
                        {tk && <i className={`chip st-${tk.status}`}>{t(`hkb.st.${tk.status}` as PmsKey)}</i>}
                      </span>
                    </button>
                    {expanded && (
                      <div className="hkRoomBody">
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
                          {canWrite && <button type="button" className="danger" onClick={() => setForm({ kind: "problem", room: r })}>⚠ {t("hkm.problem")}</button>}
                          <button type="button" onClick={() => { setForm({ kind: "message", room: r }); setText(""); }}>💬 {t(isHousekeeper ? "hkm.toReception" : "hkm.toHousekeeping")}</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <section className="hkMessages">
          <button type="button" className="hkBig" onClick={() => { setForm({ kind: "message", room: null }); setText(""); }}>✎ {t(isHousekeeper ? "hkm.toReception" : "hkm.toHousekeeping")}</button>
          {messages.length === 0 ? <p className="hkEmpty">{t("hkm.noMessages")}</p> : (
            <ul>
              {messages.map((m) => (
                <li key={m.id} className={m.fromId === me ? "mine" : ""}>
                  <small>{m.fromId === me ? t("hkm.you") : m.from}{m.room ? ` · ${t("hkb.room", { code: m.room })}` : ""} · {time(m.createdAt)}</small>
                  <p>{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {form && (
        <div className="hkSheet" role="dialog" aria-modal="true">
          <div className="hkSheetCard">
            {form.kind === "problem" ? (
              <>
                <h2>⚠ {t("hkm.problem")} · {form.room.code}</h2>
                {form.room.task && (form.room.task.status === "todo" || form.room.task.status === "in_progress")
                  ? <DefectForm lang={lang} onCancel={() => setForm(null)} onDone={() => { setForm(null); setToast(t("hkm.problemSent")); }} onSubmit={(x) => task(form.room, "report_issue", { notes: x.description, severity: x.severity, photos: x.photos })} />
                  : <DefectForm lang={lang} roomId={form.room.id} onCancel={() => setForm(null)} onDone={() => { setForm(null); setToast(t("hkm.problemSent")); void load(); }} />}
              </>
            ) : (
              <>
                <h2>💬 {t(isHousekeeper ? "hkm.toReception" : "hkm.toHousekeeping")}{form.room ? ` · ${form.room.code}` : ""}</h2>
                {isHousekeeper && <div className="hkQuick">{(["hkm.q.ready", "hkm.q.needMore", "hkm.q.lost", "hkm.q.call"] as const).map((k) => <button type="button" key={k} onClick={() => setText(t(k))}>{t(k)}</button>)}</div>}
                <textarea value={text} maxLength={500} autoFocus onChange={(e) => setText(e.target.value)} placeholder={t("hkm.write")} />
                <div className="hkActions">
                  <button type="button" onClick={() => setForm(null)}>{t("hkb.cancel")}</button>
                  <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void send()}>{t("hkm.send")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {toast && <p className="hkToast" role="status">{toast}</p>}
    </main>
  );
}
