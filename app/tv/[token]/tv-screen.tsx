"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { TvScreenData } from "@/lib/tv";

const locales = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" } as const;
const REFRESH_MS = 60_000;
const HOME_AFTER_MS = 90_000;

/** **bold** inside a line. */
const strong = (line: string): ReactNode[] => line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));

/** Info text: one paragraph per line, consecutive "- " lines become a list. */
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

  if (missing) return <main className="tvScreen tvEmpty"><img src="/hotel-corali-logo.png" alt="Hotel Corali" /></main>;
  if (!data) return <main className="tvScreen tvEmpty"><img src="/hotel-corali-logo.png" alt="Hotel Corali" /></main>;

  const t = data.texts, locale = locales[data.lang];
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const euro = (c: number) => `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  const g = data.guest;
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
          <div className="tvStay"><span>{t.room} <b>{data.roomCode}</b></span><span>{t.stay}: <b>{day(g.checkIn)} → {day(g.checkOut)}</b></span><span>{t.checkout}: <b>{day(g.checkOut)}, {t.until} {data.checkOutTime}</b></span></div>
        )}
      </section>

      {data.info.length > 0 && (
        <nav className="tvTabs" ref={tabsRef} aria-label="Hotel information">
          <button type="button" data-key="home" className={tab === "home" ? "active" : ""} onClick={() => choose("home")}>🏠 {t.home}</button>
          {data.info.map((x) => <button type="button" key={x.key} data-key={x.key} className={tab === x.key ? "active" : ""} onClick={() => choose(x.key)}>{x.icon} {x.title}</button>)}
        </nav>
      )}

      {tab !== "home" && data.info.some((x) => x.key === tab) ? (
        <section className="tvInfo">{data.info.filter((x) => x.key === tab).map((x) => (
          <div className="tvCard tvInfoCard" key={x.key}><h2><span>{x.icon}</span> {x.title}</h2><div className="tvInfoBody"><InfoBody text={x.body} /></div></div>
        ))}</section>
      ) : (
      <section className="tvGrid">
        {data.wifi && (
          <div className="tvCard tvWifi">
            <h2>📶 {t.wifi}</h2>
            <div className="tvWifiBody">
              <dl><dt>{t.network}</dt><dd>{data.wifi.ssid}</dd>{data.wifi.password && <><dt>{t.password}</dt><dd>{data.wifi.password}</dd></>}</dl>
              <figure><img src={data.wifi.qr} alt="" /><figcaption>{t.scanWifi}</figcaption></figure>
            </div>
          </div>
        )}
        {data.weather && (
          <div className="tvCard tvWeather">
            <h2>{t.weather}</h2>
            <div className="tvNow"><span>{data.weather.icon}</span><b>{data.weather.temp}°</b><small>{t.wind.replace("{b}", String(data.weather.wind))}</small></div>
            <ul>{data.weather.days.map((d, i) => <li key={d.date}><span>{i === 0 ? t.today : i === 1 ? t.tomorrow : new Date(`${d.date}T12:00:00Z`).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" })}</span><span>{d.icon}</span><span>{d.max}° / {d.min}°</span></li>)}</ul>
          </div>
        )}
        {(data.tips.length > 0 || data.guide) && (
          <div className="tvCard tvTips">
            <h2>☀️ {t.tips}</h2>
            <ul>{data.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
            {data.guide && <div className="tvBookingQr tvQrRow"><img src={data.guide.qr} alt="" /><p><b>🗺️ {t.guide}</b><br />{t.scanGuide}</p></div>}
          </div>
        )}
        <div className="tvCard tvBooking">
          <h2>🛎️ {t.extras}</h2>
          {data.extras.length > 0 && <ul>{data.extras.map((e) => <li key={e.name}><span>{e.name}</span><b>{euro(e.priceCents)} {e.perNight ? t.perNight : e.perPerson ? t.perPerson : ""}</b></li>)}</ul>}
          <div className="tvQrPair">
            <figure><img src={data.manage.qr} alt="" /><figcaption><b>{t.booking}</b>{t.scanBooking}<em className="tvDirectOnly">{t.directOnly}</em></figcaption></figure>
            {data.whatsapp && <figure><img src={data.whatsapp.qr} alt="" /><figcaption><b>💬 {t.whatsapp}</b>{t.scanWhatsapp}</figcaption></figure>}
          </div>
          {data.receptionPhone && <p className="tvPhone">{t.reception}: <b>{data.receptionPhone}</b></p>}
        </div>
      </section>
      )}
    </main>
  );
}
