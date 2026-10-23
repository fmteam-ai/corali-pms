// Corali TV hotel information tabs (from the Hotel Corali welcome letter). Editable in PMS → Corali TV; each section has
// an icon, a title and a body per language. Body format: one paragraph per line, "- " for a bullet, **bold**.
// Placeholders filled on screen: {checkIn} {checkOut} {wifi} {password}.
import type { Localized, TvLanguage } from "./tv-core.ts";

export type TvInfoSection = { key: string; icon: string; title: Localized; body: Localized };

export const MAX_INFO_SECTIONS = 10;

export const defaultInfoSections: TvInfoSection[] = [
  {
    key: "checkin", icon: "🕐",
    title: { en: "Check-in & check-out", el: "Check-in & check-out" },
    body: {
      en: "**Check-in:** from {checkIn}\n**Check-out:** by {checkOut}\nLate check-out is subject to availability and additional charges may apply:\n- Departure until 18:00: 50% of the daily room rate\n- Departure after 18:00: 100% of the daily room rate\nFor an earlier departure than originally booked, the full amount of your reservation will be charged.",
      el: "**Check-in:** από τις {checkIn}\n**Check-out:** έως τις {checkOut}\nΤο αργό check-out γίνεται ανάλογα με τη διαθεσιμότητα και μπορεί να υπάρξει επιπλέον χρέωση:\n- Αναχώρηση έως τις 18:00: 50% της ημερήσιας τιμής δωματίου\n- Αναχώρηση μετά τις 18:00: 100% της ημερήσιας τιμής δωματίου\nΣε αναχώρηση νωρίτερα από την αρχική κράτηση χρεώνεται ολόκληρο το ποσό της κράτησης.",
    },
  },
  {
    key: "rates", icon: "💶",
    title: { en: "Room rates & fees", el: "Τιμές & τέλη" },
    body: {
      en: "Room rates include VAT and applicable municipal taxes.\n**Accepted cards:** Visa, Mastercard, Maestro\nThe **Climate Crisis Resilience Fee** is not included in the room rate and is payable separately, as required by Greek legislation, unless it has already been paid in accordance with the terms and conditions of your reservation.\n- April – October: **€2.00 per room / per night**",
      el: "Οι τιμές των δωματίων περιλαμβάνουν ΦΠΑ και τους δημοτικούς φόρους.\n**Δεκτές κάρτες:** Visa, Mastercard, Maestro\nΤο **Τέλος Ανθεκτικότητας στην Κλιματική Κρίση** δεν περιλαμβάνεται στην τιμή και καταβάλλεται χωριστά, όπως ορίζει η ελληνική νομοθεσία, εκτός αν έχει ήδη πληρωθεί σύμφωνα με τους όρους της κράτησής σας.\n- Απρίλιος – Οκτώβριος: **€2,00 ανά δωμάτιο / ανά νύχτα**",
    },
  },
  {
    key: "housekeeping", icon: "🧹",
    title: { en: "Housekeeping", el: "Καθαριότητα" },
    body: {
      en: "Rooms are serviced daily until 13:00.\nAs part of our effort to conserve water and reduce our environmental impact:\n- Towels are changed every 2 days\n- Bed linen is changed every 3 days\nIf you need anything additional, please contact us and we will be happy to assist.\nPlease do not take the hotel room towels to the beach. **Complimentary beach towels** are available at Reception upon request.",
      el: "Τα δωμάτια καθαρίζονται καθημερινά έως τις 13:00.\nΣτο πλαίσιο της προσπάθειάς μας να εξοικονομούμε νερό και να προστατεύουμε το περιβάλλον:\n- Οι πετσέτες αλλάζουν κάθε 2 ημέρες\n- Τα σεντόνια αλλάζουν κάθε 3 ημέρες\nΑν χρειάζεστε κάτι επιπλέον, ενημερώστε μας και θα χαρούμε να βοηθήσουμε.\nΠαρακαλούμε μην παίρνετε τις πετσέτες του δωματίου στην παραλία. **Πετσέτες θαλάσσης** δίνονται δωρεάν από τη ρεσεψιόν.",
    },
  },
  {
    key: "wifi", icon: "📶",
    title: { en: "Wi-Fi & facilities", el: "Wi-Fi & παροχές" },
    body: {
      en: "Hotel Corali provides **high-speed internet access up to 350 Mbps with Starlink**.\nWi-Fi is available throughout the hotel.\n- Network: **{wifi}**\n- Password: **{password}**\nGuests may also use our lending library and computer/printer facilities.",
      el: "Το Hotel Corali προσφέρει **γρήγορο internet έως 350 Mbps μέσω Starlink**.\nΤο Wi-Fi είναι διαθέσιμο σε όλο το ξενοδοχείο.\n- Δίκτυο: **{wifi}**\n- Κωδικός: **{password}**\nΜπορείτε επίσης να χρησιμοποιήσετε τη δανειστική μας βιβλιοθήκη και τον υπολογιστή/εκτυπωτή.",
    },
  },
  {
    key: "reception", icon: "🛎️",
    title: { en: "Reception", el: "Ρεσεψιόν" },
    body: {
      en: "Reception is open daily: **07:30 – 21:00**\nPlease do not hesitate to contact us if you need assistance or experience any problem during your stay. We will be happy to help.",
      el: "Η ρεσεψιόν είναι ανοιχτή καθημερινά: **07:30 – 21:00**\nΜη διστάσετε να επικοινωνήσετε μαζί μας αν χρειάζεστε βοήθεια ή αντιμετωπίσετε οποιοδήποτε πρόβλημα κατά τη διαμονή σας. Θα χαρούμε να βοηθήσουμε.",
    },
  },
  {
    key: "important", icon: "❗",
    title: { en: "Important information", el: "Σημαντικές πληροφορίες" },
    body: {
      en: "**Smoking:** all rooms are non-smoking. Thank you for smoking only in permitted outdoor areas.\n**Pets:** pets are not permitted at the hotel.\n**Drinking water:** we recommend using bottled water for drinking.\n**Air conditioning:**\n- Please keep the doors and windows closed\n- Insert the room key fob into the energy-saving socket below the switches near the entrance",
      el: "**Κάπνισμα:** όλα τα δωμάτια είναι μη καπνιζόντων. Σας ευχαριστούμε που καπνίζετε μόνο στους επιτρεπόμενους εξωτερικούς χώρους.\n**Κατοικίδια:** δεν επιτρέπονται κατοικίδια στο ξενοδοχείο.\n**Πόσιμο νερό:** προτείνουμε εμφιαλωμένο νερό για πόσιμο.\n**Κλιματισμός:**\n- Παρακαλούμε κρατάτε πόρτες και παράθυρα κλειστά\n- Τοποθετήστε το μπρελόκ του κλειδιού στην υποδοχή εξοικονόμησης ενέργειας κάτω από τους διακόπτες, δίπλα στην είσοδο",
    },
  },
  {
    key: "checkout", icon: "🧳",
    title: { en: "Before your check-out", el: "Πριν το check-out" },
    body: {
      en: "Please make sure you have taken all your belongings and kindly leave the room key:\n- at Reception, if it is open during your departure\n- if Reception is closed, please leave the key inside your room\nThank you for choosing Hotel Corali. We wish you a wonderful stay!",
      el: "Βεβαιωθείτε ότι έχετε πάρει όλα τα πράγματά σας και αφήστε το κλειδί του δωματίου:\n- στη ρεσεψιόν, αν είναι ανοιχτή την ώρα της αναχώρησής σας\n- αν η ρεσεψιόν είναι κλειστή, αφήστε το κλειδί μέσα στο δωμάτιο\nΣας ευχαριστούμε που επιλέξατε το Hotel Corali. Σας ευχόμαστε υπέροχη διαμονή!",
    },
  },
];

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const langs: TvLanguage[] = ["el", "en", "fr", "de", "it", "es"];
const loc = (v: unknown, max: number): Localized => {
  const out: Localized = {};
  if (v && typeof v === "object") for (const l of langs) { const t = clip((v as Record<string, unknown>)[l], max); if (t) out[l] = t; }
  return out;
};

// v76: "Accepted cards" moved from Important information to Room rates & fees. Saved copies of the untouched default
// texts follow automatically; texts the hotel edited stay as they are.
const movedCards: Record<string, Partial<Record<TvLanguage, [string, string]>>> = {
  rates: {
    en: ["\n**Accepted cards:** Visa, Mastercard, Maestro", "insert"],
    el: ["\n**Δεκτές κάρτες:** Visa, Mastercard, Maestro", "insert"],
  },
  important: {
    en: ["\n**Accepted cards:** Visa, Mastercard, Maestro", "remove"],
    el: ["\n**Κάρτες:** Visa, Mastercard, Maestro", "remove"],
  },
};
function upgradeDefaults(section: TvInfoSection): TvInfoSection {
  const rules = movedCards[section.key];
  const current = defaultInfoSections.find((d) => d.key === section.key);
  if (!rules || !current) return section;
  const body = { ...section.body };
  for (const [lang, [line, how]] of Object.entries(rules) as [TvLanguage, [string, string]][]) {
    const now = current.body[lang] ?? "";
    // The text as it was before the move: rates without the line, important with it at the end.
    const before = how === "insert" ? now.replace(line, "") : now + line;
    if (body[lang] === before) body[lang] = now;
  }
  return { ...section, body };
}

/** Sections from storage or the PMS form (defaults when never saved; an empty list stays empty). */
export function normalizeInfoSections(raw: unknown): TvInfoSection[] {
  if (!Array.isArray(raw)) return defaultInfoSections.map((s) => ({ ...s, title: { ...s.title }, body: { ...s.body } }));
  const seen = new Set<string>();
  return raw.slice(0, MAX_INFO_SECTIONS).flatMap((r, i) => {
    if (!r || typeof r !== "object") return [];
    const x = r as Record<string, unknown>;
    let key = clip(x.key, 30).replace(/[^a-z0-9_-]/gi, "") || `s${i + 1}`;
    while (seen.has(key)) key = `${key}_`;
    seen.add(key);
    return [upgradeDefaults({ key, icon: clip(x.icon, 8) || "ℹ️", title: loc(x.title, 60), body: loc(x.body, 2500) })];
  });
}

/** Fill {checkIn} {checkOut} {wifi} {password}; a missing value becomes "—". */
export function fillInfo(text: string, values: Record<"checkIn" | "checkOut" | "wifi" | "password", string>): string {
  return text.replace(/\{(checkIn|checkOut|wifi|password)\}/g, (_, k: keyof typeof values) => values[k] || "—");
}
