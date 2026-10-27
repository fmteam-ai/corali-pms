"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { FaCheck, FaKeyboard, FaMicrophone, FaRedo, FaTimes, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import type { TvScreenData } from "@/lib/tv";

type Texts = NonNullable<TvScreenData["assistant"]>["texts"];
type Message = { id: number; role: "user" | "assistant"; content: string; action: { id: number; summary: string; status: string } | null };
/** Voice bridge of the Corali TV Android app (1.5+). Absent in a plain browser or older app versions. */
type VoiceBridge = { available: () => boolean; listen: (locale: string) => boolean; speak: (text: string, locale: string) => void; stop: () => void };
const voiceBridge = (): VoiceBridge | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { CoraliTVVoice?: VoiceBridge }).CoraliTVVoice);
export type AssistantApi = { listen: () => void; back: () => boolean };

/** Assistant tab: ready questions, the remote's microphone (Corali TV app), typing, Confirm for proposals. */
export function TvAssistant({ token, lang, texts, speech, phoneQr, gridRef, apiRef, onActivity }: { token: string; lang: string; texts: Texts; speech: string; phoneQr: string; gridRef: RefObject<HTMLDivElement | null>; apiRef: Ref<AssistantApi>; onActivity: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [deciding, setDeciding] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bridge = voiceBridge();
  const canListen = (() => { try { return Boolean(bridge?.available()); } catch { return false; } })();
  const url = `/api/public/tv/${encodeURIComponent(token)}/assistant`;

  useEffect(() => {
    try { setVoiceOn(localStorage.getItem("corali-tv-voice") !== "off"); } catch { /* storage off: voice on */ }
    void fetch(`${url}?lang=${encodeURIComponent(lang)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d?.ok && d.available) setMessages(d.messages); }).catch(() => {});
    return () => { try { voiceBridge()?.stop(); } catch { /* app gone */ } };
  }, [url, lang]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const say = (text: string) => { if (!voiceOn || !bridge) return; try { bridge.speak(text, speech); } catch { /* no voice output */ } };
  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    onActivity();
    setNote(""); setBusy(true); setTyping(false); setDraft("");
    setMessages((m) => [...m, { id: -Date.now(), role: "user", content: q, action: null }]);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ask", question: q, lang }) });
      const d = await r.json();
      if (d.ok) { setMessages(d.messages); say(d.reply); }
      else { setMessages((m) => m.filter((x) => x.id >= 0)); setNote(d.error === "LIMIT" ? texts.limit : d.error === "NO_STAY" ? texts.noStay : texts.failed); }
    } catch {
      setMessages((m) => m.filter((x) => x.id >= 0)); setNote(texts.failed);
    } finally {
      setBusy(false); onActivity();
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(".tvAsConfirm, .tvAsMic")?.focus());
    }
  };
  const listen = () => {
    onActivity();
    if (!bridge || !canListen) { setNote(texts.noVoice); return; }
    try { bridge.stop(); } catch { /* nothing playing */ }
    setNote(""); setListening(true);
    try { if (!bridge.listen(speech)) { setListening(false); setNote(texts.noVoice); } } catch { setListening(false); setNote(texts.noVoice); }
  };
  const decide = async (id: number, confirm: boolean) => {
    if (deciding) return;
    setDeciding(id); onActivity();
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", id, confirm }) });
      const d = await r.json();
      setMessages((m) => m.map((x) => (x.action?.id === id ? { ...x, action: { ...x.action, status: d.status || "failed" } } : x)));
      if (confirm) say(d.ok ? texts.done : texts.failed);
    } catch { setNote(texts.failed); } finally { setDeciding(null); }
  };
  const clear = async () => {
    onActivity();
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear" }) }).catch(() => {});
    setMessages([]); setNote("");
  };

  // The Android app hands the recognised words back here (null: nothing heard or cancelled).
  useEffect(() => {
    (window as unknown as { coraliVoiceResult?: (t: string | null) => void }).coraliVoiceResult = (text) => { setListening(false); if (text) void ask(text); };
  });
  useImperativeHandle(apiRef, () => ({
    listen,
    back: () => { if (typing) { setTyping(false); inputRef.current?.blur(); return true; } try { bridge?.stop(); } catch { /* nothing playing */ } return false; },
  }));

  const pending = [...messages].reverse().find((m) => m.action?.status === "pending")?.action ?? null;
  return (
    <section className="tvInfo tvAs">
      <div className="tvAsMain">
        <div className="tvAsLog" ref={logRef} aria-live="polite">
          {!messages.length && <p className="tvAsIntro">{texts.intro}</p>}
          {messages.map((m) => (
            <div key={m.id} className={`tvAsMsg ${m.role}`}>
              <p>{m.content}</p>
              {m.action && m.action.status !== "pending" && <small className={`tvAsAction st-${m.action.status}`}>{m.action.summary} · {m.action.status === "done" ? texts.done : m.action.status === "declined" ? "—" : texts.failed}</small>}
            </div>
          ))}
          {busy && <div className="tvAsMsg assistant thinking"><p>{texts.thinking}</p></div>}
          {listening && <div className="tvAsMsg user listening"><p><FaMicrophone aria-hidden /> {texts.listening}</p></div>}
        </div>
        {note && <p className="tvAsNote">{note}</p>}
        <div className="tvAsControls" ref={gridRef}>
          {pending && (
            <div className="tvAsPending">
              <b>{pending.summary}</b>
              <button type="button" className="tvAsConfirm" disabled={deciding !== null} onClick={() => decide(pending.id, true)}><FaCheck aria-hidden /> {texts.confirm}</button>
              <button type="button" disabled={deciding !== null} onClick={() => decide(pending.id, false)}><FaTimes aria-hidden /> {texts.cancel}</button>
            </div>
          )}
          <div className="tvAsRow">
            <button type="button" className="tvAsMic" disabled={busy || listening} onClick={listen}><FaMicrophone aria-hidden /> {texts.speak}</button>
            {typing ? (
              <form className="tvAsType" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
                <input ref={inputRef} autoFocus value={draft} maxLength={500} placeholder={texts.ask} onChange={(e) => setDraft(e.target.value)} />
                <button type="submit" disabled={busy || !draft.trim()}>{texts.send}</button>
              </form>
            ) : <button type="button" disabled={busy} onClick={() => { setTyping(true); onActivity(); }}><FaKeyboard aria-hidden /> {texts.type}</button>}
            <button type="button" aria-pressed={voiceOn} onClick={() => { const v = !voiceOn; setVoiceOn(v); try { localStorage.setItem("corali-tv-voice", v ? "on" : "off"); if (!v) bridge?.stop(); } catch { /* storage off */ } }}>{voiceOn ? <FaVolumeUp aria-hidden /> : <FaVolumeMute aria-hidden />}</button>
            {messages.length > 0 && <button type="button" disabled={busy} onClick={clear}><FaRedo aria-hidden /> {texts.clear}</button>}
          </div>
          <div className="tvAsChips">
            {texts.suggestions.map((s) => <button type="button" key={s} disabled={busy} onClick={() => ask(s)}>{s}</button>)}
          </div>
        </div>
      </div>
      <figure className="tvQr tvAsPhone"><img src={phoneQr} alt="" /><figcaption>{texts.phone}</figcaption></figure>
    </section>
  );
}
