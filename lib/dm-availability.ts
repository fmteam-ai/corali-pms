// DM-to-booking: read stay dates and party size from a guest's social message and draft a reply with live
// availability (pure; unit tested). Drafts are always reviewed and sent by reception, never automatically.
import { detectLanguage } from "./social-reply.ts";

export type StayRequest = { checkIn: string; checkOut: string; adults: number; children: number };

const monthStems: [RegExp, number][] = [
  [/^(jan|ιαν|janv|genn|ene)/, 1], [/^(feb|φεβ|fev|febb)/, 2], [/^(mar|μαρ|marz)/, 3], [/^(apr|απρ|avr|abr)/, 4],
  [/^(may|mai|μαι|μαΐ|magg)/, 5], [/^(jun|ιουν|juin|giugn)/, 6], [/^(jul|ιουλ|juil|lugl)/, 7], [/^(aug|αυγ|aout|agost|ago)/, 8],
  [/^(sep|σεπ|sett)/, 9], [/^(oct|οκτ|okt|ott)/, 10], [/^(nov|νοε|νοέ)/, 11], [/^(dec|δεκ|dez|dic)/, 12],
];

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function monthFromWord(word: string): number | null {
  const w = strip(word);
  if (w.length < 3) return null;
  for (const [re, m] of monthStems) if (re.test(w)) return m;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function makeDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
}
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const SEP = String.raw`\s*(?:-|–|—|to|till|until|έως|εως|ως|μέχρι|μεχρι|bis|au|al|a|→)\s*`;
const WORD = String.raw`([A-Za-zÀ-ÿͰ-Ͽἀ-ῼ]{3,}\.?)`;

/** Find a stay request in free text; dates without a year roll to the next occurrence after `today`. */
export function parseStayRequest(text: string, today: string): StayRequest | null {
  const t = ` ${text} `;
  const year = Number(today.slice(0, 4));
  let parts: { d1: number; m1: number; y1?: number; d2: number; m2: number; y2?: number } | null = null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})\D+?(\d{4})-(\d{2})-(\d{2})/))) parts = { y1: +m[1], m1: +m[2], d1: +m[3], y2: +m[4], m2: +m[5], d2: +m[6] };
  else if ((m = t.match(new RegExp(String.raw`(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?${SEP}(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?`, "i")))) {
    const y = (v?: string) => (v ? (v.length === 2 ? 2000 + Number(v) : Number(v)) : undefined);
    parts = { d1: +m[1], m1: +m[2], y1: y(m[3]), d2: +m[4], m2: +m[5], y2: y(m[6]) };
  } else if ((m = t.match(new RegExp(String.raw`(\d{1,2})\s*${WORD}${SEP}(\d{1,2})\s*${WORD}`, "i"))) && monthFromWord(m[2]) && monthFromWord(m[4])) {
    parts = { d1: +m[1], m1: monthFromWord(m[2])!, d2: +m[3], m2: monthFromWord(m[4])! };
  } else if ((m = t.match(new RegExp(String.raw`(\d{1,2})${SEP}(\d{1,2})\s*(?:of\s+|de\s+|του\s+)?${WORD}`, "i"))) && monthFromWord(m[3])) {
    parts = { d1: +m[1], m1: monthFromWord(m[3])!, d2: +m[2], m2: monthFromWord(m[3])! };
  } else if ((m = t.match(new RegExp(String.raw`${WORD}\s+(\d{1,2})${SEP}(\d{1,2})\b`, "i"))) && monthFromWord(m[1])) {
    parts = { d1: +m[2], m1: monthFromWord(m[1])!, d2: +m[3], m2: monthFromWord(m[1])! };
  }
  if (!parts) return null;
  let y1 = parts.y1 ?? year;
  let checkIn = makeDate(y1, parts.m1, parts.d1);
  if (!checkIn) return null;
  if (!parts.y1 && checkIn < today) { y1 += 1; checkIn = makeDate(y1, parts.m1, parts.d1); }
  let y2 = parts.y2 ?? y1;
  let checkOut = makeDate(y2, parts.m2, parts.d2);
  if (!checkIn || !checkOut) return null;
  if (!parts.y2 && checkOut <= checkIn) { y2 += 1; checkOut = makeDate(y2, parts.m2, parts.d2); }
  if (!checkOut || checkIn < today) return null;
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1 || nights > 30) return null;
  const adults = Number(t.match(/(\d{1,2})\s*(?:adults?|persons?|people|guests?|pax|άτομα|ατομα|ενήλικ\S*|ενηλικ\S*|personnes|adultes|personen|erwachsene|persone|adulti|personas|adultos)/i)?.[1] ?? 2);
  const children = Number(t.match(/(\d{1,2})\s*(?:child(?:ren)?|kids?|παιδι\S*|παιδί\S*|enfants?|kinder|bambini|niñ\S*|ninos)/i)?.[1] ?? 0);
  return { checkIn, checkOut, adults: Math.min(Math.max(adults, 1), 10), children: Math.min(Math.max(children, 0), 10) };
}

export type RoomOffer = { name: string; fromCents: number; available: number };

const copy: Record<string, { yes: string; line: string; book: string; no: string; guests: string }> = {
  el: { yes: "Γεια σας και ευχαριστούμε για το μήνυμα! Για {dates} ({nights} νύχτες, {guests}) έχουμε διαθεσιμότητα:", line: "• {room}: από {price} συνολικά", book: "Κλείστε απευθείας με την καλύτερη τιμή (οι ημερομηνίες είναι ήδη συμπληρωμένες): {link}", no: "Γεια σας και ευχαριστούμε για το μήνυμα! Δυστυχώς για {dates} είμαστε πλήρεις. Δείτε κοντινές ημερομηνίες εδώ: {link} — ή πείτε μας αν είστε ευέλικτοι και θα σας προτείνουμε εναλλακτικές.", guests: "{n} άτομα" },
  en: { yes: "Hello and thank you for your message! For {dates} ({nights} nights, {guests}) we have availability:", line: "• {room}: from {price} in total", book: "Book directly at our best rate (your dates are already filled in): {link}", no: "Hello and thank you for your message! Unfortunately we are fully booked for {dates}. You can check nearby dates here: {link} — or let us know if you are flexible and we will suggest alternatives.", guests: "{n} guests" },
  fr: { yes: "Bonjour et merci pour votre message ! Pour {dates} ({nights} nuits, {guests}), nous avons des disponibilités :", line: "• {room} : à partir de {price} au total", book: "Réservez en direct au meilleur tarif (vos dates sont déjà renseignées) : {link}", no: "Bonjour et merci pour votre message ! Malheureusement, nous sommes complets pour {dates}. Consultez des dates proches ici : {link} — ou dites-nous si vous êtes flexibles.", guests: "{n} personnes" },
  de: { yes: "Hallo und danke für Ihre Nachricht! Für {dates} ({nights} Nächte, {guests}) haben wir freie Zimmer:", line: "• {room}: ab {price} insgesamt", book: "Direkt zum besten Preis buchen (Ihre Daten sind bereits eingetragen): {link}", no: "Hallo und danke für Ihre Nachricht! Leider sind wir für {dates} ausgebucht. Andere Termine finden Sie hier: {link} – oder sagen Sie uns, ob Sie flexibel sind.", guests: "{n} Personen" },
  it: { yes: "Ciao e grazie per il messaggio! Per {dates} ({nights} notti, {guests}) abbiamo disponibilità:", line: "• {room}: da {price} in totale", book: "Prenota direttamente alla migliore tariffa (le date sono già inserite): {link}", no: "Ciao e grazie per il messaggio! Purtroppo per {dates} siamo al completo. Guarda le date vicine qui: {link} — oppure dicci se sei flessibile.", guests: "{n} persone" },
  es: { yes: "¡Hola y gracias por tu mensaje! Para {dates} ({nights} noches, {guests}) tenemos disponibilidad:", line: "• {room}: desde {price} en total", book: "Reserva directamente con la mejor tarifa (tus fechas ya están indicadas): {link}", no: "¡Hola y gracias por tu mensaje! Lamentablemente estamos completos para {dates}. Consulta fechas cercanas aquí: {link} — o dinos si tienes flexibilidad.", guests: "{n} personas" },
};
const locales: Record<string, string> = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" };

/** Deep link into the booking engine with dates, party and tracking prefilled. */
export function bookingDeepLink(bookingUrl: string, req: StayRequest, lang: string, platform: string) {
  const q = new URLSearchParams({ checkIn: req.checkIn, checkOut: req.checkOut, adults: String(req.adults), children: String(req.children), lang, utm_source: platform, utm_medium: "dm" });
  return `${bookingUrl}${bookingUrl.includes("?") ? "&" : "?"}${q.toString()}`;
}

export function availabilityReply(message: string, req: StayRequest, offers: RoomOffer[], bookingUrl: string, platform: string): string {
  const lang = detectLanguage(message);
  const c = copy[lang] ?? copy.en;
  const locale = locales[lang] ?? "en-GB";
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
  const dates = `${fmt(req.checkIn)} – ${fmt(req.checkOut)}`;
  const link = bookingDeepLink(bookingUrl, req, lang, platform);
  const guests = fill(c.guests, { n: req.adults + req.children });
  const open = offers.filter((o) => o.available > 0).sort((a, b) => a.fromCents - b.fromCents).slice(0, 3);
  if (!open.length) return fill(c.no, { dates, link });
  return [fill(c.yes, { dates, nights: nightsBetween(req.checkIn, req.checkOut), guests }), ...open.map((o) => fill(c.line, { room: o.name, price: money(o.fromCents) })), fill(c.book, { link })].join("\n");
}
