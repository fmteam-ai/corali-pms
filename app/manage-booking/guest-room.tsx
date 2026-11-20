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
  const load = useCallback(async () => {
    const d = await fetch(`/api/public/guest-room?token=${encodeURIComponent(token)}&lang=${lang}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (d?.ok) setData(d);
  }, [token, lang]);
  useEffect(() => { queueMicrotask(() => void load()); const id = setInterval(() => void load(), 60_000); return () => clearInterval(id); }, [load]);
  if (!data || !data.inHouse) return null;
  const t = data.texts;
  async function send(kind: "cleaning" | "dnd", on?: boolean) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/public/guest-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, lang, kind, on }) });
      const d = await r.json().catch(() => ({}));
      if (d.texts) setData(d);
      setMsg(r.ok ? "" : d.error === "DND_ON" ? t.cleanBlocked : t.failed);
    } finally { setBusy(false); }
  }
  const time = (ms: number) => new Date(ms).toLocaleTimeString(bookingLocale[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  return (
    <section className="gOrders gRoom" aria-label={t.title}>
      <h3>{t.title}</h3>
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
