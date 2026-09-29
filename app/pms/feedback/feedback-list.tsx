"use client";
import Link from "next/link";
import { useState } from "react";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";

type Row = { id: number; booking_id: number; rating: number; route: string; comment: string | null; contact_ok: number; status: string; rated_at: number; public_clicked: string | null; resolved_at: number | null; resolution_notes: string | null; reference: string; guest_name: string; guest_email: string | null; guest_phone: string | null; resolver: string | null };
type Stats = { sent: number; rated: number; avg: number | null; public: number; private: number; clicked: number };

export function FeedbackList({ lang, rows: initial, stats, canResolve }: { lang: PmsLang; rows: Row[]; stats: Stats; canResolve: boolean }) {
  const t = pmsT(lang);
  const [rows, setRows] = useState(initial);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const time = (ms: number) => new Date(Number(ms)).toLocaleString(pmsLocale(lang), { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  async function resolve(id: number) {
    const r = await fetch(`/api/pms/feedback/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: notes[id] ?? "" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(t("fb.failed")); return; }
    setRows((list) => list.map((x) => (x.id === id ? { ...x, ...d.feedback } : x)));
    setMsg(t("fb.resolvedOk"));
  }
  return (
    <>
      <div className="kpiRow">
        <div><small>{t("fb.sent")}</small><b>{stats.sent}</b></div>
        <div><small>{t("fb.rated")}</small><b>{stats.rated}</b></div>
        <div><small>{t("fb.avg")}</small><b>{stats.avg ? `${stats.avg.toFixed(2)}★` : "—"}</b></div>
        <div><small>{t("fb.public")}</small><b>{stats.public}</b><small>{t("fb.clicked", { n: stats.clicked })}</small></div>
        <div><small>{t("fb.private")}</small><b>{stats.private}</b></div>
      </div>
      <p className="notice" role="status">{msg}</p>
      {rows.length === 0 && <p>{t("fb.none")}</p>}
      <div className="feedbackList">
        {rows.map((x) => (
          <article key={x.id} className={`feedbackCard ${x.route} ${x.status}`}>
            <header>
              <span className="stars" aria-label={`${x.rating}/5`}>{"★".repeat(x.rating)}<i>{"★".repeat(5 - x.rating)}</i></span>
              <span className={`noticeStatus ${x.status === "feedback" ? "open" : ""}`}>{t(x.status === "feedback" ? "fb.st.open" : x.status === "resolved" ? "fb.st.resolved" : "fb.st.public")}</span>
            </header>
            <b><Link href={`/pms/reservations/${x.booking_id}`}>{x.guest_name} · {x.reference}</Link></b>
            <small>{time(x.rated_at)}{x.route === "public" && x.public_clicked ? ` · ${t("fb.wentTo", { sites: x.public_clicked })}` : ""}</small>
            {x.comment && <p className="noticeText">{x.comment}</p>}
            {x.route === "private" && <small>{x.contact_ok ? t("fb.contactYes", { contact: [x.guest_email, x.guest_phone].filter(Boolean).join(" · ") }) : t("fb.contactNo")}</small>}
            {x.status === "resolved" && <div className="resolutionInfo"><small>{t("fb.resolvedBy", { name: x.resolver ?? "—", time: x.resolved_at ? time(x.resolved_at) : "—" })}</small><p>{x.resolution_notes}</p></div>}
            {x.status === "feedback" && canResolve && (
              <div className="resolveForm">
                <label>{t("fb.notes")}<textarea rows={3} maxLength={2000} value={notes[x.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [x.id]: e.target.value }))} /></label>
                <button type="button" disabled={(notes[x.id] ?? "").trim().length < 3} onClick={() => resolve(x.id)}>{t("fb.resolve")}</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
