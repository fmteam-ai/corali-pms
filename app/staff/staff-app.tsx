"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LangToggle } from "@/app/pms/lang-toggle";
import type { HkMessage } from "@/lib/hk-mobile";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { allAlertKinds, deskAlertKinds, type AlertKind } from "@/lib/staff-core";
import type { Shift } from "@/lib/staff";
import { MaintenanceSection, ReceptionSection } from "./desk-sections";
import { HousekeepingSection } from "./housekeeping-section";
import { VoiceCommand } from "./voice-command";

type Tab = "housekeeping" | "reception" | "maintenance" | "messages" | "shifts" | "settings";
type Me = {
  id: number; name: string; role: string; desk: boolean; specialties: { id: number; name: string; color: string }[];
  sections: { housekeeping: boolean; reception: boolean; maintenance: boolean }; defaultKinds: AlertKind[];
  can: { checkInOut: boolean; housekeepingWrite: boolean; resolve: boolean; folioWrite?: boolean };
};
type Base = { today: string; me: Me; shifts: Shift[]; team: Shift[] };
type Install = { prompt: () => Promise<void> };

const tabs: { key: Tab; icon: string; label: PmsKey }[] = [
  { key: "housekeeping", icon: "🧹", label: "stf.tab.housekeeping" },
  { key: "reception", icon: "🛎️", label: "stf.tab.reception" },
  { key: "maintenance", icon: "🔧", label: "stf.tab.maintenance" },
  { key: "messages", icon: "💬", label: "hkm.messages" },
  { key: "shifts", icon: "📅", label: "stf.tab.shifts" },
  { key: "settings", icon: "⚙️", label: "stf.tab.settings" },
];

const b64ToBytes = (b64: string) => { const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

/** Corali Staff: the hotel's phone app for every employee (sections follow role and teams). */
export function StaffApp({ lang, initialTab }: { lang: PmsLang; initialTab: string | null }) {
  const t = useMemo(() => pmsT(lang), [lang]);
  const router = useRouter();
  const [base, setBase] = useState<Base | null>(null);
  const [tab, setTab] = useState<Tab | null>(tabs.some((x) => x.key === initialTab) ? (initialTab as Tab) : null);
  const [messages, setMessages] = useState<HkMessage[]>([]);
  const [compose, setCompose] = useState<{ room: { id: number; code: string } | null } | null>(null);
  const [text, setText] = useState("");
  const [toastText, setToastText] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [offline, setOffline] = useState(false);
  const [push, setPush] = useState<{ supported: boolean; endpoint: string | null; kinds: AlertKind[]; permission: string }>({ supported: false, endpoint: null, kinds: [], permission: "default" });
  const [install, setInstall] = useState<Install | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const pushOn = Boolean(push.endpoint);

  const toast = useCallback((line: string) => { setToastText(line); setTimeout(() => setToastText((x) => (x === line ? "" : x)), 6_000); }, []);
  // While the app is open: a toast, and (if phone alerts are off) a sound and vibration.
  const ring = useCallback((line: string) => {
    toast(line);
    if (pushOn) return;
    try { navigator.vibrate?.([250, 120, 250]); } catch { /* not supported */ }
    void new Audio("/sounds/pms-request.wav").play().catch(() => {});
  }, [pushOn, toast]);

  const loadBase = useCallback(async () => {
    try {
      const r = await fetch("/api/pms/staff-app", { cache: "no-store" });
      if (r.status === 401) { router.replace("/login"); return; }
      const d = await r.json();
      if (d.ok) { setBase(d); setOffline(false); }
    } catch { setOffline(true); }
  }, [router]);
  const loadMessages = useCallback(async () => {
    try {
      const d = await (await fetch("/api/pms/staff-messages", { cache: "no-store" })).json();
      if (!d.ok) return;
      setMessages(d.messages);
      const fresh = (d.messages as HkMessage[]).filter((m) => m.fromId !== d.me && !(seen.current?.has(m.id) ?? true));
      if (seen.current && fresh.length) ring(t("hkm.alertMessages", { n: fresh.length }));
      seen.current = new Set((d.messages as HkMessage[]).map((m) => m.id));
    } catch { /* offline */ }
  }, [ring, t]);

  useEffect(() => {
    queueMicrotask(() => { void loadBase(); void loadMessages(); });
    const a = setInterval(() => void loadBase(), 60_000), b = setInterval(() => void loadMessages(), 20_000);
    const wake = () => { if (!document.hidden) { void loadBase(); void loadMessages(); setRefreshKey((k) => k + 1); } };
    document.addEventListener("visibilitychange", wake);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener("visibilitychange", wake); };
  }, [loadBase, loadMessages]);

  // Service worker: phone alerts, and "open this" from a tapped alert.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "corali-refresh") { void loadMessages(); setRefreshKey((k) => k + 1); }
      if (e.data?.type === "corali-open") { const next = new URL(e.data.url).searchParams.get("tab"); if (next) setTab(next as Tab); setRefreshKey((k) => k + 1); }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    void (async () => {
      const supported = "PushManager" in window && "Notification" in window;
      try {
        const reg = await navigator.serviceWorker.register("/staff-sw.js", { scope: "/" });
        const sub = supported ? await reg.pushManager.getSubscription() : null;
        let kinds: AlertKind[] = [];
        if (sub) { const d = await (await fetch(`/api/pms/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" })).json(); kinds = d.kinds ?? []; if (!d.subscribed) { await sub.unsubscribe(); } else setPush({ supported, endpoint: sub.endpoint, kinds, permission: Notification.permission }); }
        if (!sub) setPush((p) => ({ ...p, supported, permission: supported ? Notification.permission : "unsupported" }));
      } catch { setPush((p) => ({ ...p, supported: false })); }
    })();
    const onInstall = (e: Event) => { e.preventDefault(); setInstall(e as unknown as Install); };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => { navigator.serviceWorker.removeEventListener("message", onMessage); window.removeEventListener("beforeinstallprompt", onInstall); };
  }, [loadMessages]);

  const me = base?.me;
  const available = tabs.filter((x) => (x.key === "housekeeping" || x.key === "reception" || x.key === "maintenance" ? Boolean(me?.sections[x.key]) : true));
  const current: Tab = tab && available.some((x) => x.key === tab) ? tab : available[0]?.key ?? "messages";
  const inbound = (m: HkMessage) => m.fromId !== me?.id && m.direction === (me?.desk ? "to_reception" : "to_hk");
  const unread = messages.filter((m) => inbound(m) && !m.read).length;

  useEffect(() => {
    if (current !== "messages" || !unread) return;
    void fetch("/api/pms/staff-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read" }) }).then((r) => r.json()).then((d) => d.ok && setMessages(d.messages)).catch(() => {});
  }, [current, unread]);

  async function send() {
    if (!compose || !text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/pms/staff-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", body: text.trim(), roomId: compose.room?.id ?? null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(t("hkm.sendFailed")); return; }
      setMessages(d.messages);
      seen.current = new Set((d.messages as HkMessage[]).map((m) => m.id));
      setText(""); setCompose(null); toast(t("hkm.sent"));
    } finally { setBusy(false); }
  }

  async function enablePush() {
    if (!me) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPush((p) => ({ ...p, permission })); toast(t("stf.pushDenied")); return; }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/pms/push", { cache: "no-store" })).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const kinds = me.defaultKinds;
      const r = await fetch("/api/pms/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: { endpoint: json.endpoint, keys: json.keys }, kinds, lang }) });
      if (!r.ok) { await sub.unsubscribe(); toast(t("stf.pushFailed")); return; }
      setPush({ supported: true, endpoint: json.endpoint, kinds, permission });
      toast(t("stf.pushOn"));
    } catch { toast(t("stf.pushFailed")); } finally { setBusy(false); }
  }
  async function disablePush() {
    if (!push.endpoint) return;
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe().catch(() => false);
    await fetch("/api/pms/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: push.endpoint }) }).catch(() => {});
    setPush((p) => ({ ...p, endpoint: null, kinds: [] }));
  }
  async function toggleKind(k: AlertKind) {
    if (!push.endpoint) return;
    const kinds = push.kinds.includes(k) ? push.kinds.filter((x) => x !== k) : [...push.kinds, k];
    setPush((p) => ({ ...p, kinds }));
    await fetch("/api/pms/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kinds", endpoint: push.endpoint, kinds, lang }) }).catch(() => {});
  }
  async function testPush() {
    const r = await fetch("/api/pms/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) });
    toast(r.ok ? t("stf.testSent") : t("stf.pushFailed"));
  }

  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const time = (ms: number) => new Date(ms).toLocaleString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
  const teamColor = (id: number | null) => base?.me.specialties.find((s) => s.id === id)?.color ?? "#2a7d8f";
  const ios = typeof navigator !== "undefined" && /iphone|ipad/i.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const kindsShown = allAlertKinds.filter((k) => me?.desk || !(deskAlertKinds as readonly string[]).includes(k));

  return (
    <main className="hkApp stApp" lang={lang}>
      <header className="hkTop">
        <div><b>{t("hkm.hello", { name: (me?.name ?? "").split(" ")[0] })}</b><small>{base ? day(base.today) : ""}</small>
          {me && me.specialties.length > 0 && <span className="stTeams">{me.specialties.map((s) => <i key={s.id} style={{ background: s.color }}>{s.name}</i>)}</span>}</div>
        <span className="hkTopTools"><LangToggle lang={lang} label={t("app.language")} /><button type="button" className={`stGear${current === "settings" ? " on" : ""}`} aria-label={t("stf.tab.settings")} onClick={() => setTab("settings")}>⚙️</button></span>
      </header>
      {offline && <p className="hkOffline">{t("hkm.offline")}</p>}
      {base && !pushOn && current !== "settings" && <button type="button" className="hkAlertsBtn" onClick={() => setTab("settings")}>🔔 {t("stf.turnOnAlerts")}</button>}

      <section className="stBody">
        {!base ? <p className="hkEmpty">…</p>
          : current === "housekeeping" ? <HousekeepingSection lang={lang} t={t} me={base.me.id} canWrite={base.me.can.housekeepingWrite} isHousekeeper={base.me.role === "housekeeping"} refreshKey={refreshKey} ring={ring} toast={toast} writeTo={(room) => { setCompose({ room }); setText(""); }} />
          : current === "reception" ? <ReceptionSection lang={lang} t={t} can={base.me.can} refreshKey={refreshKey} toast={toast} />
          : current === "maintenance" ? <MaintenanceSection lang={lang} t={t} can={base.me.can} refreshKey={refreshKey} toast={toast} />
          : current === "messages" ? (
            <div className="hkMessages">
              {!base.me.desk && <button type="button" className="hkBig" onClick={() => { setCompose({ room: null }); setText(""); }}>✎ {t("hkm.toReception")}</button>}
              {base.me.desk && <p className="hkNote">{t("stf.deskMessagesHint")}</p>}
              {messages.length === 0 ? <p className="hkEmpty">{t("hkm.noMessages")}</p> : (
                <ul>{messages.map((m) => (
                  <li key={m.id} className={m.fromId === base.me.id ? "mine" : ""}>
                    <small>{m.fromId === base.me.id ? t("hkm.you") : m.from}{m.direction === "to_hk" ? ` → ${m.to ?? m.toSpecialty ?? t("hkm.everyone")}` : ""}{m.room ? ` · ${t("hkb.room", { code: m.room })}` : ""} · {time(m.createdAt)}</small>
                    <p>{m.body}</p>
                  </li>
                ))}</ul>
              )}
            </div>
          ) : current === "shifts" ? (
            <div className="stSections">
              <section className="stCard">
                <h2>📅 {t("stf.myShifts")}</h2>
                {base.shifts.length === 0 ? <p className="hkEmpty sm">{t("stf.noShifts")}</p> : (
                  <ul>{base.shifts.map((s) => (
                    <li key={s.id} className={`stShift${s.date === base.today ? " today" : ""}`} style={{ borderLeftColor: teamColor(s.specialtyId) }}>
                      <span><b>{day(s.date)}</b>{s.note && <small>{s.note}</small>}</span><strong>{s.start}–{s.end}</strong>
                    </li>
                  ))}</ul>
                )}
              </section>
              <section className="stCard">
                <h2>👥 {t("stf.todayTeam")}</h2>
                {base.team.length === 0 ? <p className="hkEmpty sm">{t("stf.noShifts")}</p> : <ul>{base.team.map((s) => <li key={s.id} className="stShift"><span><b>{s.userName}</b></span><strong>{s.start}–{s.end}</strong></li>)}</ul>}
              </section>
            </div>
          ) : (
            <div className="stSections">
              <section className="stCard">
                <h2>🔔 {t("stf.alerts")}</h2>
                {ios && !standalone ? <p className="hkNote">{t("stf.iosHint")}</p>
                  : !push.supported ? <p className="hkNote warn">{t("stf.pushUnsupported")}</p>
                  : pushOn ? (
                    <>
                      <p className="hkNote">✓ {t("stf.pushOn")}</p>
                      <ul className="hkChecklist">{kindsShown.map((k) => <li key={k}><label><input type="checkbox" checked={push.kinds.includes(k)} onChange={() => void toggleKind(k)} /> {t(`stf.kind.${k}` as PmsKey)}</label></li>)}</ul>
                      <div className="hkActions"><button type="button" onClick={() => void testPush()}>{t("stf.test")}</button><button type="button" className="danger" onClick={() => void disablePush()}>{t("stf.pushOff")}</button></div>
                    </>
                  ) : push.permission === "denied" ? <p className="hkNote warn">{t("stf.pushDenied")}</p>
                  : <button type="button" className="hkBig" disabled={busy} onClick={() => void enablePush()}>🔔 {t("stf.enablePush")}</button>}
              </section>
              {install && !standalone && <section className="stCard"><h2>📲 {t("stf.install")}</h2><p className="hkEmpty sm">{t("stf.installHint")}</p><button type="button" className="hkBig" onClick={() => void install.prompt().then(() => setInstall(null))}>{t("stf.installNow")}</button></section>}
              <section className="stCard">
                <h2>👤 {me?.name}</h2>
                <p className="hkEmpty sm">{t(`role.${me?.role}` as PmsKey)}</p>
                <div className="hkActions">
                  {me?.desk && <a className="stLink" href="/pms">{t("stf.openPms")}</a>}
                  <button type="button" onClick={async () => { await disablePush(); const r = await fetch("/api/auth/logout", { method: "POST" }); if (r.ok) { router.push("/login"); router.refresh(); } }}>{t("hkm.logout")}</button>
                </div>
              </section>
            </div>
          )}
      </section>

      <nav className="stNav" aria-label={t("app.mainMenu")}>
        {available.filter((x) => x.key !== "settings").map((x) => (
          <button key={x.key} type="button" aria-current={current === x.key ? "page" : undefined} onClick={() => setTab(x.key)}>
            <span aria-hidden>{x.icon}</span>{t(x.label)}{x.key === "messages" && unread > 0 && <i className="hkBadge">{unread}</i>}
          </button>
        ))}
      </nav>

      {compose && (
        <div className="hkSheet" role="dialog" aria-modal="true">
          <div className="hkSheetCard">
            <h2>💬 {t("hkm.toReception")}{compose.room ? ` · ${compose.room.code}` : ""}</h2>
            <div className="hkQuick">{(["hkm.q.ready", "hkm.q.needMore", "hkm.q.lost", "hkm.q.call"] as const).map((k) => <button type="button" key={k} onClick={() => setText(t(k))}>{t(k)}</button>)}</div>
            <textarea value={text} maxLength={500} autoFocus onChange={(e) => setText(e.target.value)} placeholder={t("hkm.write")} />
            <div className="hkActions">
              <button type="button" onClick={() => setCompose(null)}>{t("hkb.cancel")}</button>
              <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void send()}>{t("hkm.send")}</button>
            </div>
          </div>
        </div>
      )}
      {base && (base.me.sections.housekeeping || base.me.sections.maintenance) && <VoiceCommand lang={lang} t={t} toast={toast} onDone={() => setRefreshKey((k) => k + 1)} />}
      {toastText && <p className="hkToast" role="status">{toastText}</p>}
    </main>
  );
}
