"use client";
import { useEffect, useState } from "react";
import type { TvScreenData } from "@/lib/tv";

const locales = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" } as const;
const REFRESH_MS = 60_000;

export function TvScreen({ token, lang }: { token: string; lang: string }) {
  const [data, setData] = useState<TvScreenData | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

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
          <div className="tvBookingQr tvQrRow"><img src={data.manage.qr} alt="" /><p><b>{t.booking}</b><br />{t.scanBooking}{data.receptionPhone && <><br />{t.reception}: <b>{data.receptionPhone}</b></>}</p></div>
          {data.whatsapp && <div className="tvBookingQr tvQrRow"><img className="tvWa" src={data.whatsapp.qr} alt="" /><p><b>💬 {t.whatsapp}</b><br />{t.scanWhatsapp}</p></div>}
        </div>
      </section>
    </main>
  );
}
