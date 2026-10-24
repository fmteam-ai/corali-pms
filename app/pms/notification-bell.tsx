"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuBell } from "react-icons/lu";
import { pmsT, type PmsLang } from "@/lib/pms-i18n";

type Notification = { key: string; kind: string; title: string; link: string; created_at: number };
const kindIcons: Record<string, string> = { message: "✉", guest_message: "✉", tv_request: "📺", arrival: "🛎", direct_booking: "★", manual_booking: "✎", ota_change: "⇄", housekeeping: "🧹", payment: "€", system: "ⓘ" };

export function NotificationBell({ lang }: { lang: PmsLang }) {
  const t = pmsT(lang);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [live, setLive] = useState(false);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const seen = useRef<Set<string> | null>(null);

  // A notification that arrives while the PMS is open pops up for 5 seconds (bottom right), then stays in the bell.
  const load = useCallback(async () => {
    const r = await fetch("/api/pms/dashboard", { cache: "no-store" });
    if (!r.ok) return;
    const list: Notification[] = (await r.json()).notifications ?? [];
    setItems(list);
    const known = seen.current;
    seen.current = new Set([...(known ?? []), ...list.map((x) => x.key)]);
    if (!known) return;
    const fresh = list.filter((x) => !known.has(x.key)).slice(0, 3);
    if (!fresh.length) return;
    window.dispatchEvent(new Event("corali:notifications"));
    // A request from a room TV also plays a chime (once the browser allows sound, i.e. after any click in the PMS).
    if (fresh.some((x) => x.kind === "tv_request")) {
      const audio = new Audio("/sounds/pms-request.wav");
      audio.volume = 0.8;
      void audio.play().catch(() => { /* sound blocked until the page has been clicked */ });
    }
    setToasts((v) => [...fresh, ...v].slice(0, 4));
    for (const x of fresh) window.setTimeout(() => setToasts((v) => v.filter((y) => y.key !== x.key)), 5_000);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(load, 0);
    let poll: number | undefined;
    let failures = 0;
    let source: EventSource | undefined;
    const startPolling = () => { if (poll === undefined) poll = window.setInterval(load, 60_000); };
    if (typeof EventSource === "undefined") startPolling();
    else {
      source = new EventSource("/api/pms/notifications/stream");
      source.addEventListener("changed", () => { failures = 0; setLive(true); void load(); });
      source.onopen = () => setLive(true);
      source.onerror = () => {
        failures += 1;
        setLive(false);
        if (failures >= 3 || source?.readyState === EventSource.CLOSED) { source?.close(); startPolling(); }
      };
    }
    return () => { window.clearTimeout(first); if (poll !== undefined) window.clearInterval(poll); source?.close(); };
  }, [load]);

  async function post(body: object) {
    return fetch("/api/pms/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  async function mark(key: string) {
    if ((await post({ action: "read_notification", key })).ok) setItems((v) => v.filter((x) => x.key !== key));
  }
  async function markAll() {
    if ((await post({ action: "read_all" })).ok) setItems([]);
  }

  return (
    <div className="bell">
      {toasts.length > 0 && (
        <div className="pmsToasts" role="status" aria-live="polite">
          {toasts.map((x) => (
            <div key={x.key} className={`pmsToast kind-${x.kind}`}>
              <span className="bellIcon" aria-hidden="true">{kindIcons[x.kind] ?? "•"}</span>
              <Link href={x.link} onClick={() => setToasts((v) => v.filter((y) => y.key !== x.key))}>{x.title}</Link>
              <button type="button" aria-label={t("bell.toastClose")} onClick={() => setToasts((v) => v.filter((y) => y.key !== x.key))}>×</button>
            </div>
          ))}
        </div>
      )}
      <button type="button" aria-label={`${t("bell.title")} (${items.length})`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <LuBell aria-hidden />{items.length > 0 && <span>{items.length > 99 ? "99+" : items.length}</span>}
        <i className={`liveDot${live ? " on" : ""}`} title={live ? t("bell.live") : t("bell.polling")} />
      </button>
      {open && (
        <div className="bellPanel">
          <div className="bellHead">
            <strong>{t("bell.title")}</strong>
            {items.length > 0 && <button type="button" onClick={markAll}>{t("bell.markAll")}</button>}
          </div>
          {items.length === 0 ? <p>{t("bell.empty")}</p> : items.map((item) => (
            <div key={item.key}>
              <span className="bellIcon" aria-hidden="true">{kindIcons[item.kind] ?? "•"}</span>
              <Link href={item.link} onClick={() => setOpen(false)}>
                {item.title}
                <small>{new Date(item.created_at).toLocaleString(lang === "en" ? "en-GB" : "el-GR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
              </Link>
              <button type="button" aria-label={t("bell.markRead")} title={t("bell.markRead")} onClick={() => mark(item.key)}>✓</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
