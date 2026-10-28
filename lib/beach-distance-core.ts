// Real distances for the TV assistant (pure; unit tested): beaches (and the hotel) found on Google Maps with Places
// Text Search inside Paros, then driving distance and time from the hotel with the Routes API route matrix.

/** Paros (with Antiparos strait): searches never leave the island. */
export const PAROS_BOX = { low: { latitude: 36.95, longitude: 25.05 }, high: { latitude: 37.17, longitude: 25.30 } };
export const TEXT_FIELD_MASK = "places.displayName,places.location,places.formattedAddress";
export const MATRIX_FIELD_MASK = "originIndex,destinationIndex,distanceMeters,duration,condition";

export type Found = { lat: number; lon: number; label: string };

/** "Πούντα (μετά τον Λογαρά)" → "Πούντα, παραλία, Λογαρά, Πάρος": the note in brackets helps Google pick the right one; "Α / Β" searches Α. */
export function beachQuery(name: string): string {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(name.trim());
  const base = (m ? m[1] : name).split("/")[0].trim(), hint = m ? m[2].replace(/μετά τον|μετά το|απέναντι από|κόλπος/gi, "").trim() : "";
  return [base, "παραλία", hint, "Πάρος"].filter(Boolean).join(", ");
}

export const textSearchBody = (query: string) => ({ textQuery: query, languageCode: "el", maxResultCount: 1, locationRestriction: { rectangle: PAROS_BOX } });

export function parseTextSearch(json: unknown): Found | null {
  const p = (json as { places?: { displayName?: { text?: string }; location?: { latitude: number; longitude: number }; formattedAddress?: string }[] } | null)?.places?.[0];
  if (!p?.location || !Number.isFinite(p.location.latitude) || !Number.isFinite(p.location.longitude)) return null;
  const label = [p.displayName?.text, p.formattedAddress].filter(Boolean).join(" · ").slice(0, 160);
  return { lat: Math.round(p.location.latitude * 1e6) / 1e6, lon: Math.round(p.location.longitude * 1e6) / 1e6, label };
}

const point = (lat: number, lon: number) => ({ waypoint: { location: { latLng: { latitude: lat, longitude: lon } } } });
export const matrixBody = (origin: { lat: number; lon: number }, dests: { lat: number; lon: number }[], mode: "DRIVE" | "WALK" = "DRIVE") => ({
  origins: [point(origin.lat, origin.lon)], destinations: dests.map((d) => point(d.lat, d.lon)), travelMode: mode, ...(mode === "DRIVE" ? { routingPreference: "TRAFFIC_UNAWARE" } : {}),
});

/** "37.0402, 25.2561" (as copied from Google Maps) → point inside Paros, else null. */
export function parseCoords(v: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/.exec(v);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return validCoord(lat, lon) ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 } : null;
}

/** Route matrix → per destination index { km (1 decimal), metres, minutes } — missing when Google found no route. */
export function parseMatrix(json: unknown): Map<number, { km: number; meters: number; minutes: number }> {
  const out = new Map<number, { km: number; meters: number; minutes: number }>();
  if (!Array.isArray(json)) return out;
  for (const e of json as { destinationIndex?: number; distanceMeters?: number; duration?: string; condition?: string }[]) {
    if (e.condition && e.condition !== "ROUTE_EXISTS") continue;
    const sec = Number(String(e.duration ?? "").replace(/s$/, ""));
    if (typeof e.destinationIndex !== "number" || !Number.isFinite(Number(e.distanceMeters)) || !Number.isFinite(sec)) continue;
    out.set(e.destinationIndex, { km: Math.round(Number(e.distanceMeters) / 100) / 10, meters: Math.round(Number(e.distanceMeters)), minutes: Math.max(1, Math.round(sec / 60)) });
  }
  return out;
}

export const validCoord = (lat: unknown, lon: unknown) => typeof lat === "number" && typeof lon === "number" && lat >= 36.9 && lat <= 37.2 && lon >= 25.0 && lon <= 25.35;
