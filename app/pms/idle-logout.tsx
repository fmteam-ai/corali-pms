"use client";
import { useEffect } from "react";

/**
 * A PMS left open with nobody at the computer signs itself out after 2 hours without mouse, keyboard or touch (the
 * background refreshes of the page keep the server session alive, so the browser decides). Any tab counts.
 */
export function IdleLogout({ minutes = 120 }: { minutes?: number }) {
  useEffect(() => {
    const key = "corali.pms.lastActivity", limit = minutes * 60_000;
    const mark = () => { try { localStorage.setItem(key, String(Date.now())); } catch { /* private mode */ } };
    const last = () => { try { return Number(localStorage.getItem(key)) || Date.now(); } catch { return Date.now(); } };
    mark();
    let lastMark = Date.now();
    const onActivity = () => { if (Date.now() - lastMark > 15_000) { lastMark = Date.now(); mark(); } };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = setInterval(async () => {
      if (Date.now() - last() < limit) return;
      clearInterval(timer);
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "idle" }) }).catch(() => {});
      location.href = "/login?idle=1";
    }, 30_000);
    return () => { clearInterval(timer); events.forEach((e) => window.removeEventListener(e, onActivity)); };
  }, [minutes]);
  return null;
}
