"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { FaRobot, FaBan, FaBath, FaBed, FaTv, FaThLarge, FaBirthdayCake, FaCheck, FaGlassCheers, FaPhoneAlt, FaPumpSoap, FaTaxi, FaTools, FaHeart, FaLayerGroup, FaBroom, FaConciergeBell, FaEuroSign, FaExclamation, FaHome, FaMapMarkedAlt, FaRegCalendarCheck, FaRegClock, FaRegEnvelope, FaRegLightbulb, FaSuitcaseRolling, FaWhatsapp, FaWifi } from "react-icons/fa";
import { WiCloud, WiCloudy, WiDayCloudy, WiDaySunny, WiFog, WiRain, WiShowers, WiSnow, WiThunderstorm } from "react-icons/wi";
import type { TvScreenData } from "@/lib/tv";
import { messageSound } from "@/lib/tv-messages-core";
import { tvProblems, tvRequestKinds, tvRequestLabels, type TvRequestKind } from "@/lib/tv-requests-core";
import { TvAssistant, type AssistantApi } from "./tv-assistant";
import "./tv.css";

const locales = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" } as const;
const REFRESH_MS = 60_000;
const HOME_AFTER_MS = 90_000;

// Line icons for the standard information tabs; tabs the hotel adds keep their own emoji.
const tabIcons: Record<string, IconType> = { home: FaHome, checkin: FaRegClock, rates: FaEuroSign, housekeeping: FaBroom, wifi: FaWifi, reception: FaConciergeBell, important: FaExclamation, checkout: FaSuitcaseRolling };
const TabIcon = ({ k, emoji }: { k: string; emoji?: string }) => { const I = tabIcons[k]; return I ? <I aria-hidden /> : <span className="tvEmoji" aria-hidden>{emoji}</span>; };

/** WMO weather code (Open-Meteo) → weather icon. */
function WeatherIcon({ code }: { code: number }) {
  const I = code === 0 ? WiDaySunny : code <= 2 ? WiDayCloudy : code === 3 ? WiCloudy : code === 45 || code === 48 ? WiFog : code >= 51 && code <= 67 ? WiRain : code >= 71 && code <= 77 ? WiSnow : code >= 80 && code <= 82 ? WiShowers : code >= 95 ? WiThunderstorm : WiCloud;
  return <I aria-hidden />;
}

/** **bold** inside a line. */
const strong = (line: string): ReactNode[] => line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));

/** Info text: one paragraph per line, consecutive "- " lines become one list. */
function InfoBody({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => { if (bullets.length) { blocks.push(<ul key={`u${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{strong(b)}</li>)}</ul>); bullets = []; } };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("- ")) bullets.push(line.slice(2));
    else { flush(); blocks.push(<p key={`p${blocks.length}`}>{strong(line)}</p>); }
  }
  flush();
  return <>{blocks}</>;
}

// Reception message looks: icon and festive decoration per theme (PMS → TV messages).
const msgIcons = { standard: FaRegEnvelope, birthday: FaBirthdayCake, anniversary: FaHeart, celebration: FaGlassCheers } as const;
const Confetti = () => <div className="tvMsgDeco" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>;
const Hearts = () => <div className="tvMsgDeco hearts" aria-hidden>{Array.from({ length: 10 }, (_, i) => <FaHeart key={i} />)}</div>;

// Requests to reception (Requests tab).
const reqIcons: Record<TvRequestKind, IconType> = { cleaning: FaBroom, towels: FaBath, toiletries: FaPumpSoap, call_me: FaPhoneAlt, problem: FaTools, pillows: FaBed, blankets: FaLayerGroup, taxi: FaTaxi };
type ReqState = "sending" | "sent" | "already" | "failed";
type Transfer = { destination: "port" | "airport" | "other"; day: number; time: string; people: number };
/** Bridge of the Corali TV Android app (1.4+): which packages are installed, and open one. Absent in a plain browser. */
type AppBridge = { installed: (json: string) => string; open: (pkg: string) => boolean };
const appBridge = (): AppBridge | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { CoraliTVApp?: AppBridge }).CoraliTVApp);
const shiftTime = (t: string, mins: number) => { const v = (Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + mins + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };

const CardHead = ({ icon: I, title }: { icon: IconType; title: string }) => <div className="tvCardHead"><span className="tvIcon"><I aria-hidden /></span><h2>{title}</h2></div>;

type Channel = TvScreenData["channels"][number];
/** Full-screen live channel: YouTube live in an iframe (never focused, so the remote keys stay with the screen), HLS through hls.js, or a plain video. */
function ChannelPlayer({ channel, texts, onClose }: { channel: Channel; texts: TvScreenData["channelTexts"]; onClose: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  // The bar with the channel name and the remote keys shows for 6 s on start and again after every key press.
  const [label, setLabel] = useState(true);
  useEffect(() => {
    let t = setTimeout(() => setLabel(false), 6_000);
    const show = () => { setLabel(true); clearTimeout(t); t = setTimeout(() => setLabel(false), 6_000); };
    window.addEventListener("keydown", show);
    window.addEventListener("pointermove", show);
    return () => { clearTimeout(t); window.removeEventListener("keydown", show); window.removeEventListener("pointermove", show); };
  }, [channel]);
  useEffect(() => {
    const src = channel.source, el = video.current;
    if (src.kind === "youtube" || !el) return;
    let hls: { destroy: () => void } | null = null, live = true;
    const fail = () => live && setFailed(true);
    el.addEventListener("error", fail);
    if (src.kind === "hls" && !el.canPlayType("application/vnd.apple.mpegurl")) {
      void import("hls.js").then(({ default: Hls }) => {
        if (!live || !Hls.isSupported()) { fail(); return; }
        const h = new Hls({ lowLatencyMode: true });
        h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) fail(); });
        h.loadSource(src.url);
        h.attachMedia(el);
        hls = h;
      }).catch(fail);
    } else el.src = src.url;
    void el.play().catch(() => {});
    return () => { live = false; el.removeEventListener("error", fail); hls?.destroy(); el.removeAttribute("src"); el.load(); };
  }, [channel]);
  return (
    <div className="tvPlayer" role="dialog" aria-label={channel.name}>
      {channel.source.kind === "youtube"
        ? <iframe src={channel.source.embedUrl} title={channel.name} tabIndex={-1} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" />
        : <video ref={video} autoPlay playsInline />}
      {failed && <p className="tvPlayerError">{texts.failed}</p>}
      <div className={`tvPlayerBar${label || failed ? " show" : ""}`}><b>{channel.name}</b><span>{texts.hint}</span><button type="button" onClick={onClose}>{texts.back}</button></div>
    </div>
  );
}

export function TvScreen({ token, lang }: { token: string; lang: string }) {
  const [data, setData] = useState<TvScreenData | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [tab, setTab] = useState("home");
  const [closed, setClosed] = useState<number[]>([]);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const transferRef = useRef<HTMLDivElement | null>(null);
  const [reqState, setReqState] = useState<Partial<Record<TvRequestKind | "dnd", ReqState>>>({});
  const [dnd, setDnd] = useState<boolean | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [transferError, setTransferError] = useState("");
  const [playing, setPlaying] = useState<number | null>(null);
  const [problemOpen, setProblemOpen] = useState(false);
  const [appError, setAppError] = useState("");
  // My requests: the id waiting for a second OK to cancel, and a reload of the screen data after a change.
  const [cancelArm, setCancelArm] = useState<number | null>(null);
  const reloadData = useRef<() => void>(() => {});
  const assistantApi = useRef<AssistantApi | null>(null);

  // Any remote/keyboard/touch use keeps the chosen tab; after 90 s without it the screen goes back home. The channel
  // list stays (a guest returning from a channel expects the list, not the home screen).
  const choose = (key: string) => {
    setTab(key);
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    if (key !== "home" && key !== "channels") idle.current = setTimeout(() => setTab("home"), HOME_AFTER_MS);
  };
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);
  const message = data?.messages.find((m) => !closed.includes(m.id));
  // A new message plays its sound once (remembered across page reloads, so a reload does not repeat it).
  const chimed = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!message?.sound || chimed.current.has(message.id)) return;
    chimed.current.add(message.id);
    const key = `corali-tv-chimed-${message.id}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* storage off: play anyway */ }
    const audio = new Audio(messageSound(message.theme, message.urgent));
    audio.volume = 0.9;
    void audio.play().catch(() => { /* autoplay blocked by this browser: the card still shows */ });
  }, [message]);
  // OK on the remote closes a reception message; the PMS then shows it as seen.
  const dismiss = (id: number) => {
    setClosed((c) => [...c, id]);
    void fetch(`/api/public/tv/${encodeURIComponent(token)}/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  };
  // A request to reception; do not disturb is a switch. The answer shows on the button for a few seconds.
  const sendRequest = async (kind: TvRequestKind | "dnd", extra?: Record<string, unknown>) => {
    if (reqState[kind] === "sending") return false;
    choose("requests");
    setReqState((s) => ({ ...s, [kind]: "sending" }));
    let result: ReqState = "failed", error = "";
    try {
      const r = await fetch(`/api/public/tv/${encodeURIComponent(token)}/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...extra }) });
      const d = await r.json();
      if (d.ok) { result = d.recorded ? "sent" : "already"; setDnd(Boolean(d.dnd)); if (d.recorded) reloadData.current(); } else error = String(d.error ?? "");
    } catch { /* offline: show "not sent" */ }
    setReqState((s) => ({ ...s, [kind]: result }));
    setTimeout(() => setReqState((s) => (s[kind] === result ? { ...s, [kind]: undefined } : s)), 6_000);
    return result === "failed" ? error || "FAILED" : true;
  };
  // Cancelling one of my open requests takes two OKs on the same button (a request pressed by mistake is undone).
  const cancelRequest = async (id: number) => {
    choose("requests");
    if (cancelArm !== id) { setCancelArm(id); return; }
    setCancelArm(null);
    try { await fetch(`/api/public/tv/${encodeURIComponent(token)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch { /* offline: the list shows the real state on the next refresh */ }
    reloadData.current();
  };
  // Transfer: the form opens over the requests; OK on "Send" posts it with destination, day, time and people.
  const openTransfer = () => {
    const tr = data?.requests?.transfer;
    if (!tr) return;
    setTransferError("");
    setTransfer({ destination: "port", day: Math.min(tr.first.dayOffset, tr.days.length - 1), time: tr.first.time, people: tr.people });
  };
  const sendTransfer = async () => {
    const tr = data?.requests?.transfer;
    if (!transfer || !tr) return;
    const result = await sendRequest("taxi", { transfer: { destination: transfer.destination, date: tr.days[transfer.day], time: transfer.time, people: transfer.people } });
    if (result === true) { setTransfer(null); requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[data-req="taxi"]')?.focus()); }
    else setTransferError(result === "TIME" ? tr.texts.tooSoon : data?.requests?.texts.failed ?? "");
  };
  // BACK on the remote (the Corali TV app asks the page first): close the player / form, then go back home.
  const back = () => {
    if (playing !== null) { const was = playing; setPlaying(null); choose("channels"); requestAnimationFrame(() => panelRef.current?.querySelectorAll<HTMLButtonElement>(".tvChannel")[was]?.focus()); return true; }
    if (transfer) { setTransfer(null); return true; }
    if (problemOpen) { setProblemOpen(false); return true; }
    if (tab === "assistant" && assistantApi.current?.back()) return true;
    if (tab !== "home") { choose("home"); (tabsRef.current?.querySelector<HTMLButtonElement>('[data-key="home"]'))?.focus(); return true; }
    return false;
  };
  useEffect(() => {
    Object.assign(window, {
      coraliBack: back,
      // The remote's microphone / search key (Corali TV app): open the assistant and listen.
      coraliMic: () => {
        if (!data?.assistant) return false;
        choose("assistant");
        (tabsRef.current?.querySelector<HTMLButtonElement>('[data-key="assistant"]'))?.focus();
        requestAnimationFrame(() => assistantApi.current?.listen());
        return true;
      },
    });
  });
  // TV remotes send arrow keys: left/right move between tabs; down enters the buttons of the open tab, which move
  // to the nearest button in the arrow's direction. While a channel plays, up/down switch channels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing a question: the keys belong to the text field (BACK / Escape close it).
      if (document.activeElement instanceof HTMLInputElement) {
        if (["Escape", "GoBack", "BrowserBack"].includes(e.key) && back()) e.preventDefault();
        return;
      }
      if (message) {
        if (e.key === "Enter" || e.key === " ") { dismiss(message.id); e.preventDefault(); }
        else if (e.key.startsWith("Arrow")) e.preventDefault();
        return;
      }
      if (["Escape", "Backspace", "GoBack", "BrowserBack"].includes(e.key)) { if (back()) e.preventDefault(); return; }
      const channels = data?.channels ?? [];
      if (playing !== null) {
        if (["ArrowUp", "ChannelUp", "PageUp"].includes(e.key)) setPlaying((playing + channels.length - 1) % channels.length);
        else if (["ArrowDown", "ChannelDown", "PageDown"].includes(e.key)) setPlaying((playing + 1) % channels.length);
        e.preventDefault();
        return;
      }
      const modal = Boolean(transfer || problemOpen);
      const container = modal ? transferRef.current : panelRef.current;
      const grid = Array.from(container?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const inGrid = grid.indexOf(document.activeElement as HTMLButtonElement);
      if (modal && inGrid < 0 && grid.length) { grid[0].focus(); e.preventDefault(); return; }
      if (inGrid >= 0 && e.key.startsWith("Arrow")) {
        const box = (b: Element) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        const from = box(grid[inGrid]), dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        let best: HTMLButtonElement | null = null, bestScore = Infinity;
        for (const b of grid) {
          const c = box(b), along = (c.x - from.x) * dx + (c.y - from.y) * dy, across = Math.abs((c.x - from.x) * dy) + Math.abs((c.y - from.y) * dx);
          if (b === grid[inGrid] || along <= 1) continue;
          const score = along + across * 2;
          if (score < bestScore) { bestScore = score; best = b; }
        }
        if (best) best.focus();
        else if (dy < 0 && !modal) (tabsRef.current?.querySelector<HTMLButtonElement>(`[data-key="${tab}"]`))?.focus();
        if (idle.current) choose(tab);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown" && (tab === "requests" || tab === "channels" || tab === "apps" || tab === "assistant") && grid.length) { grid[0].focus(); e.preventDefault(); return; }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const buttons = Array.from(tabsRef.current?.querySelectorAll("button") ?? []);
      if (!buttons.length) return;
      const at = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
      const next = buttons[(at + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      choose(next.dataset.key ?? "home");
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/public/tv/${encodeURIComponent(token)}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`, { cache: "no-store" });
        if (!live) return;
        if (r.status === 404) { setMissing(true); return; }
        const d = await r.json();
        if (d.ok) { setData(d); setMissing(false); }
      } catch { /* keep the last screen while offline */ }
    };
    reloadData.current = () => void load();
    void load();
    const poll = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => setNow(new Date()), 15_000);
    queueMicrotask(() => live && setNow(new Date()));
    // A new PMS version (installer) reloads the page within ~5 minutes; a full reload every 6 hours as before.
    const reload = setTimeout(() => location.reload(), 6 * 3_600_000);
    let version = "";
    const checkVersion = async () => {
      try {
        const v = String((await (await fetch("/api/health", { cache: "no-store" })).json())?.version ?? "");
        if (version && v && v !== version) location.reload();
        else if (v) version = v;
      } catch { /* offline or restarting: try again later */ }
    };
    void checkVersion();
    const versionPoll = setInterval(checkVersion, 5 * 60_000);
    return () => { live = false; clearInterval(poll); clearInterval(clock); clearTimeout(reload); clearInterval(versionPoll); };
  }, [token, lang]);

  if (missing || !data) return <main className="tvScreen tvEmpty"><span className="tvLogo"><img src="/hotel-corali-logo.png" alt="Hotel Corali" /></span></main>;

  const t = data.texts, locale = locales[data.lang];
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const euro = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  const g = data.guest;
  const current = tab !== "home" ? data.info.find((x) => x.key === tab) : undefined;
  const rq = data.requests, dndOn = rq ? (dnd ?? rq.dnd) : false;
  // Apps tab: only inside the Corali TV app, only apps installed on this TV (first installed package of each).
  const bridge = appBridge();
  const installed = (() => { if (!bridge || !data.apps.length) return [] as string[]; try { return JSON.parse(bridge.installed(JSON.stringify(data.apps.flatMap((a) => a.packages)))) as string[]; } catch { return []; } })();
  const apps = data.apps.flatMap((a) => { const pkg = a.packages.find((p) => installed.includes(p)); return pkg ? [{ ...a, pkg }] : []; });
  const openApp = (pkg: string) => { setAppError(""); let ok = false; try { ok = Boolean(bridge?.open(pkg)); } catch { ok = false; } if (!ok) setAppError(data.appTexts.failed); };
  const reqLabel = (k: TvRequestKind | "dnd", label: string) => { const st = reqState[k]; return st === "sent" ? rq!.texts.sent : st === "already" ? rq!.texts.already : st === "failed" ? rq!.texts.failed : label; };
  return (
    <main className="tvScreen">
      <header className="tvTop">
        <span className="tvLogo"><img src="/hotel-corali-logo.png" alt="Hotel Corali" /></span>
        <div className="tvClock">
          {now && <b>{now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" })}</b>}
          {now && <span>{now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" })}</span>}
        </div>
      </header>

      <section className="tvHero">
        <h1>{g ? t.hello.replace("{name}", g.firstName) : t.hotel}</h1>
        {g?.departureToday ? <p className="tvNotice">{t.checkoutToday.replace("{time}", data.checkOutTime)}</p> : <p>{data.welcome}</p>}
        {rq && dndOn && <p className="tvDndChip"><FaBan aria-hidden />{rq.texts.dnd}</p>}
        {g && !g.departureToday && (
          <div className="tvStay"><span>{t.room} <b>{data.roomCode}</b></span><span>{t.stay} <b>{day(g.checkIn)} → {day(g.checkOut)}</b></span><span>{t.checkout} <b>{t.until} {data.checkOutTime}</b></span></div>
        )}
      </section>

      {(data.info.length > 0 || rq || data.channels.length > 0 || apps.length > 0 || data.assistant) && (
        <nav className={`tvTabs${rq ? " withReq" : ""}`} ref={tabsRef} aria-label="Hotel information">
          <button type="button" data-key="home" className={tab === "home" ? "active" : ""} onClick={() => choose("home")}><TabIcon k="home" />{t.home}</button>
          {data.info.map((x) => <button type="button" key={x.key} data-key={x.key} className={tab === x.key ? "active" : ""} onClick={() => choose(x.key)}><TabIcon k={x.key} emoji={x.icon} />{x.title}</button>)}
          {apps.length > 0 && <button type="button" data-key="apps" className={tab === "apps" ? "active" : ""} onClick={() => choose("apps")}><FaThLarge aria-hidden />{data.appTexts.tab}</button>}
          {data.channels.length > 0 && <button type="button" data-key="channels" className={tab === "channels" ? "active" : ""} onClick={() => choose("channels")}><FaTv aria-hidden />{data.channelTexts.tab}</button>}
          {data.assistant && <button type="button" data-key="assistant" className={`tvAsTab${tab === "assistant" ? " active" : ""}`} onClick={() => choose("assistant")}><FaRobot aria-hidden />{data.assistant.texts.tab}</button>}
          {rq && <button type="button" data-key="requests" className={`tvReqTab${tab === "requests" ? " active" : ""}`} onClick={() => choose("requests")}><FaConciergeBell aria-hidden />{rq.texts.tab}</button>}
        </nav>
      )}

      {tab === "assistant" && data.assistant ? (
        <TvAssistant token={token} lang={data.lang} texts={data.assistant.texts} speech={data.assistant.speech} gridRef={panelRef} apiRef={assistantApi} onActivity={() => choose("assistant")} />
      ) : tab === "requests" && rq ? (
        <section className="tvInfo tvReq">
          <p className="tvReqIntro">{rq.texts.intro}</p>
          <div className="tvReqPanel" ref={panelRef}>
          <div className="tvReqGrid">
            <button type="button" className={`tvReqBtn tvReqDnd${dndOn ? " on" : ""}${reqState.dnd ? ` is-${reqState.dnd}` : ""}`} aria-pressed={dndOn} onClick={() => sendRequest("dnd", { on: !dndOn })}>
              <span className="tvReqIcon"><FaBan aria-hidden /></span>
              <b>{reqLabel("dnd", rq.texts.dnd)}</b>
              <small>{rq.texts.dndHint}</small>
              <span className="tvSwitch" aria-hidden><i />{dndOn ? rq.texts.dndOn : rq.texts.dndOff}</span>
            </button>
            {tvRequestKinds.map((k) => { const I = reqIcons[k]; const st = reqState[k]; return (
              <button type="button" key={k} data-req={k} className={`tvReqBtn${st ? ` is-${st}` : ""}`} onClick={() => (k === "taxi" && rq.transfer ? openTransfer() : k === "problem" && rq.problems ? setProblemOpen(true) : sendRequest(k))}>
                <span className="tvReqIcon">{st === "sent" || st === "already" ? <FaCheck aria-hidden /> : <I aria-hidden />}</span>
                <b>{reqLabel(k, rq.texts[k])}</b>
              </button>
            ); })}
          </div>
          {rq.mine.length > 0 && (
            <div className="tvMine">
              <h3>{rq.texts.mine}</h3>
              <ul>
                {rq.mine.map((m) => { const known = (tvRequestKinds as readonly string[]).includes(m.kind); const I = known ? reqIcons[m.kind as TvRequestKind] : FaConciergeBell; return (
                  <li key={m.id} className={`st-${m.status}`}>
                    <span className="tvReqIcon"><I aria-hidden /></span>
                    <b>{known ? rq.texts[m.kind as TvRequestKind] : tvRequestLabels[m.kind]?.en ?? m.kind}</b>
                    <small>{new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" })}</small>
                    <em>{m.status === "open" ? rq.texts.stOpen : m.status === "cancelled" ? rq.texts.stCancelled : rq.texts.stDone}</em>
                    {m.status === "open" && <button type="button" className={cancelArm === m.id ? "armed" : ""} onBlur={() => setCancelArm((a) => (a === m.id ? null : a))} onClick={() => cancelRequest(m.id)}>{cancelArm === m.id ? rq.texts.confirmCancel : rq.texts.cancel}</button>}
                  </li>
                ); })}
              </ul>
            </div>
          )}
          </div>
        </section>
      ) : tab === "apps" && apps.length > 0 ? (
        <section className="tvInfo tvApps">
          <p className="tvReqIntro">{data.appTexts.hint}</p>
          <div className="tvAppGrid" ref={panelRef}>
            {apps.map((a) => <button type="button" key={a.key} className="tvApp" style={{ background: a.color }} onClick={() => openApp(a.pkg)}><b>{a.name}</b></button>)}
          </div>
          {appError && <p className="tvReqIntro tvAppError">{appError}</p>}
        </section>
      ) : tab === "channels" && data.channels.length > 0 ? (
        <section className="tvInfo tvChannels">
          <div className="tvKeysHelp" aria-label={data.channelTexts.helpTitle}>
            <b>{data.channelTexts.helpTitle}</b>
            {([["◀ ▲ ▼ ▶", data.channelTexts.helpChoose], ["OK", data.channelTexts.helpWatch], ["▲ ▼", data.channelTexts.helpSwitch], ["BACK ↩", data.channelTexts.helpBack]] as const).map(([k, v]) => <span key={k}><kbd>{k}</kbd>{v}</span>)}
          </div>
          <div className="tvChannelGrid" ref={panelRef}>
            {data.channels.map((c, i) => (
              <button type="button" key={`${c.name}-${i}`} className="tvChannel" onClick={() => setPlaying(i)}>
                <span className="tvChannelLogo">{c.logo ? <img src={c.logo} alt="" /> : <FaTv aria-hidden />}</span>
                <b>{c.name}</b>
                <small>{data.channelTexts[c.category]}</small>
              </button>
            ))}
          </div>
        </section>
      ) : current ? (
        <section className="tvInfo">
          <div className="tvCard tvInfoCard">
            <div className="tvInfoSide"><span className="tvIcon"><TabIcon k={current.key} emoji={current.icon} /></span><h2>{current.title}</h2></div>
            <div className="tvInfoBody"><InfoBody text={current.body} /></div>
          </div>
        </section>
      ) : (
        <section className="tvGrid">
          {data.wifi && (
            <div className="tvCard tvWifi">
              <CardHead icon={FaWifi} title={t.wifi} />
              <dl><dt>{t.network}</dt><dd>{data.wifi.ssid}</dd>{data.wifi.password && <><dt>{t.password}</dt><dd>{data.wifi.password}</dd></>}</dl>
              <figure className="tvQr"><img src={data.wifi.qr} alt="" /><figcaption>{t.scanWifi}</figcaption></figure>
              {data.wifi.note && <p className="tvWifiNote">{data.wifi.note}</p>}
            </div>
          )}
          {data.weather && (
            <div className="tvCard tvWeather">
              <CardHead icon={WiDaySunny} title={t.weather} />
              <div className="tvNow"><WeatherIcon code={data.weather.code} /><b>{data.weather.temp}°</b><small>{t.wind.replace("{b}", String(data.weather.wind))}</small></div>
              <ul className="tvDays">{data.weather.days.map((d, i) => <li key={d.date}><span>{i === 0 ? t.today : i === 1 ? t.tomorrow : new Date(`${d.date}T12:00:00Z`).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" })}</span><WeatherIcon code={d.code} /><span>{d.max}° <em>/ {d.min}°</em></span></li>)}</ul>
            </div>
          )}
          {(data.tips.length > 0 || data.guide) && (
            <div className="tvCard tvTips">
              <CardHead icon={FaRegLightbulb} title={t.tips} />
              <ul className="tvList">{data.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
              {data.guide && <div className="tvQrStack"><figure className="tvQr"><img src={data.guide.qr} alt="" /><figcaption><b><FaMapMarkedAlt aria-hidden />{t.guide}</b>{t.scanGuide}</figcaption></figure></div>}
            </div>
          )}
          <div className="tvCard tvBooking">
            <CardHead icon={FaConciergeBell} title={t.extras} />
            {data.extras.length > 0 && <ul className="tvList tvServices">{data.extras.map((e) => <li key={e.name}><span>{e.name}</span><b>{euro(e.priceCents)} {e.perNight ? t.perNight : e.perPerson ? t.perPerson : ""}</b></li>)}</ul>}
            <div className="tvQrStack">
              <figure className="tvQr"><img src={data.manage.qr} alt="" /><figcaption><b><FaRegCalendarCheck aria-hidden />{t.booking}</b>{t.scanBooking}<span className="tvDirectOnly">{t.directOnly}</span></figcaption></figure>
              {data.whatsapp && <figure className="tvQr"><img src={data.whatsapp.qr} alt="" /><figcaption><b><FaWhatsapp aria-hidden />{t.whatsapp}</b>{t.scanWhatsapp}</figcaption></figure>}
              {data.receptionPhone && <p className="tvPhone">{t.reception}: <b>{data.receptionPhone}</b></p>}
            </div>
          </div>
        </section>
      )}
      {transfer && rq?.transfer && (() => { const tr = rq.transfer, tx = tr.texts; const dayName = (i: number) => (i === 0 ? tx.today : i === 1 ? tx.tomorrow : day(tr.days[i])); return (
        <div className="tvMsg tvTransfer" role="dialog" aria-label={tx.title}>
          <article className="tvMsgCard" ref={transferRef}>
            <div className="tvMsgBody">
              <span className="tvMsgHead"><span className="tvMsgBadge"><FaTaxi aria-hidden /></span>{tx.title}</span>
              <div className="tvTfRow"><span>{tx.destination}</span>{(["port", "airport", "other"] as const).map((d) => <button type="button" key={d} className={transfer.destination === d ? "on" : ""} onClick={() => setTransfer({ ...transfer, destination: d })}>{tx[d]}</button>)}</div>
              {transfer.destination === "other" && <p className="tvTfHint">{tx.otherHint}</p>}
              <div className="tvTfRow"><span>{tx.day}</span>{tr.days.slice(0, 7).map((_, i) => <button type="button" key={i} className={transfer.day === i ? "on" : ""} onClick={() => setTransfer({ ...transfer, day: i })}>{dayName(i)}</button>)}</div>
              <div className="tvTfRow"><span>{tx.time}</span><button type="button" aria-label="−" onClick={() => setTransfer({ ...transfer, time: shiftTime(transfer.time, -15) })}>−</button><b className="tvTfValue">{transfer.time}</b><button type="button" aria-label="+" onClick={() => setTransfer({ ...transfer, time: shiftTime(transfer.time, 15) })}>+</button>
                <span className="tvTfGap">{tx.people}</span><button type="button" aria-label="−" disabled={transfer.people <= 1} onClick={() => setTransfer({ ...transfer, people: transfer.people - 1 })}>−</button><b className="tvTfValue">{transfer.people}</b><button type="button" aria-label="+" disabled={transfer.people >= 12} onClick={() => setTransfer({ ...transfer, people: transfer.people + 1 })}>+</button></div>
              {transferError && <p className="tvTfError">{transferError}</p>}
              <footer className="tvTfActions"><button type="button" className="tvTfSend" autoFocus disabled={reqState.taxi === "sending"} onClick={sendTransfer}>{tx.send}</button><button type="button" onClick={() => setTransfer(null)}>{tx.cancel}</button></footer>
            </div>
          </article>
        </div>
      ); })()}
      {problemOpen && rq?.problems && (
        <div className="tvMsg tvTransfer" role="dialog" aria-label={rq.problems.title}>
          <article className="tvMsgCard" ref={transferRef}>
            <div className="tvMsgBody">
              <span className="tvMsgHead"><span className="tvMsgBadge"><FaTools aria-hidden /></span>{rq.problems.title}</span>
              <p className="tvTfHint">{rq.problems.intro}</p>
              <div className="tvProblemGrid">
                {tvProblems.map((k, i) => (
                  <button type="button" key={k} autoFocus={i === 0} onClick={async () => { setProblemOpen(false); await sendRequest("problem", { problem: k }); requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[data-req="problem"]')?.focus()); }}>{rq.problems![k]}</button>
                ))}
              </div>
              <footer className="tvTfActions"><button type="button" onClick={() => setProblemOpen(false)}>{rq.problems.cancel}</button></footer>
            </div>
          </article>
        </div>
      )}
      {playing !== null && data.channels[playing] && <ChannelPlayer key={playing} channel={data.channels[playing]} texts={data.channelTexts} onClose={() => setPlaying(null)} />}
      {message && (
        <div className={`tvMsg theme-${message.theme}${message.urgent ? " urgent" : ""}${message.image ? " withPhoto" : ""}`} role="alertdialog" aria-labelledby="tvMsgHead">
          {(message.theme === "birthday" || message.theme === "celebration") && <Confetti />}
          {message.theme === "anniversary" && <Hearts />}
          <article className="tvMsgCard" key={message.id}>
            {message.image && <div className="tvMsgPhoto"><img src={message.image} alt="" /></div>}
            <div className="tvMsgBody">
              <span className="tvMsgHead" id="tvMsgHead"><span className="tvMsgBadge">{(() => { const I = msgIcons[message.theme] ?? FaRegEnvelope; return <I aria-hidden />; })()}</span>{message.urgent ? t.msgUrgent : message.theme === "birthday" ? t.msgBirthday : message.theme === "anniversary" ? t.msgAnniversary : message.theme === "celebration" ? t.msgCelebration : t.msgFrom}</span>
              {message.text && <p>{message.text}</p>}
              <footer>
                <span className="tvMsgSign"><b>Hotel Corali</b> · {t.reception} · {new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" })}</span>
                <span className="tvMsgOk"><button type="button" autoFocus onClick={() => dismiss(message.id)}>OK</button><small>{t.msgOk}</small></span>
              </footer>
            </div>
          </article>
        </div>
      )}
    </main>
  );
}
