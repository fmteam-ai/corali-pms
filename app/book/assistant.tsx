"use client";
import { useEffect, useRef, useState } from "react";
import { bookingText, type BookingLanguage } from "@/lib/booking-i18n";

type Turn = { role: "user" | "assistant"; content: string };

/** Floating chat on the booking page; `context` describes the guest's current search so answers can use real prices. */
export function BookingAssistant({ lang, context }: { lang: BookingLanguage; context: string }) {
  const t = bookingText[lang];
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, busy, open]);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = text.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: question.slice(0, 1500) }];
    setTurns(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/public/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang, messages: next, context }) });
      const d = await r.json().catch(() => ({}));
      setTurns([...next, { role: "assistant", content: r.ok && d.reply ? String(d.reply) : t.assistantError }]);
    } catch {
      setTurns([...next, { role: "assistant", content: t.assistantError }]);
    } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="assistantFab" onClick={() => setOpen(true)} aria-expanded="false">💬 {t.assistantOpen}</button>;
  return (
    <section className="assistantPanel" role="dialog" aria-label={t.assistantTitle}>
      <header><b>💬 {t.assistantTitle}</b><button type="button" aria-label={t.close} onClick={() => setOpen(false)}>×</button></header>
      <div className="assistantLog" aria-live="polite">
        <p className="assistantMsg assistant">{t.assistantIntro}</p>
        {turns.map((m, i) => <p key={i} className={`assistantMsg ${m.role}`}>{m.content}</p>)}
        {busy && <p className="assistantMsg assistant typing" aria-label="…"><span /><span /><span /></p>}
        <div ref={end} />
      </div>
      <form onSubmit={ask}>
        <input value={text} maxLength={1500} placeholder={t.assistantPlaceholder} aria-label={t.assistantPlaceholder} onChange={(e) => setText(e.target.value)} autoFocus />
        <button type="submit" disabled={busy || !text.trim()}>{t.assistantSend}</button>
      </form>
      <small>{t.assistantDisclaimer}</small>
    </section>
  );
}
