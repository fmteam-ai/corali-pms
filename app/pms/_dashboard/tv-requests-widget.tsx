"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";
import type { TvRequestRow } from "@/lib/tv-requests";
import { tvRequestLabels } from "@/lib/tv-requests-core";

type Dnd = { roomId: number; roomCode: string; since: number };

/** Dashboard widget: requests from the room TVs waiting for staff and rooms with "Do not disturb" (live). */
export function TvRequestsWidget({ lang, canHandle }: { lang: PmsLang; canHandle: boolean }) {
  const t = pmsT(lang);
  const [requests, setRequests] = useState<TvRequestRow[] | null>(null);
  const [dnd, setDnd] = useState<Dnd[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/pms/tv-requests", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { setRequests(d.requests); setDnd(d.dnd); }
    } catch { /* keep the last list */ }
  }, []);
  // Refreshes every 30 s and at once when the notification bell sees something new.
  useEffect(() => {
    const first = window.setTimeout(load, 0), poll = window.setInterval(load, 30_000);
    window.addEventListener("corali:notifications", load);
    return () => { window.clearTimeout(first); window.clearInterval(poll); window.removeEventListener("corali:notifications", load); };
  }, [load]);

  async function done(id: number) {
    setBusy(true); setError(false);
    try {
      const r = await fetch("/api/pms/tv-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "done", id }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setRequests(d.requests); setDnd(d.dnd);
    } catch { setError(true); } finally { setBusy(false); }
  }

  const open = (requests ?? []).filter((r) => r.status === "open");
  const time = (ms: number) => new Date(ms).toLocaleTimeString(pmsLocale(lang), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  return (
    <div className="tvrWidget">
      {dnd.length > 0 && <p className="tvrWDnd">🚫 {t("tvr.dndRooms")}: {dnd.map((d) => <b key={d.roomId}>{d.roomCode}</b>)}</p>}
      {requests === null ? <p className="muted">…</p> : open.length === 0 ? <p className="muted">{t("tvr.none")}</p> : (
        <ul>
          {open.slice(0, 8).map((r) => { const l = tvRequestLabels[r.kind] ?? { icon: "📺", el: r.kind, en: r.kind }; return (
            <li key={r.id}>
              <span aria-hidden>{l.icon}</span>
              <div><b>{lang === "el" ? l.el : l.en}</b><small>{t("tvr.room")} {r.roomCode}{r.guestName ? ` · ${r.guestName}` : ""} · {time(r.createdAt)}</small></div>
              {canHandle && <button type="button" disabled={busy} title={t("tvr.done")} aria-label={t("tvr.done")} onClick={() => done(r.id)}>✓</button>}
            </li>
          ); })}
        </ul>
      )}
      {error && <p className="error">{t("tvr.error")}</p>}
      <Link href="/pms/tv-requests" className="tvrWMore">{t("tvr.openPage")} →</Link>
    </div>
  );
}
