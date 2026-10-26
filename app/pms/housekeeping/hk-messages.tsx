"use client";
import { useCallback, useEffect, useState } from "react";
import type { HkMessage } from "@/lib/hk-mobile";
import { pmsT, type PmsLang } from "@/lib/pms-i18n";

/** Reception ↔ housekeeping messages (the housekeepers answer from their phone page, /hk). */
export function HkMessages({ lang, me, staff, rooms }: { lang: PmsLang; me: number; staff: { id: number; name: string }[]; rooms: { id: number; code: string }[] }) {
  const t = pmsT(lang);
  const [messages, setMessages] = useState<HkMessage[]>([]);
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [room, setRoom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const post = useCallback(async (payload: object) => {
    const r = await fetch("/api/pms/hk-mobile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) setMessages(d.messages);
    return r.ok;
  }, []);
  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/pms/hk-mobile", { cache: "no-store" })).json();
      if (!d.ok) return;
      setMessages(d.messages);
      // Opening the page counts as reading what the housekeepers wrote.
      if (d.messages.some((m: HkMessage) => m.direction === "to_reception" && !m.read)) void post({ action: "read" });
    } catch { /* keep the last list */ }
  }, [post]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      if (await post({ action: "message", body: body.trim(), roomId: room ? Number(room) : null, toStaffId: to ? Number(to) : null })) { setBody(""); setMsg(t("hkm.sent")); }
      else setMsg(t("hkm.sendFailed"));
    } finally { setBusy(false); }
  }
  const time = (ms: number) => new Date(ms).toLocaleString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

  return (
    <section className="card hkMsgPanel" id="hk-messages">
      <div className="hksHead"><h2>💬 {t("hkm.panelTitle")}</h2><a className="secondaryLink" href="/hk" target="_blank" rel="noreferrer">📱 {t("hkm.openPhone")}</a></div>
      <p className="muted">{t("hkm.panelHelp")} <a href="/hk" target="_blank" rel="noreferrer"><code>/hk</code></a></p>
      <div className="hkMsgForm">
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("hkm.toHousekeeping")}><option value="">{t("hkm.everyone")}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label={t("hkb.rooms")}><option value="">{t("hkm.noRoom")}</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select>
        <input value={body} maxLength={500} placeholder={t("hkm.write")} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && body.trim() && !busy) void send(); }} />
        <button type="button" disabled={busy || !body.trim()} onClick={() => void send()}>{t("hkm.send")}</button>
      </div>
      <p className="notice" role="status">{msg}</p>
      {messages.length === 0 ? <p className="muted">{t("hkm.noMessages")}</p> : (
        <ul className="hkMsgList">
          {messages.map((m) => (
            <li key={m.id} className={`${m.direction}${m.direction === "to_reception" && !m.read ? " unread" : ""}`}>
              <small>{m.fromId === me ? t("hkm.you") : m.from}{m.direction === "to_hk" ? ` → ${m.to ?? t("hkm.everyone")}` : ""}{m.room ? ` · ${t("hkb.room", { code: m.room })}` : ""} · {time(m.createdAt)}</small>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
