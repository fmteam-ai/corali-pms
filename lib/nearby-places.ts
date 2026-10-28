// Places near the hotel for the TV assistant and the guest app: Google Places (New) when PMS → Integrations → Google Places has a key,
// else OpenStreetMap. Google calls are counted per day and stop at the
// hotel's daily limit (then OpenStreetMap is used), so the free monthly allowance is never exceeded by surprise.
// Refreshed once a day: 12 category searches + a few walking route matrices, shared by the TVs and "My booking".
import { db } from "@/lib/db";
import { MATRIX_FIELD_MASK, matrixBody, parseMatrix } from "@/lib/beach-distance-core";
import { providerCredentials } from "@/lib/provider-connections";
import { filterPlaces, GOOGLE_FIELD_MASK, googleGroups, googleNearbyBody, mergePlaces, overpassQuery, withToday, parseGooglePlaces, parseOverpass, type NearbyPlace } from "@/lib/tv-nearby-core";

type Source = "google" | "osm";
const REFRESH_MS = 24 * 3_600_000;
const athensDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
const athensWeekday = () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date()));

export const googleDailyLimit = (v: unknown) => Math.min(500, Math.max(6, Math.round(Number(v) || 50)));

/**
 * Reserves n automatic Google calls for today (the daily refresh of nearby places); false past the hotel's daily limit.
 * Calls started by hand in the PMS (locate hotel, beach distances, connection test) are only recorded, so they never
 * use up the automatic refresh.
 */
export async function reserveGoogleCalls(ownerId: string, n: number, limit: number): Promise<boolean> {
  const r = await db().query(
    `INSERT INTO places_api_usage(owner_id,day,calls,auto_calls) VALUES($1,$2,$3,$3) ON CONFLICT(owner_id,day) DO UPDATE SET calls=places_api_usage.calls+$3,auto_calls=places_api_usage.auto_calls+$3 WHERE places_api_usage.auto_calls+$3<=$4 RETURNING calls`,
    [ownerId, athensDay(), n, limit],
  );
  return Boolean(r.rowCount) && n <= limit;
}

export async function recordGoogleCalls(ownerId: string, n: number): Promise<void> {
  await db().query(`INSERT INTO places_api_usage(owner_id,day,calls) VALUES($1,$2,$3) ON CONFLICT(owner_id,day) DO UPDATE SET calls=places_api_usage.calls+$3`, [ownerId, athensDay(), n]);
}

export async function placesUsage(ownerId: string): Promise<{ today: number; month: number }> {
  const day = athensDay();
  const r = (await db().query(`SELECT coalesce(sum(calls) FILTER (WHERE day=$2),0)::int today,coalesce(sum(calls),0)::int month FROM places_api_usage WHERE owner_id=$1 AND day LIKE $3`, [ownerId, day, `${day.slice(0, 7)}%`])).rows[0];
  return { today: Number(r?.today ?? 0), month: Number(r?.month ?? 0) };
}

export type At = { lat: number; lon: number };

export async function googleSearch(apiKey: string, types: string[], radiusKm: number, at: At, maxResults = 20): Promise<Response> {
  return fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": GOOGLE_FIELD_MASK },
    body: JSON.stringify({ ...googleNearbyBody(types, at.lat, at.lon, radiusKm), maxResultCount: maxResults }),
    signal: AbortSignal.timeout(15_000),
  });
}

async function fromGoogle(ownerId: string, apiKey: string, limit: number, radiusKm: number, at: At): Promise<{ places: NearbyPlace[]; note: string } | null> {
  if (!(await reserveGoogleCalls(ownerId, googleGroups.length, limit))) return null;
  const day = athensWeekday();
  const groups = await Promise.all(googleGroups.map(async (g) => {
    const r = await googleSearch(apiKey, g.types, radiusKm, at).catch(() => null);
    return r?.ok ? parseGooglePlaces(await r.json(), g.kind, at.lat, at.lon, radiusKm, day) : null;
  }));
  if (groups.every((g) => g === null)) return null;
  return walkingDistances(ownerId, apiKey, limit, mergePlaces(groups.map((g) => g ?? [])), at);
}

/**
 * Real walking distance and time from the hotel (Routes API route matrix, 25 places per call, nearest 12 of each kind).
 * Without Routes API on the key, or past the daily limit, the straight-line distance stays (walk time × 1.3 for streets).
 */
async function walkingDistances(ownerId: string, apiKey: string, limit: number, places: NearbyPlace[], at: At): Promise<{ places: NearbyPlace[]; note: string }> {
  const perKind = new Map<string, number>();
  const pick = places.map((p, i) => ({ p, i })).filter(({ p }) => { const n = (perKind.get(p.kind) ?? 0) + 1; perKind.set(p.kind, n); return n <= 12 && p.lat !== undefined && p.lon !== undefined; });
  const batches: typeof pick[] = [];
  for (let i = 0; i < pick.length; i += 25) batches.push(pick.slice(i, i + 25));
  if (!batches.length) return { places, note: "" };
  if (!(await reserveGoogleCalls(ownerId, batches.length, limit))) return { places, note: "ROUTES_DAILY_LIMIT" };
  const out = [...places];
  let note = "";
  for (const batch of batches) {
    const r = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": MATRIX_FIELD_MASK }, body: JSON.stringify(matrixBody(at, batch.map(({ p }) => ({ lat: p.lat!, lon: p.lon! })), "WALK")), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!r?.ok) { note = r ? `ROUTES_HTTP_${r.status}` : "ROUTES_NETWORK"; break; }
    const m = parseMatrix(await r.json());
    batch.forEach(({ i }, j) => { const d = m.get(j); if (d) out[i] = { ...out[i], meters: d.meters, walkMin: d.minutes, routed: true }; });
  }
  return { places: out.sort((a, b) => a.meters - b.meters), note };
}

async function fromOsm(radiusKm: number, at: At): Promise<NearbyPlace[]> {
  const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "HotelCorali-TV/1.0 (booking.hotelcorali.gr)" }, body: `data=${encodeURIComponent(overpassQuery(at.lat, at.lon, radiusKm))}`, signal: AbortSignal.timeout(15_000) });
  return r.ok ? parseOverpass(await r.json(), at.lat, at.lon, radiusKm) : [];
}

/**
 * The shared list for the TV assistant and "My booking" (no other accommodation, nothing on the hotel's hide list).
 * Kept in the database for a day (one refresh = one call per category); one server refreshes at a time and a
 * failure keeps the last list.
 */
export type NearbyState = { source: Source; places: NearbyPlace[]; note: string; fetchedAt: number };

export async function nearbyPlaces(ownerId: string, radiusKm: number, hide: string[], at: At, force = false): Promise<NearbyState> {
  const g = await providerCredentials(ownerId, "googlePlaces").catch(() => null);
  const apiKey = g?.active ? g.secrets.apiKey : "";
  const key = `v2:${apiKey ? "g" : "o"}:${radiusKm}:${at.lat},${at.lon}`;
  const now = Date.now();
  const row = (await db().query(`SELECT cache_key,source,places_json,fetched_at,note FROM nearby_places_cache WHERE owner_id=$1`, [ownerId])).rows[0];
  let source: Source = row?.source === "google" ? "google" : "osm";
  let places: NearbyPlace[] = row ? (() => { try { return JSON.parse(String(row.places_json)); } catch { return []; } })() : [];
  let note = String(row?.note ?? ""), fetchedAt = Number(row?.fetched_at ?? 0);
  // A list without walking routes (e.g. Routes API off, daily limit) is retried after an hour, not a day.
  const age = note ? 3_600_000 : REFRESH_MS;
  const fresh = !force && row && row.cache_key === key && now - fetchedAt < age;
  if (!fresh) {
    const claim = await db().query(
      `INSERT INTO nearby_places_cache(owner_id,cache_key,source,places_json,fetched_at,refreshing_until) VALUES($1,'','osm','[]',0,$2) ON CONFLICT(owner_id) DO UPDATE SET refreshing_until=$2 WHERE nearby_places_cache.refreshing_until<$3::bigint RETURNING owner_id`,
      [ownerId, now + 90_000, now],
    );
    if (claim.rowCount) {
      try {
        const google = apiKey ? await fromGoogle(ownerId, apiKey, googleDailyLimit(g?.settings.dailyLimit), radiusKm, at) : null;
        const next = google ? { source: "google" as const, ...google } : { source: "osm" as const, places: await fromOsm(radiusKm, at), note: apiKey ? "GOOGLE_FAILED_OR_LIMIT" : "" };
        if (next.places.length || row?.cache_key !== key) {
          ({ source, places, note } = next);
          fetchedAt = now;
          await db().query(`UPDATE nearby_places_cache SET cache_key=$2,source=$3,places_json=$4,fetched_at=$5,note=$6,refreshing_until=0 WHERE owner_id=$1`, [ownerId, key, source, JSON.stringify(places), now, note]);
        } else await db().query(`UPDATE nearby_places_cache SET fetched_at=$2,note=$3,refreshing_until=0 WHERE owner_id=$1`, [ownerId, now - REFRESH_MS + 3_600_000, next.note || "EMPTY"]);
      } catch {
        await db().query(`UPDATE nearby_places_cache SET refreshing_until=$2 WHERE owner_id=$1`, [ownerId, now + 3_600_000]);
      }
    }
  }
  return { source, places: filterPlaces(withToday(places, athensWeekday()), hide), note, fetchedAt };
}
