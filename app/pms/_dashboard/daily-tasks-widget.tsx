"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HkServiceRow } from "@/lib/hk-services";
import type { HkService } from "@/lib/hk-services-core";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Task = { id: number; room_code: string; task_type: string; status: string };

/** Dashboard widget: today's housekeeping — sheets / towels changes (✓ to mark done) and open cleaning tasks. */
export function DailyTasksWidget({ lang, canHandle }: { lang: PmsLang; canHandle: boolean }) {
  const t = pmsT(lang);
  const [rows, setRows] = useState<HkServiceRow[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch("/api/pms/housekeeping/services", { cache: "no-store" }).then((r) => r.json()), fetch("/api/pms/housekeeping", { cache: "no-store" }).then((r) => r.json())]);
      if (s.ok) setRows(s.rows);
      if (h.ok) setTasks((h.tasks as Task[]).filter((x) => x.status !== "ready"));
    } catch { /* keep the last list */ }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(load, 0), poll = window.setInterval(load, 60_000);
    window.addEventListener("corali:notifications", load);
    return () => { window.clearTimeout(first); window.clearInterval(poll); window.removeEventListener("corali:notifications", load); };
  }, [load]);

  async function toggle(r: HkServiceRow, s: HkService) {
    setBusy(true);
    try {
      const res = await fetch("/api/pms/housekeeping/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "done", bookingId: r.bookingId, service: s, done: !r.done.includes(s) }) });
      const d = await res.json();
      if (d.ok) setRows(d.rows);
    } finally { setBusy(false); }
  }

  const linen = (rows ?? []).flatMap((r) => r.due.map((s) => ({ r, s, done: r.done.includes(s) })));
  const doneCount = linen.filter((x) => x.done).length;
  if (rows === null) return <p className="muted">…</p>;
  return (
    <div className="dtWidget">
      {linen.length === 0 && tasks.length === 0 && <p className="muted">{t("dt.none")}</p>}
      {linen.length > 0 && (
        <>
          <h3>🛏️ {t("dt.linen")} <small>{t("dt.progress").replace("{d}", String(doneCount)).replace("{n}", String(linen.length))}</small></h3>
          <ul>
            {linen.map(({ r, s, done }) => (
              <li key={`${r.bookingId}-${s}`} className={done ? "done" : ""}>
                <span className={`linenChip ${s}`}>{s === "sheets" ? "🛏️" : "🛁"}</span>
                <div><b>{t("hks.room")} {r.roomCode}</b>{r.dnd && <span className="dndBadge">DND</span>}<small>{t(s === "sheets" ? "hks.sheets" : "hks.towels")}</small></div>
                {canHandle && <button type="button" disabled={busy} aria-pressed={done} title={done ? t("hks.undo") : t("hks.done")} onClick={() => toggle(r, s)}>✓</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      {tasks.length > 0 && (
        <>
          <h3>🧹 {t("dt.cleaning")} <small>{tasks.length}</small></h3>
          <ul>
            {tasks.slice(0, 10).map((x) => (
              <li key={x.id}>
                <span className={`dtStatus st-${x.status}`} />
                <div><b>{t("hks.room")} {x.room_code}</b><small>{t(`hkb.type.${x.task_type}` as PmsKey)} · {t(`hkb.st.${x.status}` as PmsKey)}</small></div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/pms/housekeeping" className="tvrWMore">{t("dt.all")} →</Link>
    </div>
  );
}
