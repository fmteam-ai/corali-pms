"use client";
import { useEffect, useMemo, useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Message = { id: number; booking_id: number; sender: string; body: string; created_at: number; ai_generated?: number; reference: string; guest_name: string; guest_email: string };

export function MessagesManager({ lang, initial, initialBooking, canManageAi }: { lang: PmsLang; initial: Message[]; initialBooking?: number | null; canManageAi: boolean }) {
  const t = pmsT(lang);
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<number | null>(initialBooking && initial.some((m) => m.booking_id === initialBooking) ? initialBooking : initial[0]?.booking_id ?? null);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{ aiAutoReply: boolean; aiConfigured: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/pms/messages/settings").then((r) => r.json()).then((d) => { if (live && d.ok) setAi({ aiAutoReply: d.aiAutoReply, aiConfigured: d.aiConfigured }); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const threads = useMemo(() => Array.from(new Map(rows.map((x) => [x.booking_id, x])).values()), [rows]);
  const messages = rows.filter((x) => x.booking_id === selected).sort((a, b) => Number(a.created_at) - Number(b.created_at));
  const lastFromGuest = messages.at(-1)?.sender === "guest";

  async function send() {
    if (!selected || !draft.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/pms/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: selected, body: draft }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { const base = rows.find((x) => x.booking_id === selected)!; setRows((v) => [...v, { ...base, ...d.message }]); setDraft(""); setStatus(t("msg.sent")); } else setStatus(t("msg.failed"));
    } finally { setBusy(false); }
  }
  async function suggest() {
    if (!selected) return;
    setBusy(true); setStatus(t("msg.aiWorking"));
    try {
      const r = await fetch("/api/pms/messages/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: selected }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setDraft(d.reply); setStatus(t("msg.aiReady")); } else setStatus(t(`msg.ai.${d.error === "AI_NOT_CONFIGURED" || d.error === "TOO_MANY_REQUESTS" ? d.error : "AI_UNAVAILABLE"}` as PmsKey));
    } catch { setStatus(t("msg.ai.AI_UNAVAILABLE")); } finally { setBusy(false); }
  }
  async function toggleAuto(on: boolean) {
    const r = await fetch("/api/pms/messages/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiAutoReply: on }) });
    if (r.ok) setAi((a) => (a ? { ...a, aiAutoReply: on } : a)); else setStatus(t("msg.failed"));
  }

  return (
    <>
      {ai && (
        <div className="aiAutoBar">
          <label className="inline"><input type="checkbox" checked={ai.aiAutoReply} disabled={!canManageAi || !ai.aiConfigured} onChange={(e) => toggleAuto(e.target.checked)} /> <b>🤖 {t("msg.aiAuto")}</b></label>
          <small>{ai.aiConfigured ? t("msg.aiAutoHelp") : t("msg.ai.AI_NOT_CONFIGURED")}</small>
        </div>
      )}
      <div className="messagesGrid">
        <aside>{threads.map((th) => <button className={selected === th.booking_id ? "active" : ""} onClick={() => { setSelected(th.booking_id); setDraft(""); setStatus(""); }} key={th.booking_id}><b>{th.guest_name}</b><small>{th.reference}</small></button>)}</aside>
        <article>
          <div className="thread">{messages.map((m) => <div className={`bubble ${m.sender}`} key={m.id}><b>{m.sender === "guest" ? t("msg.guest") : "Hotel Corali"}{Number(m.ai_generated) === 1 && <span className="aiTag">🤖 {t("msg.aiTag")}</span>}</b><p>{m.body}</p><small>{new Date(Number(m.created_at)).toLocaleString(pmsLocale(lang))}</small></div>)}</div>
          {selected && (
            <div className="messageComposer">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} required maxLength={4000} placeholder={t("msg.placeholder")} />
              <div className="composerActions">
                <button type="button" className="secondaryButton" disabled={busy || !lastFromGuest} title={lastFromGuest ? undefined : t("msg.aiNoQuestion")} onClick={suggest}>✨ {t("msg.aiSuggest")}</button>
                <button type="button" disabled={busy || !draft.trim()} onClick={send}>{t("msg.send")}</button>
              </div>
            </div>
          )}
          <p className="notice" role="status">{status}</p>
        </article>
      </div>
    </>
  );
}
