"use client";
import { useEffect, useState } from "react";
import { GUEST_APP_STORAGE, guestAppTexts, urlBase64ToUint8Array } from "@/lib/guest-app-core";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const standalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Remember the sign-in on this phone until check-out (used by the app; a browser tab keeps the short sign-in). */
async function remember(token: string, lang: string) {
  try {
    const r = await fetch("/api/public/guest-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remember", token }) });
    const d = await r.json();
    if (d.ok) localStorage.setItem(GUEST_APP_STORAGE, JSON.stringify({ token: d.token, expiresAt: d.expiresAt, lang }));
  } catch { /* storage or network off: the guest signs in again */ }
}

/** "My booking" as an app: add to the home screen, notifications from the hotel, refresh when one arrives. */
export function GuestApp({ token, lang, onRefresh }: { token: string; lang: string; onRefresh: () => void }) {
  const t = guestAppTexts[(lang in guestAppTexts ? lang : "en") as keyof typeof guestAppTexts];
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [app, setApp] = useState(false);
  const [push, setPush] = useState<"unsupported" | "off" | "on" | "blocked">("unsupported");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "corali-refresh") onRefresh(); };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    queueMicrotask(async () => {
      setApp(standalone());
      if (standalone()) void remember(token, lang);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
      try {
        const reg = await navigator.serviceWorker.register("/guest-sw.js");
        const sub = await reg.pushManager.getSubscription();
        setPush(Notification.permission === "denied" ? "blocked" : sub ? "on" : "off");
      } catch { setPush("unsupported"); }
    });
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); navigator.serviceWorker?.removeEventListener("message", onMsg); };
  }, [token, lang, onRefresh]);

  async function enable() {
    setBusy(true); setError("");
    try {
      if ((await Notification.requestPermission()) !== "granted") { setPush("blocked"); return; }
      const key = (await (await fetch(`/api/public/guest-app?token=${encodeURIComponent(token)}`, { cache: "no-store" })).json()).vapidPublicKey;
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(String(key)) as BufferSource }));
      const r = await fetch("/api/public/guest-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", token, lang, subscription: sub.toJSON() }) });
      if (!r.ok) throw Error("SUBSCRIBE");
      await remember(token, lang);
      setPush("on");
    } catch { setError(t.failed); } finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await fetch("/api/public/guest-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", token, endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setPush("off");
    } finally { setBusy(false); }
  }

  const iosBrowser = isIos() && !app;
  return (
    <section className="guestApp">
      <h2>{t.title}</h2>
      {app ? <p className="hint">{t.installed}</p> : <p className="hint">{t.intro}</p>}
      {!app && (installEvent
        ? <button type="button" className="secondaryButton" onClick={async () => { await installEvent.prompt(); setInstallEvent(null); }}>{t.install}</button>
        : iosBrowser ? <p className="hint">{t.iosHow}</p> : null)}
      {push === "on" ? <p className="guestAppOn">{t.notifyOn} <button type="button" className="linkButton" disabled={busy} onClick={disable}>{t.notifyOff}</button></p>
        : push === "off" ? <button type="button" className="primary" disabled={busy} onClick={enable}>{t.notify}</button>
        : push === "blocked" ? <p className="hint">{t.notifyBlocked}</p>
        : iosBrowser ? <p className="hint">{t.notifyIosFirst}</p> : null}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
