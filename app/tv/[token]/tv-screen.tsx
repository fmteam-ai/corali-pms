"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { FaBan, FaBath, FaBed, FaBirthdayCake, FaCheck, FaGlassCheers, FaPhoneAlt, FaPumpSoap, FaTaxi, FaTools, FaHeart, FaLayerGroup, FaBroom, FaConciergeBell, FaEuroSign, FaExclamation, FaHome, FaMapMarkedAlt, FaRegCalendarCheck, FaRegClock, FaRegEnvelope, FaRegLightbulb, FaSuitcaseRolling, FaWhatsapp, FaWifi } from "react-icons/fa";
import { WiCloud, WiCloudy, WiDayCloudy, WiDaySunny, WiFog, WiRain, WiShowers, WiSnow, WiThunderstorm } from "react-icons/wi";
import type { TvScreenData } from "@/lib/tv";
import { messageSound } from "@/lib/tv-messages-core";
import { tvRequestKinds, type TvRequestKind } from "@/lib/tv-requests-core";
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

const CardHead = ({ icon: I, title }: { icon: IconType; title: string }) => <div className="tvCardHead"><span className="tvIcon"><I aria-hidden /></span><h2>{title}</h2></div>;

export function TvScreen({ token, lang }: { token: string; lang: string }) {
  const [data, setData] = useState<TvScreenData | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [tab, setTab] = useState("home");
  const [closed, setClosed] = useState<number[]>([]);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsRef = useRef<HTMLElement | null>(null);
  const reqRef = useRef<HTMLDivElement | null>(null);
  const [reqState, setReqState] = useState<Partial<Record<TvRequestKind | "dnd", ReqState>>>({});
  const [dnd, setDnd] = useState<boolean | null>(null);

  // Any remote/keyboard/touch use keeps the chosen tab; after 90 s without it the screen goes back home.
  const choose = (key: string) => {
    setTab(key);
    if (idle.current) clearTimeout(idle.current);
    if (key !== "home") idle.current = setTimeout(() => setTab("home"), HOME_AFTER_MS);
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
  const sendRequest = async (kind: TvRequestKind | "dnd", on?: boolean) => {
    if (reqState[kind] === "sending") return;
    choose("requests");
    setReqState((s) => ({ ...s, [kind]: "sending" }));
    let result: ReqState = "failed";
    try {
      const r = await fetch(`/api/public/tv/${encodeURIComponent(token)}/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "dnd" ? { kind, on } : { kind }) });
      const d = await r.json();
      if (d.ok) { result = d.recorded ? "sent" : "already"; setDnd(Boolean(d.dnd)); }
    } catch { /* offline: show "not sent" */ }
    setReqState((s) => ({ ...s, [kind]: result }));
    setTimeout(() => setReqState((s) => (s[kind] === result ? { ...s, [kind]: undefined } : s)), 6_000);
  };
  // TV remotes send arrow keys: left/right move between tabs; down enters the request buttons, which move in a grid.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (message) {
        if (e.key === "Enter" || e.key === " ") { dismiss(message.id); e.preventDefault(); }
        else if (e.key.startsWith("Arrow")) e.preventDefault();
        return;
      }
      const grid = Array.from(reqRef.current?.querySelectorAll("button") ?? []);
      const inGrid = grid.indexOf(document.activeElement as HTMLButtonElement);
      if (inGrid >= 0 && e.key.startsWith("Arrow")) {
        // Move to the nearest button in the arrow's direction (the do-not-disturb tile is two rows high).
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
        else if (dy < 0) (tabsRef.current?.querySelector<HTMLButtonElement>('[data-key="requests"]'))?.focus();
        if (idle.current) choose("requests");
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown" && tab === "requests" && grid.length) { grid[0].focus(); e.preventDefault(); return; }
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
    void load();
    const poll = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => setNow(new Date()), 15_000);
    queueMicrotask(() => live && setNow(new Date()));
    // Reload the whole page every 6 hours so the screen picks up new versions of the PMS.
    const reload = setTimeout(() => location.reload(), 6 * 3_600_000);
    return () => { live = false; clearInterval(poll); clearInterval(clock); clearTimeout(reload); };
  }, [token, lang]);

  if (missing || !data) return <main className="tvScreen tvEmpty"><span className="tvLogo"><img src="/hotel-corali-logo.png" alt="Hotel Corali" /></span></main>;

  const t = data.texts, locale = locales[data.lang];
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const euro = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  const g = data.guest;
  const current = tab !== "home" ? data.info.find((x) => x.key === tab) : undefined;
  const rq = data.requests, dndOn = rq ? (dnd ?? rq.dnd) : false;
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

      {(data.info.length > 0 || rq) && (
        <nav className={`tvTabs${rq ? " withReq" : ""}`} ref={tabsRef} aria-label="Hotel information">
          <button type="button" data-key="home" className={tab === "home" ? "active" : ""} onClick={() => choose("home")}><TabIcon k="home" />{t.home}</button>
          {data.info.map((x) => <button type="button" key={x.key} data-key={x.key} className={tab === x.key ? "active" : ""} onClick={() => choose(x.key)}><TabIcon k={x.key} emoji={x.icon} />{x.title}</button>)}
          {rq && <button type="button" data-key="requests" className={`tvReqTab${tab === "requests" ? " active" : ""}`} onClick={() => choose("requests")}><FaConciergeBell aria-hidden />{rq.texts.tab}</button>}
        </nav>
      )}

      {tab === "requests" && rq ? (
        <section className="tvInfo tvReq">
          <p className="tvReqIntro">{rq.texts.intro}</p>
          <div className="tvReqGrid" ref={reqRef}>
            <button type="button" className={`tvReqBtn tvReqDnd${dndOn ? " on" : ""}${reqState.dnd ? ` is-${reqState.dnd}` : ""}`} aria-pressed={dndOn} onClick={() => sendRequest("dnd", !dndOn)}>
              <span className="tvReqIcon"><FaBan aria-hidden /></span>
              <b>{reqLabel("dnd", rq.texts.dnd)}</b>
              <small>{rq.texts.dndHint}</small>
              <span className="tvSwitch" aria-hidden><i />{dndOn ? rq.texts.dndOn : rq.texts.dndOff}</span>
            </button>
            {tvRequestKinds.map((k) => { const I = reqIcons[k]; const st = reqState[k]; return (
              <button type="button" key={k} className={`tvReqBtn${st ? ` is-${st}` : ""}`} onClick={() => sendRequest(k)}>
                <span className="tvReqIcon">{st === "sent" || st === "already" ? <FaCheck aria-hidden /> : <I aria-hidden />}</span>
                <b>{reqLabel(k, rq.texts[k])}</b>
              </button>
            ); })}
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
