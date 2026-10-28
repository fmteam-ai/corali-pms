// Beaches for the TV assistant (pure; unit tested): the hotel's list with the winds each beach is sheltered from, and
// the wind as Greek sailors name it, so the assistant can send guests to a calm beach on a meltemi day.

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

export type TvBeach = { name: string; minutes: number; sheltered: WindDirection[]; note: string };

/**
 * Starting list around Piso Livadi (east Paros). A beach is "sheltered" from a wind that blows from the land side or
 * is blocked by a headland. The hotel should check and correct it in PMS → Corali TV — local knowledge wins.
 */
export const defaultBeaches: TvBeach[] = [
  { name: "Πίσω Λιβάδι", minutes: 2, sheltered: ["N", "NW", "W"], note: "Η παραλία του χωριού, μπροστά στο ξενοδοχείο." },
  { name: "Λογαράς", minutes: 5, sheltered: ["N", "NW", "W"], note: "Αμμώδης, ρηχά νερά, ταβέρνες· καλή επιλογή με μελτέμι." },
  { name: "Δρυός / Λολαντώνης", minutes: 15, sheltered: ["N", "NW", "W"], note: "Νοτιοανατολικά, μικροί κόλποι." },
  { name: "Φάραγγας", minutes: 20, sheltered: ["N", "NE", "NW"], note: "Νότια παραλία, συνήθως ήρεμη με βοριά." },
  { name: "Αλυκή / Πίσω Αλυκή", minutes: 25, sheltered: ["N", "NE", "NW"], note: "Νότια, κοντά στο χωριό Αλυκή." },
  { name: "Κρυός (κόλπος Παροικιάς)", minutes: 30, sheltered: ["N", "NE", "E"], note: "Απέναντι από την Παροικιά, με καΐκι από το λιμάνι." },
  { name: "Χρυσή Ακτή", minutes: 10, sheltered: ["W", "SW", "NW"], note: "Με βοριά/μελτέμι έχει δυνατό αέρα — ιδανική για windsurf." },
  { name: "Πούντα (μετά τον Λογαρά)", minutes: 7, sheltered: ["N", "NW", "W"], note: "Νότια του Λογαρά, στην ανατολική ακτή· δεν την πιάνει ο βοριάς." },
  { name: "Πούντα (δυτική, απέναντι από Αντίπαρο)", minutes: 30, sheltered: ["E", "SE"], note: "Κοντά στο λιμανάκι για Αντίπαρο· spot για kitesurf, ανοιχτή στο μελτέμι." },
  { name: "Μώλος", minutes: 10, sheltered: ["W", "SW", "S"], note: "Βόρεια της Μάρπησσας, ανοιχτή στον βοριά." },
  { name: "Κολυμπήθρες", minutes: 30, sheltered: ["E", "SE", "S"], note: "Βράχια-γλυπτά στον κόλπο της Νάουσας." },
  { name: "Σάντα Μαρία / Λαγκέρι", minutes: 30, sheltered: ["S", "SW", "W"], note: "Βορειοανατολικά της Νάουσας, εκτεθειμένες στο μελτέμι." },
];

const MAX_BEACHES = 20;

export function normalizeBeaches(v: unknown): TvBeach[] {
  if (!Array.isArray(v)) return defaultBeaches.map((b) => ({ ...b, sheltered: [...b.sheltered] }));
  return v.slice(0, MAX_BEACHES).flatMap((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) : "";
    if (!name) return [];
    const sheltered = Array.isArray(r.sheltered) ? windDirections.filter((d) => (r.sheltered as unknown[]).includes(d)) : [];
    const minutes = Math.min(180, Math.max(0, Math.round(Number(r.minutes) || 0)));
    return [{ name, minutes, sheltered, note: typeof r.note === "string" ? r.note.trim().slice(0, 200) : "" }];
  });
}

/** Beaches for a wind: sheltered ones first (nearest first), then the rest. */
export function beachesForWind(beaches: TvBeach[], dir: WindDirection): { sheltered: TvBeach[]; exposed: TvBeach[] } {
  const byTime = (a: TvBeach, b: TvBeach) => a.minutes - b.minutes;
  return { sheltered: beaches.filter((b) => b.sheltered.includes(dir)).sort(byTime), exposed: beaches.filter((b) => !b.sheltered.includes(dir)).sort(byTime) };
}

/** Is it a windy day for swimming (meltemi strength)? */
export const windyDay = (beaufort: number) => beaufort >= 5;
