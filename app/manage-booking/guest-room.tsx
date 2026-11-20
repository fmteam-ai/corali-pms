"use client";
// v176: My booking → «Your room»: do not disturb and «please clean my room», shown while the guest is checked in.
import { useCallback, useEffect, useState } from "react";
import type { BookingLanguage } from "@/lib/booking-i18n";
import { bookingLocale } from "@/lib/booking-i18n";
import type { guestRoomState } from "@/lib/guest-room";

type Data = Awaited<ReturnType<typeof guestRoomState>>;

export function GuestRoom({ token, lang }: { token: string; lang: BookingLanguage }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [instay, setInstay] = useState<{ step: "ask" | "topics"; topics: string[] } | null>(null);
  const [thanks, setThanks] = useState("");
  const load = useCallback(async () => {
    const d = await fetch(`/api/public/guest-room?token=${encodeURIComponent(token)}&lang=${lang}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (d?.ok) setData(d);
  }, [token, lang]);
  useEffect(() => { queueMicrotask(() => void load()); const id = setInterval(() => void load(), 60_000); return () => clearInterval(id); }, [load]);
  if (!data || !data.inHouse) return null;
  const t = data.texts;
  async function send(kind: "cleaning" | "dnd" | "instay", on?: boolean, topics: string[] = []) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/public/guest-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, lang, kind, on, topics }) });
      const d = await r.json().catch(() => ({}));
      if (d.texts) setData(d);
      setMsg(r.ok ? "" : d.error === "DND_ON" ? t.cleanBlocked : t.failed);
    } finally { setBusy(false); }
  }
  const time = (ms: number) => new Date(ms).toLocaleTimeString(bookingLocale[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  return (
    <section className="gOrders gRoom" aria-label={t.title}>
      <h3>{t.title}</h3>
      {thanks && <p className="notice" role="status">{thanks}</p>}
      {data.instay && !thanks && (() => { const it = data.instay.texts, step = instay?.step ?? "ask"; return (
        <div className="gInstay">
          <b>{step === "ask" ? it.question : it.which}</b>
          {step === "ask" ? (
            <div className="gInstayActions">
              <button type="button" className="gOrderBtn" disabled={busy} onClick={() => void send("instay", true).then(() => setThanks(it.thanksGood))}>😊 {it.good}</button>
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => setInstay({ step: "topics", topics: [] })}>😕 {it.bad}</button>
            </div>
          ) : (
            <>
              <div className="gInstayTopics">{data.instay.topics.map((k) => { const on = instay?.topics.includes(k) ?? false; return <button type="button" key={k} className={on ? "on" : ""} aria-pressed={on} onClick={() => setInstay({ step: "topics", topics: on ? instay!.topics.filter((x) => x !== k) : [...(instay?.topics ?? []), k] })}>{it[k]}</button>; })}</div>
              <button type="button" className="gOrderBtn" disabled={busy} onClick={() => void send("instay", false, instay?.topics ?? []).then(() => setThanks(it.thanksBad))}>{it.send}</button>
            </>
          )}
        </div>
      ); })()}
      <p className="hint">{t.hint}</p>
      {data.dndAvailable && (
        <label className="gRoomDnd">
          <input type="checkbox" checked={data.dnd} disabled={busy} onChange={(e) => void send("dnd", e.target.checked)} />
          <span><b>🚫 {t.dnd}</b><small>{data.dnd ? t.dndOn : t.dndOff}</small></span>
        </label>
      )}
      {data.cleaningSince !== null
        ? <p className="notice" role="status">🧹 {t.cleanSent} · {time(data.cleaningSince)}</p>
        : <button type="button" className="gOrderBtn" disabled={busy || data.dnd} onClick={() => void send("cleaning")}>🧹 {t.clean}</button>}
      {data.dnd && data.cleaningSince === null && <small className="hint">{t.cleanBlocked}</small>}
      {msg && <p className="error" role="status">{msg}</p>}
    </section>
  );
}
