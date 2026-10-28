// Places near the hotel for the TV assistant: Google Places (New) when PMS → Integrations → Google Places has a key,
// else OpenStreetMap. Refreshed every 12 hours and shared by all TVs; Google calls are counted per day and stop at the
// hotel's daily limit (then OpenStreetMap is used), so the free monthly allowance is never exceeded by surprise.
import { db } from "@/lib/db";
import { providerCredentials } from "@/lib/provider-connections";
import { filterPlaces, GOOGLE_FIELD_MASK, googleGroups, googleNearbyBody, HOTEL_LAT, HOTEL_LON, mergePlaces, overpassQuery, parseGooglePlaces, parseOverpass, type NearbyPlace } from "@/lib/tv-nearby-core";

type Source = "google" | "osm";
let cache: { at: number; key: string; source: Source; places: NearbyPlace[] } | null = null;
const REFRESH_MS = 12 * 3_600_000;
const athensDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
const athensWeekday = () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date()));

export const googleDailyLimit = (v: unknown) => Math.min(500, Math.max(6, Math.round(Number(v) || 50)));

/** Reserves n Google calls for today; false when the daily limit would be passed. */
async function reserveGoogleCalls(ownerId: string, n: number, limit: number): Promise<boolean> {
  const r = await db().query(
    `INSERT INTO places_api_usage(owner_id,day,calls) VALUES($1,$2,$3) ON CONFLICT(owner_id,day) DO UPDATE SET calls=places_api_usage.calls+$3 WHERE places_api_usage.calls+$3<=$4 RETURNING calls`,
    [ownerId, athensDay(), n, limit],
  );
  return Boolean(r.rowCount) && n <= limit;
}

export async function placesUsage(ownerId: string): Promise<{ today: number; month: number }> {
  const day = athensDay();
  const r = (await db().query(`SELECT coalesce(sum(calls) FILTER (WHERE day=$2),0)::int today,coalesce(sum(calls),0)::int month FROM places_api_usage WHERE owner_id=$1 AND day LIKE $3`, [ownerId, day, `${day.slice(0, 7)}%`])).rows[0];
  return { today: Number(r?.today ?? 0), month: Number(r?.month ?? 0) };
}

export async function googleSearch(apiKey: string, types: string[], radiusKm: number, maxResults = 20): Promise<Response> {
  return fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": GOOGLE_FIELD_MASK },
    body: JSON.stringify({ ...googleNearbyBody(types, HOTEL_LAT, HOTEL_LON, radiusKm), maxResultCount: maxResults }),
    signal: AbortSignal.timeout(15_000),
  });
}

async function fromGoogle(ownerId: string, apiKey: string, limit: number, radiusKm: number): Promise<NearbyPlace[] | null> {
  if (!(await reserveGoogleCalls(ownerId, googleGroups.length, limit))) return null;
  const day = athensWeekday();
  const groups = await Promise.all(googleGroups.map(async (g) => {
    const r = await googleSearch(apiKey, g.types, radiusKm).catch(() => null);
    return r?.ok ? parseGooglePlaces(await r.json(), g.kind, HOTEL_LAT, HOTEL_LON, radiusKm, day) : null;
  }));
  return groups.every((g) => g === null) ? null : mergePlaces(groups.map((g) => g ?? []));
}

async function fromOsm(radiusKm: number): Promise<NearbyPlace[]> {
  const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "HotelCorali-TV/1.0 (booking.hotelcorali.gr)" }, body: `data=${encodeURIComponent(overpassQuery(HOTEL_LAT, HOTEL_LON, radiusKm))}`, signal: AbortSignal.timeout(15_000) });
  return r.ok ? parseOverpass(await r.json(), HOTEL_LAT, HOTEL_LON, radiusKm) : [];
}

/** The list for the assistant (no other accommodation, nothing on the hotel's hide list). A failure keeps the last list. */
export async function nearbyPlaces(ownerId: string, radiusKm: number, hide: string[]): Promise<{ source: Source; places: NearbyPlace[] }> {
  const g = await providerCredentials(ownerId, "googlePlaces").catch(() => null);
  const apiKey = g?.active ? g.secrets.apiKey : "";
  const key = `${apiKey ? "g" : "o"}:${radiusKm}`;
  if (!cache || cache.key !== key || Date.now() - cache.at >= REFRESH_MS) {
    try {
      const google = apiKey ? await fromGoogle(ownerId, apiKey, googleDailyLimit(g?.settings.dailyLimit), radiusKm) : null;
      const next = google ? { source: "google" as const, places: google } : { source: "osm" as const, places: await fromOsm(radiusKm) };
      if (next.places.length || !cache || cache.key !== key) cache = { at: Date.now(), key, ...next };
      else cache.at = Date.now() - REFRESH_MS + 3_600_000; // try again in an hour
    } catch {
      if (!cache || cache.key !== key) cache = { at: Date.now() - REFRESH_MS + 3_600_000, key, source: "osm", places: [] };
    }
  }
  return { source: cache.source, places: filterPlaces(cache.places, hide) };
}
