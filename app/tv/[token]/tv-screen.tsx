"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { FaBroom, FaConciergeBell, FaEuroSign, FaExclamation, FaHome, FaMapMarkedAlt, FaRegCalendarCheck, FaRegClock, FaRegLightbulb, FaSuitcaseRolling, FaWhatsapp, FaWifi } from "react-icons/fa";
import { WiCloud, WiCloudy, WiDayCloudy, WiDaySunny, WiFog, WiRain, WiShowers, WiSnow, WiThunderstorm } from "react-icons/wi";
import type { TvScreenData } from "@/lib/tv";
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

const CardHead = ({ icon: I, title }: { icon: IconType; title: string }) => <div className="tvCardHead"><span className="tvIcon"><I aria-hidden /></span><h2>{title}</h2></div>;

export function TvScreen({ token, lang }: { token: string; lang: string }) {
  const [data, setData] = useState<TvScreenData | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [tab, setTab] = useState("home");
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsRef = useRef<HTMLElement | null>(null);

  // Any remote/keyboard/touch use keeps the chosen tab; after 90 s without it the screen goes back home.
  const choose = (key: string) => {
    setTab(key);
    if (idle.current) clearTimeout(idle.current);
    if (key !== "home") idle.current = setTimeout(() => setTab("home"), HOME_AFTER_MS);
  };
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);
  // TV remotes send arrow keys: left/right move between tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  if (missing || !data) return <main className="tvScreen tvEmpty"><img src="/hotel-corali-logo.png" alt="Hotel Corali" /></main>;

  const t = data.texts, locale = locales[data.lang];
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const euro = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  const g = data.guest;
  const current = tab !== "home" ? data.info.find((x) => x.key === tab) : undefined;
  return (
    <main className="tvScreen">
      <header className="tvTop">
        <img src="/hotel-corali-logo.png" alt="Hotel Corali" />
        <div className="tvClock">
          {now && <b>{now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" })}</b>}
          {now && <span>{now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" })}</span>}
        </div>
      </header>

      <section className="tvHero">
        <h1>{g ? t.hello.replace("{name}", g.firstName) : t.hotel}</h1>
        {g?.departureToday ? <p className="tvNotice">{t.checkoutToday.replace("{time}", data.checkOutTime)}</p> : <p>{data.welcome}</p>}
        {g && !g.departureToday && (
          <div className="tvStay"><span>{t.room} <b>{data.roomCode}</b></span><span>{t.stay} <b>{day(g.checkIn)} → {day(g.checkOut)}</b></span><span>{t.checkout} <b>{t.until} {data.checkOutTime}</b></span></div>
        )}
      </section>

      {data.info.length > 0 && (
        <nav className="tvTabs" ref={tabsRef} aria-label="Hotel information">
          <button type="button" data-key="home" className={tab === "home" ? "active" : ""} onClick={() => choose("home")}><TabIcon k="home" />{t.home}</button>
          {data.info.map((x) => <button type="button" key={x.key} data-key={x.key} className={tab === x.key ? "active" : ""} onClick={() => choose(x.key)}><TabIcon k={x.key} emoji={x.icon} />{x.title}</button>)}
        </nav>
      )}

      {current ? (
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
    </main>
  );
}
