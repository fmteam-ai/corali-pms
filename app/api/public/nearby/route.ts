import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { bookingForToken } from "@/lib/guest-self-service";
import { nearbyPlaces } from "@/lib/nearby-places";
import { loadTvSettings } from "@/lib/tv";
import { hideList } from "@/lib/tv-nearby-core";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, max-age=300" } });

/** "My booking" → Near the hotel: shops and services within the radius set in PMS → Corali TV (same list as the TV). */
export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("token") ?? "";
  const b = t.length >= 32 && t.length <= 200 ? await bookingForToken(db(), t) : null;
  if (!b) return json({ ok: false, error: "INVALID_TOKEN" }, 401);
  const owner = env().PMS_OWNER_ID, s = await loadTvSettings(owner);
  const near = await nearbyPlaces(owner, s.nearbyRadiusKm, hideList(s.nearbyHide), { lat: s.hotelLat, lon: s.hotelLon }).catch(() => ({ source: "osm" as const, places: [] }));
  return json({ ok: true, source: near.source, radiusKm: s.nearbyRadiusKm, hotel: { lat: s.hotelLat, lon: s.hotelLon }, places: near.places.map(({ week: _week, ...p }) => p) });
}
