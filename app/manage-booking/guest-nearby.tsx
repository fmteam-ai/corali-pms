"use client";
import { useEffect, useState } from "react";
import type { BookingLanguage } from "@/lib/booking-i18n";
import { nearbyKinds, nearbyTexts } from "@/lib/nearby-texts";
import type { NearbyKind, NearbyPlace } from "@/lib/tv-nearby-core";

type Data = { source: "google" | "osm"; radiusKm: number; hotel: { lat: number; lon: number }; places: NearbyPlace[] };
const kindOrder = Object.keys(nearbyKinds) as NearbyKind[];

/** "My booking" → Near the hotel: shops and services around the hotel with distance, today's hours, map and directions. */
export function GuestNearby({ token, lang }: { token: string; lang: BookingLanguage }) {
  const t = nearbyTexts[lang];
  const [data, setData] = useState<Data | null>(null);
  const [kind, setKind] = useState<NearbyKind | "">("");
  const [more, setMore] = useState(false);
  const [map, setMap] = useState<NearbyPlace | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/public/nearby?token=${encodeURIComponent(token)}`).then((r) => r.json()).then((d) => { if (live && d?.ok) setData(d); }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  if (!data || !data.places.length) return null;

  const kinds = kindOrder.filter((k) => data.places.some((p) => p.kind === k));
  const list = data.places.filter((p) => !kind || p.kind === kind);
  const shown = more ? list : list.slice(0, 8);
  const meters = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", lang === "en" ? "." : ",")} km`);
  const distance = (p: NearbyPlace) => (p.meters <= 1500 ? t.walk.replace("{min}", String(p.walkMin)) : t.drive.replace("{min}", String(Math.max(2, Math.round((p.meters * 1.3) / 500))))).replace("{m}", meters(p.meters));
  const directions = (p: NearbyPlace) => `https://www.google.com/maps/dir/?api=1&origin=${data.hotel.lat},${data.hotel.lon}&destination=${p.lat},${p.lon}&travelmode=${p.meters <= 1500 ? "walking" : "driving"}`;

  return (
    <section className="gOrders gNearby">
      <h3>{t.title}</h3>
      <p className="hint">{t.subtitle.replace("{km}", String(data.radiusKm).replace(".", lang === "en" ? "." : ","))}</p>
      <div className="gpTabs" role="tablist">
        <button type="button" role="tab" aria-selected={!kind} className={!kind ? "on" : ""} onClick={() => { setKind(""); setMore(false); }}>{t.all}</button>
        {kinds.map((k) => <button type="button" role="tab" key={k} aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setMore(false); }}>{nearbyKinds[k].icon} {nearbyKinds[k][lang]}</button>)}
      </div>
      {!list.length && <p className="hint">{t.none}</p>}
      <div className="gnList">
        {shown.map((p) => (
          <article key={`${p.kind}${p.name}${p.meters}`} className="gnCard">
            <div className="gnHead">
              <span className="gnIcon" aria-hidden>{nearbyKinds[p.kind].icon}</span>
              <div>
                <b>{p.name}</b>
                <small>{nearbyKinds[p.kind][lang]}{p.price ? ` · ${p.price}` : ""}{p.rating ? <> · <span className="gnRating">★ {p.rating.toFixed(1)}</span> ({p.ratings} {t.reviews})</> : null}</small>
              </div>
              <span className="gnDist">{distance(p)}</span>
            </div>
            {p.hours && <small className={`gnHours${/κλειστ|closed|fermé|geschlossen|chiuso|cerrado/i.test(p.hours) ? " closed" : ""}`}>🕒 {t.today}: {p.hours}</small>}
            {p.address && <small className="gnAddr">📍 {p.address}</small>}
            <div className="gnActions">
              {p.lat !== undefined && <button type="button" onClick={() => setMap(p)}>🗺️ {t.map}</button>}
              {p.lat !== undefined && <a href={directions(p)} target="_blank" rel="noreferrer">🧭 {t.directions}</a>}
              {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>📞 {t.call}</a>}
              {p.website && <a href={p.website} target="_blank" rel="noreferrer">🌐 {t.website}</a>}
            </div>
          </article>
        ))}
      </div>
      {list.length > 8 && !more && <button type="button" className="linkButton" onClick={() => setMore(true)}>+ {list.length - 8}</button>}
      <small className="gnSource">{t.source}: {data.source === "google" ? "Google Maps" : "© OpenStreetMap"}</small>
      {map && (
        <div className="gnMapOverlay" role="dialog" aria-label={map.name} onClick={() => setMap(null)}>
          <div className="gnMapCard" onClick={(e) => e.stopPropagation()}>
            <div className="gnMapHead"><b>{map.name}</b><span>{distance(map)}</span></div>
            <iframe title={map.name} src={`https://maps.google.com/maps?q=${map.lat},${map.lon}&z=17&hl=${lang}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <div className="gnActions">
              <a href={map.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${map.lat},${map.lon}`} target="_blank" rel="noreferrer">Google Maps ↗</a>
              <a href={directions(map)} target="_blank" rel="noreferrer">🧭 {t.directions}</a>
              <button type="button" onClick={() => setMap(null)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
