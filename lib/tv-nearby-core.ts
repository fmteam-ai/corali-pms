// Places around the hotel for the TV assistant (pure; unit tested): restaurants, cafés, bars, bakeries, shops,
// pharmacies … from OpenStreetMap (Overpass API) within the radius set in PMS → Corali TV, with the distance from the
// hotel in metres and minutes on foot, so "near the hotel" answers are real places at real distances.

export const HOTEL_LAT = 37.0405;
export const HOTEL_LON = 25.2555;

export type NearbyKind = "restaurant" | "cafe" | "bar" | "fast_food" | "ice_cream" | "bakery" | "supermarket" | "pharmacy" | "health" | "atm" | "shop" | "beauty" | "car_rental" | "fuel" | "laundry" | "travel" | "sight";
export type NearbyPlace = { name: string; kind: NearbyKind; meters: number; walkMin: number; cuisine: string; hours: string; rating?: number; ratings?: number; price?: string; phone?: string; lat?: number; lon?: number; routed?: boolean; address?: string; website?: string; mapsUrl?: string; week?: string[] };

const kindLabels: Record<NearbyKind, string> = {
  restaurant: "Restaurants / taverns", cafe: "Cafés", bar: "Bars", fast_food: "Fast food / souvlaki", ice_cream: "Ice cream", bakery: "Bakeries / pastry",
  supermarket: "Supermarkets / mini markets", pharmacy: "Pharmacies", health: "Doctors / health", atm: "ATM / bank", shop: "Shops", beauty: "Hairdresser / beauty",
  car_rental: "Car / bike rental", fuel: "Petrol stations", laundry: "Laundry", travel: "Travel agencies / tickets", sight: "Sights",
};

/** Straight-line distance in metres. */
export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

/** Walking minutes: straight line × 1.3 for the streets, 4.8 km/h. */
export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 80));

export const clampRadiusKm = (v: unknown) => Math.min(5, Math.max(0.3, Math.round((Number(v) || 2) * 10) / 10));

export function overpassQuery(lat: number, lon: number, radiusKm: number): string {
  const a = `(around:${Math.round(clampRadiusKm(radiusKm) * 1000)},${lat},${lon})`;
  return `[out:json][timeout:20];(nwr${a}[name][amenity~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|pharmacy|atm|bank|doctors|clinic|dentist|hospital|car_rental|bicycle_rental|fuel)$"];nwr${a}[name][shop~"^(bakery|pastry|supermarket|convenience|kiosk|deli|butcher|greengrocer|beverages|wine|clothes|shoes|gift|souvenir|jewelry|beauty|hairdresser|art|books|laundry|dry_cleaning|travel_agency)$"];nwr${a}[name][tourism~"^(attraction|museum|viewpoint)$"];);out center tags 300;`;
}

// ───────────────────────────── never other accommodation ─────────────────────────────

/** Other hotels / rooms / villas are competitors: never listed (by map tags and by name), plus the hotel's own hide list. */
export const lodgingTypes = ["lodging", "hotel", "resort_hotel", "motel", "inn", "bed_and_breakfast", "guest_house", "hostel", "campground", "camping_cabin", "cottage", "farmstay", "private_guest_room", "extended_stay_hotel", "budget_japanese_inn", "japanese_inn", "mobile_home_park", "rv_park"];
const lodgingTourism = new Set(["hotel", "guest_house", "apartment", "hostel", "motel", "chalet", "camp_site", "caravan_site", "alpine_hut"]);
const lodgingWords = /\b(hotels?|rooms?|studios?|apartments?|apartaments?|suites?|villas?|residences?|resorts?|pensions?|hostels?|camping|airbnb|maisonettes?|bungalows?)\b|ξενοδοχ|δωμάτι|δωματι|στούντιο|στουντιο|διαμερίσματ|βίλ[αε]|βιλ[αε]|πανσιόν|πανσιον|κάμπινγκ|καμπινγκ|ενοικιαζόμεν|ενοικιαζομεν/i;

export const looksLikeLodging = (name: string) => lodgingWords.test(name);

/** "name1, name2" from the PMS → lower-case words / names to hide. */
export const hideList = (v: unknown): string[] => (typeof v === "string" ? v.split(/[,\n]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2).slice(0, 50) : []);
export const hiddenByList = (name: string, hide: string[]) => { const n = name.toLowerCase(); return hide.some((h) => n.includes(h)); };

/** Final filter for both sources: no accommodation, nothing on the hotel's hide list. */
export const filterPlaces = (places: NearbyPlace[], hide: string[] = []) => places.filter((p) => !looksLikeLodging(p.name) && !hiddenByList(p.name, hide));

function kindOf(t: Record<string, string>): NearbyKind | null {
  const a = t.amenity, s = t.shop;
  if (a === "restaurant") return "restaurant";
  if (a === "cafe") return "cafe";
  if (a === "bar" || a === "pub") return "bar";
  if (a === "fast_food") return "fast_food";
  if (a === "ice_cream") return "ice_cream";
  if (a === "pharmacy") return "pharmacy";
  if (a === "atm" || a === "bank") return "atm";
  if (a === "doctors" || a === "clinic" || a === "dentist" || a === "hospital") return "health";
  if (a === "car_rental" || a === "bicycle_rental") return "car_rental";
  if (a === "fuel") return "fuel";
  if (s === "laundry" || s === "dry_cleaning") return "laundry";
  if (s === "travel_agency") return "travel";
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
    if (lodgingTourism.has(t.tourism ?? "") || t.building === "hotel") continue;
    if (!name || la === undefined || lo === undefined || !kind) continue;
    const meters = metersBetween(lat, lon, la, lo);
    const key = `${kind}:${name.toLowerCase()}`;
    if (meters > max || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind, meters, walkMin: walkMinutes(meters), cuisine: (t.cuisine ?? "").replace(/;/g, ", ").replace(/_/g, " ").slice(0, 60), hours: (t.opening_hours ?? "").slice(0, 80), lat: la, lon: lo,
      ...(t.phone ? { phone: t.phone.slice(0, 40) } : {}), ...(t.website && /^https?:\/\//.test(t.website) ? { website: t.website.slice(0, 300) } : {}), ...(t["addr:street"] ? { address: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ").slice(0, 120) } : {}) });
  }
  return out.sort((a, b) => a.meters - b.meters);
}

// ───────────────────────────── Google Places (New) · Nearby Search ─────────────────────────────

/** One request per group (6 per refresh); ratings + price level make it the "Enterprise" SKU (1,000 free / month). */
export const googleGroups: { kind: NearbyKind; types: string[] }[] = [
  { kind: "restaurant", types: ["restaurant"] },
  { kind: "cafe", types: ["cafe", "coffee_shop"] },
  { kind: "bar", types: ["bar", "night_club"] },
  { kind: "bakery", types: ["bakery", "ice_cream_shop"] },
  { kind: "supermarket", types: ["supermarket", "grocery_store", "convenience_store", "liquor_store"] },
  { kind: "pharmacy", types: ["pharmacy", "drugstore"] },
  { kind: "health", types: ["doctor", "hospital", "dentist", "medical_lab", "physiotherapist"] },
  { kind: "atm", types: ["atm", "bank"] },
  { kind: "shop", types: ["clothing_store", "gift_shop", "jewelry_store", "shoe_store", "book_store", "store", "market"] },
  { kind: "beauty", types: ["beauty_salon", "hair_care", "spa", "nail_salon"] },
  { kind: "car_rental", types: ["car_rental"] },
  { kind: "travel", types: ["travel_agency", "tour_agency", "gas_station", "laundry"] },
];
export const GOOGLE_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.googleMapsUri,places.location,places.primaryType,places.types,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours.weekdayDescriptions,places.nationalPhoneNumber,places.businessStatus";

export function googleNearbyBody(types: string[], lat: number, lon: number, radiusKm: number, lang = "el") {
  return { includedTypes: types, excludedTypes: lodgingTypes, maxResultCount: 20, rankPreference: "DISTANCE", languageCode: lang, locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.round(clampRadiusKm(radiusKm) * 1000) } } };
}

const priceLevels: Record<string, string> = { PRICE_LEVEL_FREE: "free", PRICE_LEVEL_INEXPENSIVE: "€", PRICE_LEVEL_MODERATE: "€€", PRICE_LEVEL_EXPENSIVE: "€€€", PRICE_LEVEL_VERY_EXPENSIVE: "€€€€" };
const typeKind: Record<string, NearbyKind> = { ice_cream_shop: "ice_cream", atm: "atm", bank: "atm", night_club: "bar", coffee_shop: "cafe", gas_station: "fuel", laundry: "laundry", travel_agency: "travel", tour_agency: "travel", fast_food_restaurant: "fast_food" };

/** Google's weekday lines start on Monday; JS getDay() starts on Sunday. */
export const todayLine = (lines: unknown, jsDay: number): string => (Array.isArray(lines) ? String(lines[(jsDay + 6) % 7] ?? "") : "").replace(/^[^:]+:\s*/, "").slice(0, 80);

export function parseGooglePlaces(json: unknown, kind: NearbyKind, lat: number, lon: number, radiusKm: number, jsDay: number): NearbyPlace[] {
  const list = (json as { places?: unknown[] } | null)?.places;
  if (!Array.isArray(list)) return [];
  const max = clampRadiusKm(radiusKm) * 1000;
  return (list as { id?: string; formattedAddress?: string; websiteUri?: string; googleMapsUri?: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number }; primaryType?: string; types?: string[]; rating?: number; userRatingCount?: number; priceLevel?: string; regularOpeningHours?: { weekdayDescriptions?: string[] }; nationalPhoneNumber?: string; businessStatus?: string }[]).flatMap((p) => {
    const name = (p.displayName?.text ?? "").trim().slice(0, 80);
    if (!name || !p.location || (p.businessStatus && p.businessStatus !== "OPERATIONAL")) return [];
    if ((p.types ?? []).some((t) => lodgingTypes.includes(t)) || lodgingTypes.includes(p.primaryType ?? "")) return [];
    const meters = metersBetween(lat, lon, p.location.latitude, p.location.longitude);
    if (meters > max) return [];
    return [{ name, kind: typeKind[p.primaryType ?? ""] ?? kind, meters, walkMin: walkMinutes(meters), cuisine: (p.primaryType ?? "").replace(/_/g, " ").replace(/ restaurant$/, "").slice(0, 40), hours: todayLine(p.regularOpeningHours?.weekdayDescriptions, jsDay),
      ...(typeof p.rating === "number" ? { rating: p.rating, ratings: Number(p.userRatingCount ?? 0) } : {}), ...(p.priceLevel && priceLevels[p.priceLevel] ? { price: priceLevels[p.priceLevel] } : {}), ...(p.nationalPhoneNumber ? { phone: p.nationalPhoneNumber } : {}),
      lat: p.location.latitude, lon: p.location.longitude, ...(p.formattedAddress ? { address: p.formattedAddress.replace(/,\s*(Ελλάδα|Greece)$/, "").slice(0, 120) } : {}),
      ...(p.websiteUri && /^https?:\/\//.test(p.websiteUri) ? { website: p.websiteUri.slice(0, 300) } : {}), ...(p.googleMapsUri && p.googleMapsUri.startsWith("https://") ? { mapsUrl: p.googleMapsUri.slice(0, 300) } : {}),
      ...(Array.isArray(p.regularOpeningHours?.weekdayDescriptions) ? { week: p.regularOpeningHours!.weekdayDescriptions!.slice(0, 7).map((x) => String(x).slice(0, 80)) } : {}) }];
  });
}

/** Today's hours for places that carry their week (the list is cached for a day or more). */
export const withToday = (places: NearbyPlace[], jsDay: number): NearbyPlace[] => places.map((p) => (p.week ? { ...p, hours: todayLine(p.week, jsDay) } : p));

/** Merge per-group results: nearest first, no duplicates by name. */
export function mergePlaces(groups: NearbyPlace[][]): NearbyPlace[] {
  const seen = new Set<string>();
  return groups.flat().sort((a, b) => a.meters - b.meters).filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Context block for the assistant, grouped by kind, at most `perKind` per group. */
export function nearbyText(places: NearbyPlace[], radiusKm: number, perKind = 12, source: "osm" | "google" = "osm"): string {
  if (!places.length) return `NEARBY PLACES: (no data from OpenStreetMap right now — you may search the web; say distances are approximate)`;
  const groups = (Object.keys(kindLabels) as NearbyKind[]).map((k) => {
    const ps = places.filter((p) => p.kind === k).slice(0, perKind);
    return ps.length ? `${kindLabels[k]}: ${ps.map((p) => `${p.name} (${p.routed ? `${p.meters} m walking route, ${p.walkMin} min on foot` : `~${p.meters} m straight line, ~${p.walkMin} min walk`}${p.rating ? `, ★${p.rating.toFixed(1)} (${p.ratings} reviews)` : ""}${p.price ? `, ${p.price}` : ""}${p.cuisine ? `, ${p.cuisine}` : ""}${p.hours ? `, ${source === "google" ? "today" : "hours"} ${p.hours}` : ""})`).join(" · ")}` : "";
  }).filter(Boolean);
  return `NEARBY PLACES (${source === "google" ? "Google Maps" : "OpenStreetMap"}, within ${clampRadiusKm(radiusKm)} km of the hotel; distances are walking routes from the hotel unless marked straight line — use them as given, do not change them)
${groups.join("\n")}
Never recommend or name other accommodation (hotels, rooms to let, studios, villas, apartments, Airbnb) — not from this list, not from the web.
When the guest asks for something near the hotel or within walking distance, recommend from this list first and always say both the distance and the walking time (e.g. "350 m, 5 minutes on foot")${source === "google" ? "; prefer well-rated places and mention the rating and today's hours when useful" : ""}. You may search the web for reviews / opening times; the list may miss a few places and some may be closed out of season — say so if unsure.`;
}

// ───────────────────────────── map cards on the TV ─────────────────────────────

/** A place or beach the assistant may mention, with what the TV card shows. */
export type Spot = { name: string; icon: string; lat: number; lon: number; line: string; directions: string };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Places / beaches named in the assistant's reply, in the order they appear (at most `max`). */
export function mentionedSpots(reply: string, spots: Spot[], max = 4): Spot[] {
  const text = fold(reply), seen = new Set<string>();
  return spots
    .map((s) => { const base = fold(s.name.split(" (")[0].split("/")[0].trim()); return { s, at: base.length >= 4 ? text.indexOf(base) : -1 }; })
    .filter((x) => x.at >= 0 && !seen.has(x.s.name) && seen.add(x.s.name))
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((x) => x.s);
}

export const directionsUrl = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, walk: boolean) =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&travelmode=${walk ? "walking" : "driving"}`;
