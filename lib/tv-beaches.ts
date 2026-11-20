// Beaches for the TV assistant (pure; unit tested): the hotel's list with the winds each beach is sheltered from, and
// the wind as Greek sailors name it, so the assistant can send guests to a calm beach on a meltemi day.

import { validCoord } from "./beach-distance-core.ts";

export const windDirections = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type WindDirection = (typeof windDirections)[number];

/** Traditional Greek names (Βοριάς = north …) and English, for the PMS and the assistant's context. */
export const windNames: Record<WindDirection, { el: string; en: string }> = {
  N: { el: "Βοριάς", en: "north" }, NE: { el: "Γραίγος", en: "north-east" }, E: { el: "Λεβάντες", en: "east" }, SE: { el: "Σορόκος", en: "south-east" },
  S: { el: "Νότος", en: "south" }, SW: { el: "Γαρμπής", en: "south-west" }, W: { el: "Πουνέντες", en: "west" }, NW: { el: "Μαΐστρος", en: "north-west" },
};

/** Degrees the wind comes FROM (meteorological) → one of 8 directions. */
export function compass(deg: number): WindDirection {
  const d = ((Number(deg) % 360) + 360) % 360;
  return windDirections[Math.round(d / 45) % 8];
}

export type TvBeach = { name: string; minutes: number; km: number; sheltered: WindDirection[]; note: string; lat?: number; lon?: number; found?: string; walkMin?: number };

/**
 * Starting list around Piso Livadi (east Paros). A beach is "sheltered" from a wind that blows from the land side or
 * is blocked by a headland. The hotel should check and correct it in PMS → Corali TV — local knowledge wins.
 */
export const defaultBeaches: TvBeach[] = [
  { name: "Πίσω Λιβάδι", minutes: 2, km: 0.2, sheltered: ["N", "NW", "W"], note: "Η παραλία του χωριού, μπροστά στο ξενοδοχείο." },
  { name: "Λογαράς", minutes: 1, km: 0.3, sheltered: ["N", "NW", "W"], note: "Αμμώδης, ρηχά νερά, ταβέρνες· καλή επιλογή με μελτέμι." },
  { name: "Δρυός / Λολαντώνης", minutes: 15, km: 8, sheltered: ["N", "NW", "W"], note: "Νοτιοανατολικά, μικροί κόλποι." },
  { name: "Φάραγγας", minutes: 18, km: 14, sheltered: ["N", "NE", "NW"], note: "Νότια παραλία, συνήθως ήρεμη με βοριά." },
  { name: "Αλυκή / Πίσω Αλυκή", minutes: 25, km: 20, sheltered: ["N", "NE", "NW"], note: "Νότια, κοντά στο χωριό Αλυκή." },
  { name: "Κρυός (κόλπος Παροικιάς)", minutes: 30, km: 18, sheltered: ["N", "NE", "E"], note: "Απέναντι από την Παροικιά, με καΐκι από το λιμάνι." },
  { name: "Χρυσή Ακτή", minutes: 10, km: 5, sheltered: ["W", "SW", "NW"], note: "Με βοριά/μελτέμι έχει δυνατό αέρα — ιδανική για windsurf." },
  { name: "Πούντα (μετά τον Λογαρά)", minutes: 7, km: 2, sheltered: ["N", "NW", "W"], note: "Νότια του Λογαρά, στην ανατολική ακτή· δεν την πιάνει ο βοριάς." },
  { name: "Πούντα (δυτική, απέναντι από Αντίπαρο)", minutes: 30, km: 22, sheltered: ["E", "SE"], note: "Κοντά στο λιμανάκι για Αντίπαρο· spot για kitesurf, ανοιχτή στο μελτέμι." },
  { name: "Μώλος", minutes: 10, km: 4, sheltered: ["W", "SW", "S"], note: "Βόρεια της Μάρπησσας, ανοιχτή στον βοριά." },
  { name: "Κολυμπήθρες", minutes: 30, km: 16, sheltered: ["E", "SE", "S"], note: "Βράχια-γλυπτά στον κόλπο της Νάουσας." },
  { name: "Σάντα Μαρία / Λαγκέρι", minutes: 30, km: 16, sheltered: ["S", "SW", "W"], note: "Βορειοανατολικά της Νάουσας, εκτεθειμένες στο μελτέμι." },
];

/**
 * The rest of Paros (indicative, by which way each beach faces): added to the hotel's list with one button in the PMS,
 * so the assistant can suggest every suitable beach of the island, not only the nearest.
 */
export const parosBeaches: TvBeach[] = [
  { name: "Νέα Χρυσή Ακτή (Τσερδάκια)", minutes: 12, km: 6, sheltered: ["W", "SW"], note: "Ανατολική ακτή· με μελτέμι φυσάει — για windsurf / kite." },
  { name: "Γλυφά", minutes: 15, km: 9, sheltered: ["N", "NW", "W"], note: "Νοτιοανατολικά, κοντά στον Δρυό· ήσυχη." },
  { name: "Τρυπητή", minutes: 16, km: 10, sheltered: ["N", "NW", "W"], note: "Νοτιοανατολικά, μικρός κόλπος." },
  { name: "Καλόγερος", minutes: 12, km: 5, sheltered: ["W", "SW", "S"], note: "Ανατολική ακτή κοντά στον Μώλο, βράχια και άργιλος." },
  { name: "Αμπελάς", minutes: 20, km: 12, sheltered: ["W", "SW", "S"], note: "Βορειοανατολικά, μικρό ψαροχώρι με ταβέρνες." },
  { name: "Πιπέρι (Νάουσα)", minutes: 25, km: 14, sheltered: ["S", "SE", "SW"], note: "Μέσα στη Νάουσα· ανοιχτή στον βοριά." },
  { name: "Μοναστήρι", minutes: 32, km: 17, sheltered: ["N", "NW", "W"], note: "Στον κόλπο της Νάουσας, με beach bar· προστατευμένη." },
  { name: "Λιβάδια (Παροικιά)", minutes: 25, km: 16, sheltered: ["S", "SE", "E"], note: "Η παραλία της Παροικιάς, κοντά στο λιμάνι." },
  { name: "Μαρτσέλο", minutes: 35, km: 19, sheltered: ["N", "NE"], note: "Απέναντι από την Παροικιά, στον κόλπο· με καΐκι ή αυτοκίνητο." },
  { name: "Παρασπόρος", minutes: 28, km: 19, sheltered: ["N", "NE", "E"], note: "Νότια της Παροικιάς, αμμώδης." },
  { name: "Αγία Ειρήνη", minutes: 30, km: 21, sheltered: ["N", "NE", "E"], note: "Νοτιοδυτικά, φοίνικες και ταβέρνα." },
];

/** Paros beaches missing from the hotel's list (by name), for the "add all of Paros" button. */
export function missingParosBeaches(current: TvBeach[]): TvBeach[] {
  const have = new Set(current.map((b) => b.name.trim().toLowerCase()));
  return [...defaultBeaches, ...parosBeaches].filter((b) => !have.has(b.name.toLowerCase())).map((b) => ({ ...b, sheltered: [...b.sheltered] }));
}

/** Which beaches the assistant suggests on a windy day: the nearest sheltered ones, or every suitable one of the island. */
export type BeachMode = "near" | "all";

export const MAX_BEACHES = 50;

const knownKm = (name: string) => [...defaultBeaches, ...parosBeaches].find((b) => b.name.toLowerCase() === name.toLowerCase())?.km ?? 0;

export function normalizeBeaches(v: unknown): TvBeach[] {
  if (!Array.isArray(v)) return defaultBeaches.map((b) => ({ ...b, sheltered: [...b.sheltered] }));
  return v.slice(0, MAX_BEACHES).flatMap((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) : "";
    if (!name) return [];
    const sheltered = Array.isArray(r.sheltered) ? windDirections.filter((d) => (r.sheltered as unknown[]).includes(d)) : [];
    const minutes = Math.min(180, Math.max(0, Math.round(Number(r.minutes) || 0)));
    // Lists saved before v117 have no km: a known beach takes the indicative distance until the hotel changes it.
    const km = r.km === undefined ? knownKm(name) : Math.min(100, Math.max(0, Math.round((Number(r.km) || 0) * 10) / 10));
    const place = validCoord(r.lat, r.lon) ? { lat: Number(r.lat), lon: Number(r.lon), found: typeof r.found === "string" ? r.found.slice(0, 160) : "" } : {};
    const walk = Number(r.walkMin) > 0 ? { walkMin: Math.min(240, Math.round(Number(r.walkMin))) } : {};
    return [{ name, minutes, km, sheltered, note: typeof r.note === "string" ? r.note.trim().slice(0, 200) : "", ...place, ...walk }];
  });
}

/** Beaches for a wind: sheltered ones first (nearest first), then the rest. */
export function beachesForWind(beaches: TvBeach[], dir: WindDirection): { sheltered: TvBeach[]; exposed: TvBeach[] } {
  const byTime = (a: TvBeach, b: TvBeach) => a.minutes - b.minutes;
  return { sheltered: beaches.filter((b) => b.sheltered.includes(dir)).sort(byTime), exposed: beaches.filter((b) => !b.sheltered.includes(dir)).sort(byTime) };
}

/** Is it a windy day for swimming (meltemi strength)? */
export const windyDay = (beaufort: number) => beaufort >= 5;

/**
 * v176: the TV's «Beaches today» card. On a windy day (≥ 5 Beaufort) the three nearest beaches sheltered from today's
 * wind; otherwise the three nearest beaches. Waves (m) come from Open-Meteo Marine off the hotel.
 */
export function beachesToday(beaches: TvBeach[], beaufortNow: number, windDeg: number | null, mode: BeachMode = "all"): { windy: boolean; dir: WindDirection | null; beaches: TvBeach[] } {
  const dir = windDeg === null ? null : compass(windDeg);
  const windy = windyDay(beaufortNow) && dir !== null;
  const near = (list: TvBeach[]) => [...list].sort((a, b) => a.minutes - b.minutes);
  const pick = windy ? beachesForWind(beaches, dir!).sheltered : near(beaches);
  // «near»: on a windy day only beaches within half an hour; «all»: every sheltered beach of the island may be suggested.
  const limited = windy && mode === "near" ? pick.filter((b) => b.minutes <= 30) : pick;
  return { windy, dir, beaches: limited.slice(0, 3) };
}

export type BeachTodayTexts = { title: string; windy: string; calm: string; wave: string; none: string; min: string; here: string; close: string };
export const beachTodayTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", BeachTodayTexts> = {
  el: { close: "Κλείσιμο", here: "δίπλα στο ξενοδοχείο", title: "Παραλίες σήμερα", windy: "Φυσάει {b} Μποφόρ από {dir} — πιο απάνεμες σήμερα:", calm: "Ήπιος αέρας — καλή μέρα για θάλασσα.", wave: "Κύμα {m} μ.", none: "Σήμερα φυσάει σε όλες τις παραλίες της λίστας — ρωτήστε τη ρεσεψιόν.", min: "{n}′" },
  en: { close: "Close", here: "next to the hotel", title: "Beaches today", windy: "{b} Beaufort wind from the {dir} — most sheltered today:", calm: "Light wind — a good day for the sea.", wave: "Waves {m} m", none: "It is windy at every beach on our list today — ask reception.", min: "{n} min" },
  fr: { close: "Fermer", here: "à côté de l'hôtel", title: "Plages aujourd'hui", windy: "Vent de {b} Beaufort du {dir} — les plus abritées aujourd'hui :", calm: "Vent léger — belle journée pour la mer.", wave: "Vagues {m} m", none: "Il y a du vent sur toutes nos plages aujourd'hui — demandez à la réception.", min: "{n} min" },
  de: { close: "Schließen", here: "direkt am Hotel", title: "Strände heute", windy: "Wind {b} Beaufort aus {dir} — heute am geschütztesten:", calm: "Schwacher Wind — ein guter Tag fürs Meer.", wave: "Wellen {m} m", none: "Heute ist es an allen Stränden unserer Liste windig — fragen Sie die Rezeption.", min: "{n} Min." },
  it: { close: "Chiudi", here: "accanto all'hotel", title: "Spiagge oggi", windy: "Vento {b} Beaufort da {dir} — le più riparate oggi:", calm: "Vento leggero — buona giornata per il mare.", wave: "Onde {m} m", none: "Oggi c'è vento in tutte le spiagge della lista — chiedete alla reception.", min: "{n} min" },
  es: { close: "Cerrar", here: "junto al hotel", title: "Playas hoy", windy: "Viento de {b} Beaufort del {dir} — las más resguardadas hoy:", calm: "Viento suave — buen día para el mar.", wave: "Olas {m} m", none: "Hoy hace viento en todas las playas de la lista — pregunte en recepción.", min: "{n} min" },
};

const GREEK: Record<string, string> = { α: "a", ά: "a", β: "v", γ: "g", δ: "d", ε: "e", έ: "e", ζ: "z", η: "i", ή: "i", θ: "th", ι: "i", ί: "i", ϊ: "i", ΐ: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", ό: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", ύ: "y", ϋ: "y", ΰ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o", ώ: "o" };
/**
 * v178: a beach name for a guest who does not read Greek: the part in brackets (a Greek note) is left out and the rest
 * written in Latin letters («Πίσω Λιβάδι» → «Piso Livadi», «Πούντα (μετά τον Λογαρά)» → «Pounta»). Latin names stay.
 */
export function beachName(name: string, lang: string): string {
  if (lang === "el" || !/[\u0370-\u03FF]/.test(name)) return name;
  const main = name.replace(/\s*\([^)]*\)\s*/g, " ").trim() || name;
  // Accents off first (ού → ου), then the letter pairs Greeks write as one sound.
  const pairs: [RegExp, string][] = [[/ου/g, "ou"], [/Ου/g, "Ou"], [/ΟΥ/g, "OU"], [/(^|\s)Μπ/g, "$1B"], [/(^|\s)μπ/g, "$1b"], [/μπ/g, "mp"], [/(^|\s)Ντ/g, "$1D"], [/(^|\s)ντ/g, "$1d"], [/ντ/g, "nt"], [/γγ/g, "ng"], [/γκ/g, "nk"]];
  let s = main.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
  for (const [re, v] of pairs) s = s.replace(re, v);
  return s.split("").map((c) => { const lower = c.toLowerCase(), latin = GREEK[lower]; if (latin === undefined) return c; return c === lower ? latin : latin.charAt(0).toUpperCase() + latin.slice(1); }).join("");
}
