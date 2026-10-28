// Places around the hotel for the TV assistant (pure; unit tested): restaurants, cafés, bars, bakeries, shops,
// pharmacies … from OpenStreetMap (Overpass API) within the radius set in PMS → Corali TV, with the distance from the
// hotel in metres and minutes on foot, so "near the hotel" answers are real places at real distances.

export const HOTEL_LAT = 37.0405;
export const HOTEL_LON = 25.2555;

export type NearbyKind = "restaurant" | "cafe" | "bar" | "fast_food" | "ice_cream" | "bakery" | "supermarket" | "pharmacy" | "atm" | "shop" | "beauty" | "sight";
export type NearbyPlace = { name: string; kind: NearbyKind; meters: number; walkMin: number; cuisine: string; hours: string };

const kindLabels: Record<NearbyKind, string> = {
  restaurant: "Restaurants / taverns", cafe: "Cafés", bar: "Bars", fast_food: "Fast food / souvlaki", ice_cream: "Ice cream", bakery: "Bakeries / pastry",
  supermarket: "Supermarkets / mini markets", pharmacy: "Pharmacies", atm: "ATM / bank", shop: "Shops", beauty: "Hairdresser / beauty", sight: "Sights",
};

/** Straight-line distance in metres. */
export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

/** Walking minutes: straight line × 1.3 for the streets, 4.8 km/h. */
export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 80));

export const clampRadiusKm = (v: unknown) => Math.min(5, Math.max(0.3, Math.round((Number(v) || 1) * 10) / 10));

export function overpassQuery(lat: number, lon: number, radiusKm: number): string {
  const a = `(around:${Math.round(clampRadiusKm(radiusKm) * 1000)},${lat},${lon})`;
  return `[out:json][timeout:20];(nwr${a}[name][amenity~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|pharmacy|atm|bank)$"];nwr${a}[name][shop~"^(bakery|pastry|supermarket|convenience|kiosk|deli|butcher|greengrocer|beverages|wine|clothes|shoes|gift|souvenir|jewelry|beauty|hairdresser|art|books)$"];nwr${a}[name][tourism~"^(attraction|museum|viewpoint)$"];);out center tags 300;`;
}

function kindOf(t: Record<string, string>): NearbyKind | null {
  const a = t.amenity, s = t.shop;
  if (a === "restaurant") return "restaurant";
  if (a === "cafe") return "cafe";
  if (a === "bar" || a === "pub") return "bar";
  if (a === "fast_food") return "fast_food";
  if (a === "ice_cream") return "ice_cream";
  if (a === "pharmacy") return "pharmacy";
  if (a === "atm" || a === "bank") return "atm";
  if (s === "bakery" || s === "pastry") return "bakery";
  if (s === "supermarket" || s === "convenience" || s === "kiosk" || s === "greengrocer" || s === "butcher" || s === "deli" || s === "beverages" || s === "wine") return "supermarket";
  if (s === "beauty" || s === "hairdresser") return "beauty";
  if (s) return "shop";
  if (t.tourism) return "sight";
  return null;
}

/** Overpass JSON → named places within the radius, nearest first (duplicates by name + kind removed). */
export function parseOverpass(json: unknown, lat: number, lon: number, radiusKm: number): NearbyPlace[] {
  const els = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const max = clampRadiusKm(radiusKm) * 1000, seen = new Set<string>(), out: NearbyPlace[] = [];
  for (const e of els as { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[]) {
    const t = e.tags ?? {}, name = (t["name:el"] || t.name || t["name:en"] || "").trim().slice(0, 80);
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, kind = kindOf(t);
    if (!name || la === undefined || lo === undefined || !kind) continue;
    const meters = metersBetween(lat, lon, la, lo);
    const key = `${kind}:${name.toLowerCase()}`;
    if (meters > max || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind, meters, walkMin: walkMinutes(meters), cuisine: (t.cuisine ?? "").replace(/;/g, ", ").replace(/_/g, " ").slice(0, 60), hours: (t.opening_hours ?? "").slice(0, 80) });
  }
  return out.sort((a, b) => a.meters - b.meters);
}

/** Context block for the assistant, grouped by kind, at most `perKind` per group. */
export function nearbyText(places: NearbyPlace[], radiusKm: number, perKind = 12): string {
  if (!places.length) return `NEARBY PLACES: (no data from OpenStreetMap right now — you may search the web; say distances are approximate)`;
  const groups = (Object.keys(kindLabels) as NearbyKind[]).map((k) => {
    const ps = places.filter((p) => p.kind === k).slice(0, perKind);
    return ps.length ? `${kindLabels[k]}: ${ps.map((p) => `${p.name} (${p.meters} m, ~${p.walkMin} min walk${p.cuisine ? `, ${p.cuisine}` : ""}${p.hours ? `, hours ${p.hours}` : ""})`).join(" · ")}` : "";
  }).filter(Boolean);
  return `NEARBY PLACES (OpenStreetMap, within ${clampRadiusKm(radiusKm)} km of the hotel; metres in a straight line, minutes on foot)
${groups.join("\n")}
When the guest asks for something near the hotel or within walking distance, recommend from this list first and say the distance (metres and minutes on foot). You may search the web for reviews / opening times; the list may miss a few places and some may be closed out of season — say so if unsure.`;
}
