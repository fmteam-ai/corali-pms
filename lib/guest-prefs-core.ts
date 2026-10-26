// Structured guest preferences (pure; unit tested). Kept per guest e-mail next to the free-text notes, filled by staff
// (CRM), by the guest at online check-in, and automatically (TV requests for pillows / blankets, arrival time).
// Shown before arrival to reception and housekeeping.

export const pillowChoices = ["soft", "firm", "hypoallergenic"] as const;
export const bedChoices = ["double", "twin"] as const;
export const floorChoices = ["high", "low", "quiet"] as const;

export type GuestPrefs = {
  pillow: (typeof pillowChoices)[number] | "";
  bed: (typeof bedChoices)[number] | "";
  floor: (typeof floorChoices)[number] | "";
  extraPillows: boolean;
  extraBlankets: boolean;
  babyCot: boolean;
  arrivalTime: string;
  drink: string;
  occasion: string;
};

export const emptyPrefs: GuestPrefs = { pillow: "", bed: "", floor: "", extraPillows: false, extraBlankets: false, babyCot: false, arrivalTime: "", drink: "", occasion: "" };

const pick = <T extends readonly string[]>(v: unknown, list: T): T[number] | "" => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function normalizePrefs(raw: unknown): GuestPrefs {
  let r: Record<string, unknown> = {};
  if (typeof raw === "string") { try { r = JSON.parse(raw || "{}"); } catch { r = {}; } } else if (raw && typeof raw === "object") r = raw as Record<string, unknown>;
  const time = text(r.arrivalTime, 5);
  return {
    pillow: pick(r.pillow, pillowChoices), bed: pick(r.bed, bedChoices), floor: pick(r.floor, floorChoices),
    extraPillows: r.extraPillows === true, extraBlankets: r.extraBlankets === true, babyCot: r.babyCot === true,
    arrivalTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "",
    drink: text(r.drink, 120), occasion: text(r.occasion, 120),
  };
}

/** New values win where they are given; empty / false new values keep what was known (used for automatic capture). */
export function mergePrefs(old: GuestPrefs, add: Partial<GuestPrefs>): GuestPrefs {
  const out = { ...old };
  for (const [k, v] of Object.entries(add) as [keyof GuestPrefs, GuestPrefs[keyof GuestPrefs]][]) if (v !== "" && v !== false && v !== undefined) (out as Record<string, unknown>)[k] = v;
  return normalizePrefs(out);
}

export const hasPrefs = (p: GuestPrefs) => Object.values(p).some((v) => v !== "" && v !== false);

type L = "el" | "en";
const labels: Record<L, Record<string, string>> = {
  el: { "pillow.soft": "Μαλακό μαξιλάρι", "pillow.firm": "Σκληρό μαξιλάρι", "pillow.hypoallergenic": "Αντιαλλεργικό μαξιλάρι", "bed.double": "Διπλό κρεβάτι", "bed.twin": "Δύο μονά", "floor.high": "Ψηλός όροφος", "floor.low": "Χαμηλός όροφος", "floor.quiet": "Ήσυχο δωμάτιο", extraPillows: "Επιπλέον μαξιλάρια", extraBlankets: "Επιπλέον κουβέρτα", babyCot: "Παιδικό κρεβάτι", arrivalTime: "Άφιξη {v}", drink: "Αγαπημένο ποτό: {v}", occasion: "Περίσταση: {v}", dietary: "Διατροφή: {v}", allergies: "⚠ Αλλεργίες: {v}" },
  en: { "pillow.soft": "Soft pillow", "pillow.firm": "Firm pillow", "pillow.hypoallergenic": "Hypoallergenic pillow", "bed.double": "Double bed", "bed.twin": "Twin beds", "floor.high": "High floor", "floor.low": "Low floor", "floor.quiet": "Quiet room", extraPillows: "Extra pillows", extraBlankets: "Extra blanket", babyCot: "Baby cot", arrivalTime: "Arrives {v}", drink: "Favourite drink: {v}", occasion: "Occasion: {v}", dietary: "Diet: {v}", allergies: "⚠ Allergies: {v}" },
};

/**
 * Short lines for staff. `room` = only what matters to prepare the room (housekeeping); otherwise everything.
 * Dietary needs and allergies come from the CRM text fields.
 */
export function prefLines(p: GuestPrefs, lang: L, extra: { dietary?: string; allergies?: string } = {}, room = false): string[] {
  const l = labels[lang], v = (k: string, val: string) => l[k].replace("{v}", val);
  const out: string[] = [];
  if (p.pillow) out.push(l[`pillow.${p.pillow}`]);
  if (p.extraPillows) out.push(l.extraPillows);
  if (p.extraBlankets) out.push(l.extraBlankets);
  if (p.bed) out.push(l[`bed.${p.bed}`]);
  if (p.babyCot) out.push(l.babyCot);
  if (extra.allergies?.trim()) out.push(v("allergies", extra.allergies.trim()));
  if (p.occasion) out.push(v("occasion", p.occasion));
  if (room) return out;
  if (p.floor) out.push(l[`floor.${p.floor}`]);
  if (p.arrivalTime) out.push(v("arrivalTime", p.arrivalTime));
  if (p.drink) out.push(v("drink", p.drink));
  if (extra.dietary?.trim()) out.push(v("dietary", extra.dietary.trim()));
  return out;
}

/** Guest-facing texts for online check-in (6 languages). */
export const prefFormTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", Record<string, string>> = {
  el: { title: "Οι προτιμήσεις σας (προαιρετικά)", hint: "Θα έχουμε το δωμάτιο έτοιμο όπως το θέλετε — και θα τις θυμόμαστε την επόμενη φορά.", pillow: "Μαξιλάρι", soft: "Μαλακό", firm: "Σκληρό", hypoallergenic: "Αντιαλλεργικό", bed: "Κρεβάτι", double: "Διπλό", twin: "Δύο μονά", floor: "Δωμάτιο", high: "Ψηλός όροφος", low: "Χαμηλός όροφος", quiet: "Ήσυχο", extraPillows: "Επιπλέον μαξιλάρια", extraBlankets: "Επιπλέον κουβέρτα", babyCot: "Παιδικό κρεβάτι", any: "Αδιάφορο", dietary: "Διατροφή (π.χ. χορτοφάγος)", allergies: "Αλλεργίες", drink: "Αγαπημένο κρασί / ποτό", occasion: "Γιορτάζετε κάτι; (π.χ. επέτειος)" },
  en: { title: "Your preferences (optional)", hint: "We will have your room ready the way you like it — and remember it next time.", pillow: "Pillow", soft: "Soft", firm: "Firm", hypoallergenic: "Hypoallergenic", bed: "Bed", double: "Double", twin: "Twin beds", floor: "Room", high: "High floor", low: "Low floor", quiet: "Quiet", extraPillows: "Extra pillows", extraBlankets: "Extra blanket", babyCot: "Baby cot", any: "No preference", dietary: "Diet (e.g. vegetarian)", allergies: "Allergies", drink: "Favourite wine / drink", occasion: "Celebrating something? (e.g. anniversary)" },
  fr: { title: "Vos préférences (facultatif)", hint: "Votre chambre sera prête comme vous l'aimez — et nous nous en souviendrons la prochaine fois.", pillow: "Oreiller", soft: "Moelleux", firm: "Ferme", hypoallergenic: "Hypoallergénique", bed: "Lit", double: "Double", twin: "Lits jumeaux", floor: "Chambre", high: "Étage élevé", low: "Étage bas", quiet: "Calme", extraPillows: "Oreillers supplémentaires", extraBlankets: "Couverture supplémentaire", babyCot: "Lit bébé", any: "Indifférent", dietary: "Régime (ex. végétarien)", allergies: "Allergies", drink: "Vin / boisson préféré", occasion: "Une occasion spéciale ? (ex. anniversaire)" },
  de: { title: "Ihre Wünsche (optional)", hint: "Wir bereiten Ihr Zimmer so vor, wie Sie es mögen — und merken es uns für das nächste Mal.", pillow: "Kissen", soft: "Weich", firm: "Fest", hypoallergenic: "Allergikerkissen", bed: "Bett", double: "Doppelbett", twin: "Zwei Einzelbetten", floor: "Zimmer", high: "Obere Etage", low: "Untere Etage", quiet: "Ruhig", extraPillows: "Zusätzliche Kissen", extraBlankets: "Zusätzliche Decke", babyCot: "Babybett", any: "Egal", dietary: "Ernährung (z. B. vegetarisch)", allergies: "Allergien", drink: "Lieblingswein / -getränk", occasion: "Ein besonderer Anlass? (z. B. Jahrestag)" },
  it: { title: "Le vostre preferenze (facoltativo)", hint: "Prepareremo la camera come piace a voi — e lo ricorderemo la prossima volta.", pillow: "Cuscino", soft: "Morbido", firm: "Rigido", hypoallergenic: "Anallergico", bed: "Letto", double: "Matrimoniale", twin: "Due singoli", floor: "Camera", high: "Piano alto", low: "Piano basso", quiet: "Tranquilla", extraPillows: "Cuscini extra", extraBlankets: "Coperta extra", babyCot: "Culla", any: "Indifferente", dietary: "Dieta (es. vegetariana)", allergies: "Allergie", drink: "Vino / bevanda preferita", occasion: "Festeggiate qualcosa? (es. anniversario)" },
  es: { title: "Sus preferencias (opcional)", hint: "Tendremos su habitación lista como le gusta — y lo recordaremos la próxima vez.", pillow: "Almohada", soft: "Blanda", firm: "Firme", hypoallergenic: "Hipoalergénica", bed: "Cama", double: "Doble", twin: "Dos individuales", floor: "Habitación", high: "Piso alto", low: "Piso bajo", quiet: "Tranquila", extraPillows: "Almohadas extra", extraBlankets: "Manta extra", babyCot: "Cuna", any: "Indiferente", dietary: "Dieta (p. ej. vegetariana)", allergies: "Alergias", drink: "Vino / bebida favorita", occasion: "¿Celebra algo? (p. ej. aniversario)" },
};
