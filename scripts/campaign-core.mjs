// Bulk messages to past guests (pure; unit tested): who may receive them (marketing consent, not unsubscribed),
// the message per language with the guest's first name, the e-mail (text + HTML with an unsubscribe link) and the
// signed unsubscribe token. Used by the PMS (preview, test) and by the cron worker (sending).
import { createHmac, timingSafeEqual } from "node:crypto";

import { contactLines, normalizeBrand, renderBrandedEmail } from "./email-brand-core.mjs";
export const campaignLanguages = ["el", "en", "fr", "de", "it", "es"];
export const MAX_CAMPAIGN_RATE = 120;

const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** { el: { subject, body }, … } — empty languages fall back to English, then Greek. */
export function normalizeContent(v) {
  const r = v && typeof v === "object" ? v : {};
  const out = {};
  for (const l of campaignLanguages) {
    const x = r[l] && typeof r[l] === "object" ? r[l] : {};
    const subject = clip(x.subject, 150), body = clip(x.body, 5000);
    if (subject || body) out[l] = { subject, body };
  }
  return out;
}

export function pickContent(content, lang) {
  const c = content[lang]?.body ? content[lang] : content.en?.body ? content.en : content.el?.body ? content.el : Object.values(content).find((x) => x.body);
  return c ? { subject: c.subject || "Hotel Corali", body: c.body } : null;
}

/** Audience filters: stays that ended between two dates, countries, languages, repeat guests. */
export function normalizeAudience(v) {
  const r = v && typeof v === "object" ? v : {};
  const date = (x) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "");
  const list = (x, re) => (Array.isArray(x) ? [...new Set(x.filter((y) => typeof y === "string" && re.test(y)))].slice(0, 60) : []);
  return {
    stayFrom: date(r.stayFrom), stayTo: date(r.stayTo),
    countries: list(r.countries, /^[A-Z]{2}$/), languages: list(r.languages, /^(el|en|fr|de|it|es)$/),
    minStays: Math.min(10, Math.max(1, Math.round(Number(r.minStays) || 1))),
  };
}

export const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] ?? "";
export const fill = (text, name) => String(text).replaceAll("{name}", name || "").replace(/ ,/g, ",").replace(/\s+([!.,])/g, "$1");
export const normalizeEmail = (e) => String(e ?? "").trim().toLowerCase();
export const normalizePhone = (p) => { const d = String(p ?? "").replace(/[\s()+-]/g, ""); return /^\d{10,15}$/.test(d) ? d : ""; };

/**
 * Past guests who agreed to marketing on this channel (booking or online check-in), grouped by e-mail / phone, newest
 * name and language, minus unsubscribed addresses. Only stays already over; cancelled / no-show bookings never count.
 */
export function audienceQuery(owner, audience, channel, today) {
  const a = normalizeAudience(audience);
  const params = [owner, today];
  const where = [`b.owner_id=$1`, `b.check_out<=$2`, `b.status NOT IN ('cancelled','no_show')`];
  if (a.stayFrom) { params.push(a.stayFrom); where.push(`b.check_out>=$${params.length}`); }
  if (a.stayTo) { params.push(a.stayTo); where.push(`b.check_in<=$${params.length}`); }
  if (a.countries.length) { params.push(a.countries); where.push(`upper(coalesce(b.guest_country,'')) = ANY($${params.length})`); }
  const address = channel === "email" ? `lower(trim(b.guest_email))` : `regexp_replace(coalesce(b.guest_phone,''),'[^0-9]','','g')`;
  const consent = channel === "email" ? `b.email_marketing_opt_in` : `b.whatsapp_opt_in`;
  where.push(channel === "email" ? `b.guest_email ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'` : `length(regexp_replace(coalesce(b.guest_phone,''),'[^0-9]','','g')) BETWEEN 10 AND 15`);
  params.push(a.minStays);
  const minStays = `$${params.length}`;
  let langFilter = "";
  if (a.languages.length) { params.push(a.languages); langFilter = `AND g.lang = ANY($${params.length})`; }
  const sql = `WITH s AS (SELECT ${address} AS address,b.guest_name,b.guest_language,b.check_out,${consent} AS consent FROM bookings b WHERE ${where.join(" AND ")}),
 g AS (SELECT address,(array_agg(guest_name ORDER BY check_out DESC))[1] AS name,(array_agg(guest_language ORDER BY check_out DESC))[1] AS lang,count(*)::int AS stays,max(consent) AS consent FROM s GROUP BY address)
 SELECT g.address,g.name,coalesce(g.lang,'en') AS lang,g.stays FROM g WHERE g.consent=1 AND g.stays>=${minStays} ${langFilter}
  AND NOT EXISTS(SELECT 1 FROM marketing_unsubscribes u WHERE u.owner_id=$1 AND u.channel='${channel}' AND u.address=g.address) ORDER BY g.address LIMIT 20000`;
  return { sql, params };
}

/** Signed token for the unsubscribe link of one recipient (no address in the URL). */
export const unsubscribeToken = (secret, recipientId) => createHmac("sha256", `unsubscribe:${secret}`).update(String(recipientId)).digest("base64url").slice(0, 32);
export function validUnsubscribeToken(secret, recipientId, token) {
  if (typeof token !== "string" || token.length !== 32) return false;
  const want = Buffer.from(unsubscribeToken(secret, recipientId));
  return timingSafeEqual(want, Buffer.from(token));
}

const footerTexts = {
  el: { why: "Λαμβάνετε αυτό το μήνυμα επειδή έχετε μείνει στο Hotel Corali και συμφωνήσατε να λαμβάνετε νέα μας.", unsubscribe: "Διαγραφή από τη λίστα" },
  en: { why: "You receive this message because you stayed at Hotel Corali and agreed to hear from us.", unsubscribe: "Unsubscribe" },
  fr: { why: "Vous recevez ce message car vous avez séjourné à l'Hotel Corali et accepté de recevoir nos nouvelles.", unsubscribe: "Se désabonner" },
  de: { why: "Sie erhalten diese Nachricht, weil Sie im Hotel Corali übernachtet und Neuigkeiten von uns zugestimmt haben.", unsubscribe: "Abmelden" },
  it: { why: "Ricevi questo messaggio perché hai soggiornato all'Hotel Corali e hai accettato di ricevere nostre notizie.", unsubscribe: "Annulla iscrizione" },
  es: { why: "Recibe este mensaje porque se alojó en el Hotel Corali y aceptó recibir nuestras noticias.", unsubscribe: "Darse de baja" },
};


/** The e-mail: subject, plain text and HTML (hotel header, optional photo, paragraphs, unsubscribe footer). */
export function renderCampaignEmail({ content, lang, name, imageUrl, unsubscribeUrl, logoUrl, hotelName = "Hotel Corali", brand }) {
  const c = pickContent(content, lang);
  if (!c) return null;
  const f = footerTexts[lang] ?? footerTexts.en;
  const first = firstName(name);
  const subject = fill(c.subject, first), body = fill(c.body, first);
  const b = normalizeBrand({ ...(brand ?? {}), name: brand?.name || hotelName });
  const text = `${body}\n\n—\n${b.name}\n${contactLines(b).join("\n")}\n${f.why}\n${f.unsubscribe}: ${unsubscribeUrl}`;
  // The same designed e-mail as every guest message, with the photo, and why they get it / unsubscribe at the end.
  const html = renderBrandedEmail({ subject, text: body, lang, brand: b, logoUrl, imageUrl, notes: [{ text: f.why }, { text: f.unsubscribe, href: unsubscribeUrl }] });
  return { subject, text, html };
}

/** WhatsApp template language for the guest: their language if the template has it, else the first listed. */
export function whatsappLanguage(codes, lang) {
  const list = String(codes ?? "").split(/[\s,]+/).filter((c) => /^[a-z]{2}(_[A-Z]{2})?$/.test(c));
  return list.find((c) => c === lang || c.startsWith(`${lang}_`)) ?? list[0] ?? "";
}

/** How many messages of each channel may go out in this minute (the cron runs every minute). */
export const batchSize = (rate) => Math.min(MAX_CAMPAIGN_RATE, Math.max(1, Math.round(Number(rate) || 20)));

/** Ready messages the hotel can start from ({name} = the guest's first name). */
export const campaignPresets = {
  christmas: {
    icon: "🎄",
    el: { subject: "Καλά Χριστούγεννα από το Hotel Corali!", body: "Αγαπητέ/ή {name},\n\nΌλη η ομάδα του Hotel Corali σας εύχεται Καλά Χριστούγεννα, με υγεία, αγάπη και χαρά δίπλα στους ανθρώπους σας.\n\nΣας ευχαριστούμε που μείνατε μαζί μας και ελπίζουμε να σας ξαναδούμε σύντομα στο Πίσω Λιβάδι!" },
    en: { subject: "Merry Christmas from Hotel Corali!", body: "Dear {name},\n\nEveryone at Hotel Corali wishes you a Merry Christmas, full of health, love and joy with your loved ones.\n\nThank you for staying with us — we hope to welcome you again soon in Piso Livadi!" },
    fr: { subject: "Joyeux Noël de l'Hotel Corali !", body: "Cher/Chère {name},\n\nToute l'équipe de l'Hotel Corali vous souhaite un joyeux Noël, plein de santé, d'amour et de joie avec vos proches.\n\nMerci d'avoir séjourné chez nous — nous espérons vous revoir bientôt à Piso Livadi !" },
    de: { subject: "Frohe Weihnachten vom Hotel Corali!", body: "Liebe/r {name},\n\ndas ganze Team des Hotel Corali wünscht Ihnen frohe Weihnachten, Gesundheit, Liebe und Freude mit Ihren Liebsten.\n\nDanke für Ihren Aufenthalt — wir freuen uns, Sie bald wieder in Piso Livadi zu begrüßen!" },
    it: { subject: "Buon Natale dall'Hotel Corali!", body: "Caro/a {name},\n\ntutto lo staff dell'Hotel Corali ti augura un Buon Natale, pieno di salute, amore e gioia con i tuoi cari.\n\nGrazie per aver soggiornato da noi — speriamo di rivederti presto a Piso Livadi!" },
    es: { subject: "¡Feliz Navidad desde el Hotel Corali!", body: "Querido/a {name},\n\nTodo el equipo del Hotel Corali le desea una Feliz Navidad, llena de salud, amor y alegría junto a sus seres queridos.\n\nGracias por alojarse con nosotros — ¡esperamos verle pronto de nuevo en Piso Livadi!" },
  },
  newyear: {
    icon: "🥂",
    el: { subject: "Καλή Χρονιά από το Hotel Corali!", body: "Αγαπητέ/ή {name},\n\nΣας ευχόμαστε μια νέα χρονιά γεμάτη υγεία, αγάπη, ταξίδια και όμορφες στιγμές.\n\nΘα χαρούμε πολύ να σας φιλοξενήσουμε ξανά στην Πάρο το καλοκαίρι. Καλή Χρονιά!" },
    en: { subject: "Happy New Year from Hotel Corali!", body: "Dear {name},\n\nWe wish you a new year full of health, love, travels and beautiful moments.\n\nWe would be delighted to welcome you back to Paros this summer. Happy New Year!" },
    fr: { subject: "Bonne année de l'Hotel Corali !", body: "Cher/Chère {name},\n\nNous vous souhaitons une nouvelle année pleine de santé, d'amour, de voyages et de beaux moments.\n\nNous serions ravis de vous accueillir à nouveau à Paros cet été. Bonne année !" },
    de: { subject: "Frohes neues Jahr vom Hotel Corali!", body: "Liebe/r {name},\n\nwir wünschen Ihnen ein neues Jahr voller Gesundheit, Liebe, Reisen und schöner Momente.\n\nWir würden uns sehr freuen, Sie diesen Sommer wieder auf Paros zu begrüßen. Frohes neues Jahr!" },
    it: { subject: "Buon anno dall'Hotel Corali!", body: "Caro/a {name},\n\nti auguriamo un nuovo anno pieno di salute, amore, viaggi e bei momenti.\n\nSaremo felici di accoglierti di nuovo a Paros quest'estate. Buon anno!" },
    es: { subject: "¡Feliz Año Nuevo desde el Hotel Corali!", body: "Querido/a {name},\n\nLe deseamos un año nuevo lleno de salud, amor, viajes y momentos bonitos.\n\nNos encantaría recibirle de nuevo en Paros este verano. ¡Feliz Año Nuevo!" },
  },
  easter: {
    icon: "🕯️",
    el: { subject: "Καλό Πάσχα από το Hotel Corali!", body: "Αγαπητέ/ή {name},\n\nΣας ευχόμαστε Καλή Ανάσταση και Καλό Πάσχα, με υγεία και χαρά!\n\nΤο Πάσχα στην Πάρο είναι μοναδικό — θα χαρούμε να σας δούμε ξανά." },
    en: { subject: "Happy Easter from Hotel Corali!", body: "Dear {name},\n\nWe wish you a joyful Easter, with health and happiness!\n\nEaster in Paros is something special — we would love to see you again." },
    fr: { subject: "Joyeuses Pâques de l'Hotel Corali !", body: "Cher/Chère {name},\n\nNous vous souhaitons de joyeuses Pâques, pleines de santé et de bonheur !\n\nPâques à Paros, c'est unique — nous serions ravis de vous revoir." },
    de: { subject: "Frohe Ostern vom Hotel Corali!", body: "Liebe/r {name},\n\nwir wünschen Ihnen frohe Ostern, Gesundheit und Freude!\n\nOstern auf Paros ist etwas Besonderes — wir würden uns freuen, Sie wiederzusehen." },
    it: { subject: "Buona Pasqua dall'Hotel Corali!", body: "Caro/a {name},\n\nti auguriamo una serena Pasqua, con salute e gioia!\n\nLa Pasqua a Paros è unica — saremo felici di rivederti." },
    es: { subject: "¡Felices Pascuas desde el Hotel Corali!", body: "Querido/a {name},\n\n¡Le deseamos unas felices Pascuas, con salud y alegría!\n\nLa Pascua en Paros es única — nos encantaría volver a verle." },
  },
  season: {
    icon: "☀️",
    el: { subject: "Ανοίγουμε για τη νέα σεζόν!", body: "Αγαπητέ/ή {name},\n\nΤο Hotel Corali ετοιμάζεται για τη νέα σεζόν και θα χαρούμε πολύ να σας ξαναδούμε στο Πίσω Λιβάδι.\n\nΚλείστε απευθείας από την ιστοσελίδα μας για την καλύτερη τιμή: https://booking.hotelcorali.gr" },
    en: { subject: "We are opening for the new season!", body: "Dear {name},\n\nHotel Corali is getting ready for the new season and we would love to see you again in Piso Livadi.\n\nBook directly on our website for the best price: https://booking.hotelcorali.gr" },
    fr: { subject: "Nous ouvrons pour la nouvelle saison !", body: "Cher/Chère {name},\n\nL'Hotel Corali se prépare pour la nouvelle saison et nous serions ravis de vous revoir à Piso Livadi.\n\nRéservez directement sur notre site pour le meilleur prix : https://booking.hotelcorali.gr" },
    de: { subject: "Wir öffnen für die neue Saison!", body: "Liebe/r {name},\n\ndas Hotel Corali bereitet sich auf die neue Saison vor und wir würden Sie gerne wieder in Piso Livadi begrüßen.\n\nBuchen Sie direkt auf unserer Website zum besten Preis: https://booking.hotelcorali.gr" },
    it: { subject: "Apriamo per la nuova stagione!", body: "Caro/a {name},\n\nl'Hotel Corali si prepara per la nuova stagione e saremo felici di rivederti a Piso Livadi.\n\nPrenota direttamente sul nostro sito per il miglior prezzo: https://booking.hotelcorali.gr" },
    es: { subject: "¡Abrimos para la nueva temporada!", body: "Querido/a {name},\n\nEl Hotel Corali se prepara para la nueva temporada y nos encantaría volver a verle en Piso Livadi.\n\nReserve directamente en nuestra web al mejor precio: https://booking.hotelcorali.gr" },
  },
  offer: {
    icon: "🏷️",
    el: { subject: "Μια ειδική προσφορά για εσάς", body: "Αγαπητέ/ή {name},\n\nΩς παλιός μας πελάτης έχετε έκπτωση 10% στην επόμενη κράτησή σας με τον κωδικό CORALI10, για κρατήσεις από την ιστοσελίδα μας.\n\nhttps://booking.hotelcorali.gr" },
    en: { subject: "A special offer for you", body: "Dear {name},\n\nAs a returning guest you get 10% off your next stay with the code CORALI10 when you book on our website.\n\nhttps://booking.hotelcorali.gr" },
    fr: { subject: "Une offre spéciale pour vous", body: "Cher/Chère {name},\n\nEn tant que client fidèle, vous bénéficiez de 10 % de réduction sur votre prochain séjour avec le code CORALI10 en réservant sur notre site.\n\nhttps://booking.hotelcorali.gr" },
    de: { subject: "Ein besonderes Angebot für Sie", body: "Liebe/r {name},\n\nals Stammgast erhalten Sie 10 % Rabatt auf Ihren nächsten Aufenthalt mit dem Code CORALI10 bei Buchung auf unserer Website.\n\nhttps://booking.hotelcorali.gr" },
    it: { subject: "Un'offerta speciale per te", body: "Caro/a {name},\n\ncome ospite affezionato hai il 10% di sconto sul prossimo soggiorno con il codice CORALI10 prenotando sul nostro sito.\n\nhttps://booking.hotelcorali.gr" },
    es: { subject: "Una oferta especial para usted", body: "Querido/a {name},\n\nComo cliente habitual tiene un 10% de descuento en su próxima estancia con el código CORALI10 al reservar en nuestra web.\n\nhttps://booking.hotelcorali.gr" },
  },
};
