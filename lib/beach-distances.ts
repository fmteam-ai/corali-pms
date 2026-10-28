// PMS → Corali TV: find the hotel and the beaches on Google Maps and fill in the real driving distance / time from the
// hotel (Places Text Search + Routes route matrix, with the Google Places key). Calls are counted with the nearby ones.
import { providerCredentials } from "@/lib/provider-connections";
import { recordGoogleCalls } from "@/lib/nearby-places";
import { beachQuery, MATRIX_FIELD_MASK, matrixBody, parseMatrix, parseTextSearch, TEXT_FIELD_MASK, textSearchBody, type Found } from "@/lib/beach-distance-core";
import type { TvBeach } from "@/lib/tv-beaches";

async function googleKey(ownerId: string) {
  const g = await providerCredentials(ownerId, "googlePlaces");
  if (!g?.active || !g.secrets.apiKey) throw Error("NO_GOOGLE_KEY");
  return { key: g.secrets.apiKey };
}

async function find(key: string, query: string): Promise<Found | null> {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": TEXT_FIELD_MASK }, body: JSON.stringify(textSearchBody(query)), signal: AbortSignal.timeout(15_000) });
  if (r.status === 403) throw Error("GOOGLE_DENIED");
  return r.ok ? parseTextSearch(await r.json()) : null;
}

/** The hotel on Google Maps (default query: "Hotel Corali Piso Livadi"). */
export async function locateHotel(ownerId: string, query: string): Promise<Found> {
  const { key } = await googleKey(ownerId);
  await recordGoogleCalls(ownerId, 1);
  const f = await find(key, query.trim() || "Hotel Corali, Πίσω Λιβάδι, Πάρος");
  if (!f) throw Error("NOT_FOUND");
  return f;
}

/**
 * Beaches without a map point are searched (a renamed beach has lost its point in the PMS), then one route matrix gives
 * driving km and minutes from the hotel for all of them. Beaches Google could not find keep their values.
 */
export async function beachDistances(ownerId: string, beaches: TvBeach[], hotel: { lat: number; lon: number }): Promise<{ beaches: TvBeach[]; notFound: string[]; calls: number }> {
  const { key } = await googleKey(ownerId);
  const missing = beaches.filter((b) => b.lat === undefined || b.lon === undefined);
  const needed = missing.length + (beaches.length ? 1 : 0);
  await recordGoogleCalls(ownerId, needed);
  const out: TvBeach[] = [], notFound: string[] = [];
  for (const b of beaches) {
    if (b.lat !== undefined && b.lon !== undefined) { out.push({ ...b }); continue; }
    const f = await find(key, beachQuery(b.name)).catch((e) => { if (e instanceof Error && e.message === "GOOGLE_DENIED") throw e; return null; });
    if (f) out.push({ ...b, lat: f.lat, lon: f.lon, found: f.label }); else { notFound.push(b.name); out.push({ ...b }); }
  }
  const placed = out.map((b, i) => ({ b, i })).filter((x) => x.b.lat !== undefined && x.b.lon !== undefined);
  if (placed.length) {
    const r = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": MATRIX_FIELD_MASK }, body: JSON.stringify(matrixBody(hotel, placed.map((x) => ({ lat: x.b.lat!, lon: x.b.lon! })))), signal: AbortSignal.timeout(20_000) });
    if (r.status === 403) throw Error("ROUTES_DENIED");
    const m = r.ok ? parseMatrix(await r.json()) : new Map();
    placed.forEach((x, j) => { const d = m.get(j); if (d) out[x.i] = { ...out[x.i], km: d.km, minutes: d.minutes }; });
    // On foot too, for the beaches within 3 km by road.
    const near = placed.filter((x) => out[x.i].km > 0 && out[x.i].km <= 3);
    if (near.length) {
      await recordGoogleCalls(ownerId, 1);
      const w = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": MATRIX_FIELD_MASK }, body: JSON.stringify(matrixBody(hotel, near.map((x) => ({ lat: x.b.lat!, lon: x.b.lon! })), "WALK")), signal: AbortSignal.timeout(20_000) }).catch(() => null);
      const wm = w?.ok ? parseMatrix(await w.json()) : new Map();
      near.forEach((x, j) => { const d = wm.get(j); if (d) out[x.i] = { ...out[x.i], walkMin: d.minutes }; });
    }
  }
  return { beaches: out, notFound, calls: needed };
}
