// Branded messages (pure; unit tested, shared by the PMS and the cron workers): every e-mail to guests goes out as a
// designed HTML page with the hotel's logo and its contact details at the end, and every WhatsApp text ends with the
// same details. The hotel edits them in PMS → Αυτόματα μηνύματα → «Εμφάνιση μηνυμάτων».

export const defaultBrand = {
  name: "Hotel Corali",
  address: "Πίσω Λιβάδι, Πάρος 844 00",
  phone: "",
  email: "",
  website: "https://hotelcorali.gr",
  accent: "#c9a227",
  whatsappSignature: true,
};

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const url = (v) => { const s = str(v, 200); if (!s) return ""; const full = /^https?:\/\//i.test(s) ? s : `https://${s}`; try { return new URL(full).protocol === "https:" ? full.replace(/\/$/, "") : ""; } catch { return ""; } };

export function normalizeBrand(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const accent = /^#[0-9a-f]{6}$/i.test(String(r.accent ?? "")) ? String(r.accent) : defaultBrand.accent;
  const email = str(r.email, 120);
  return {
    name: str(r.name, 80) || defaultBrand.name,
    address: r.address === undefined ? defaultBrand.address : str(r.address, 160),
    phone: str(r.phone, 40),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    website: r.website === undefined ? defaultBrand.website : url(r.website),
    accent,
    whatsappSignature: r.whatsappSignature !== false,
  };
}

/** A missing phone or e-mail is taken from what the PMS already knows (TV reception phone, SMTP sender). */
export function withFallbacks(brand, { phone = "", email = "" } = {}) {
  const from = String(email).match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/)?.[0] ?? "";
  return { ...brand, phone: brand.phone || str(phone, 40), email: brand.email || from };
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const URL_RE = /https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;

const buttonLabels = {
  checkin: { el: "Online check-in", en: "Online check-in", fr: "Enregistrement en ligne", de: "Online-Check-in", it: "Check-in online", es: "Check-in online" },
  pay: { el: "Πληρωμή", en: "Pay now", fr: "Payer", de: "Jetzt bezahlen", it: "Paga ora", es: "Pagar" },
  manage: { el: "Η κράτησή μου", en: "My booking", fr: "Ma réservation", de: "Meine Buchung", it: "La mia prenotazione", es: "Mi reserva" },
  card: { el: "Ψηφιακό κλειδί", en: "Digital key", fr: "Clé numérique", de: "Digitaler Schlüssel", it: "Chiave digitale", es: "Llave digital" },
  review: { el: "Η γνώμη σας", en: "Share your review", fr: "Votre avis", de: "Ihre Bewertung", it: "La sua recensione", es: "Su opinión" },
  book: { el: "Κράτηση", en: "Book now", fr: "Réserver", de: "Jetzt buchen", it: "Prenota", es: "Reservar" },
  open: { el: "Άνοιγμα", en: "Open", fr: "Ouvrir", de: "Öffnen", it: "Apri", es: "Abrir" },
};

/** The button under a paragraph with a link, named after what the link opens. */
export function buttonLabel(link, lang) {
  const k = /check-?in/i.test(link) ? "checkin" : /pay|balance|payment/i.test(link) ? "pay" : /manage-booking|guest-app|my-booking/i.test(link) ? "manage" : /\/card\//i.test(link) ? "card" : /review/i.test(link) ? "review" : /\/book\b/i.test(link) ? "book" : "open";
  return buttonLabels[k][lang] ?? buttonLabels[k].en;
}

const inline = (s) => esc(s)
  .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
  .replace(URL_RE, (u) => `<a href="${u}" style="color:#1b5968;word-break:break-all">${u}</a>`);

function block(p, lang, accent) {
  const lines = p.split("\n");
  if (/^\*{3}.*\*{3}$/.test(p.trim())) return `<p style="margin:0 0 18px;padding:10px 14px;border-radius:8px;background:#fff6dc;color:#7a5a00;font-family:Arial,sans-serif;font-size:13px">${inline(p.trim().replace(/^\*+\s*|\s*\*+$/g, ""))}</p>`;
  if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul style="margin:0 0 18px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
  const links = p.match(URL_RE) ?? [];
  const html = `<p style="margin:0 0 18px">${lines.map(inline).join("<br>")}</p>`;
  if (!links.length) return html;
  const link = links[0];
  return `${html}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:-4px 0 22px"><tr><td style="border-radius:10px;background:${accent}"><a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#1d2b30;text-decoration:none">${esc(buttonLabel(link, lang))} →</a></td></tr></table>`;
}

/** Contact lines at the end of every e-mail and WhatsApp message. */
export function contactLines(brand) {
  const site = brand.website ? brand.website.replace(/^https?:\/\//, "") : "";
  return [brand.address && `📍 ${brand.address}`, brand.phone && `☎ ${brand.phone}`, brand.email && `✉ ${brand.email}`, site && `🌐 ${site}`].filter(Boolean);
}

/** The plain message (with {placeholders} already filled) as a designed e-mail. */
/** `imageUrl`: a wide photo under the logo; `notes`: small lines under the contact details (e.g. unsubscribe link). */
export function renderBrandedEmail({ subject, text, lang = "en", brand: raw, logoUrl = "", imageUrl = "", notes = [] }) {
  const brand = normalizeBrand(raw);
  const body = String(text ?? "").replace(/\r/g, "").trim();
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => block(p, lang, brand.accent)).join("");
  const preheader = body.replace(/\*{3}[^*]*\*{3}/g, "").replace(/\s+/g, " ").trim().slice(0, 110);
  const site = brand.website ? brand.website.replace(/^https?:\/\//, "") : "";
  const contact = [
    brand.address && esc(brand.address),
    brand.phone && `<a href="tel:${esc(brand.phone.replace(/[^\d+]/g, ""))}" style="color:#e9f1f2;text-decoration:none">☎ ${esc(brand.phone)}</a>`,
    brand.email && `<a href="mailto:${esc(brand.email)}" style="color:#e9f1f2;text-decoration:none">✉ ${esc(brand.email)}</a>`,
    site && `<a href="${esc(brand.website)}" style="color:#e9f1f2;text-decoration:none">🌐 ${esc(site)}</a>`,
  ].filter(Boolean);
  const logo = logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(brand.name)}" width="190" style="display:block;margin:0 auto;max-width:190px;height:auto;border:0">` : `<span style="font-size:26px;color:#173e47">${esc(brand.name)}</span>`;
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f1ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(23,62,71,.08)">
<tr><td style="padding:26px 24px 20px;text-align:center;background:#ffffff">${logo}</td></tr>
<tr><td style="height:4px;background:${brand.accent};font-size:0;line-height:0">&nbsp;</td></tr>
${imageUrl ? `<tr><td><img src="${esc(imageUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>` : ""}
<tr><td style="padding:32px 32px 14px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#1d2b30">${paragraphs}</td></tr>
<tr><td style="padding:22px 32px 26px;background:#173e47;font-family:Arial,sans-serif;font-size:13px;line-height:1.8;color:#e9f1f2;text-align:center">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#ffffff;margin-bottom:6px">${esc(brand.name)}</div>
${contact.join("<br>")}
${notes.length ? `<div style="margin-top:14px;font-size:11px;color:#a9c0c5">${notes.map((n) => (n.href ? `<a href="${esc(n.href)}" style="color:#a9c0c5">${esc(n.text)}</a>` : esc(n.text))).join("<br>")}</div>` : ""}
</td></tr>
</table>
</td></tr></table></body></html>`;
}

/** WhatsApp free text ends with the hotel's name and contact details (*bold* is WhatsApp formatting). */
export function whatsappSignature(raw) {
  const brand = normalizeBrand(raw);
  if (!brand.whatsappSignature) return "";
  return `\n\n—\n*${brand.name}*\n${contactLines(brand).join("\n")}`;
}

const locales = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" };
/** 2026-06-12 → «Παρασκευή 12 Ιουνίου 2026» in the guest's language (any other text is left as it is). */
export function stayDate(value, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return String(value ?? "");
  return new Intl.DateTimeFormat(locales[lang] ?? "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

/**
 * Ready WhatsApp templates for Meta (WhatsApp Manager → Message templates, or the PMS "Submit to Meta" button):
 * the hotel's name as text header, the text in the six booking languages with {{1}} {{2}}… in the order the PMS
 * fills them (scripts/automation-core.mjs → whatsappVariables), sample values for Meta's review, and the hotel's
 * name and website as footer. No text starts or ends with a variable: Meta rejects those.
 */
const WA_TEXTS = {
  confirmation: { name: "booking_confirmation", samples: ["CRL-1234", "10 Jun 2027", "14 Jun 2027"], text: {
    el: "✅ Η κράτησή σας *{{1}}* επιβεβαιώθηκε!\n\n📅 Άφιξη: {{2}}\n📅 Αναχώρηση: {{3}}\n\nΑνυπομονούμε να σας καλωσορίσουμε στην Πάρο.",
    en: "✅ Your booking *{{1}}* is confirmed!\n\n📅 Arrival: {{2}}\n📅 Departure: {{3}}\n\nWe look forward to welcoming you to Paros.",
    fr: "✅ Votre réservation *{{1}}* est confirmée !\n\n📅 Arrivée : {{2}}\n📅 Départ : {{3}}\n\nNous avons hâte de vous accueillir à Paros.",
    de: "✅ Ihre Buchung *{{1}}* ist bestätigt!\n\n📅 Anreise: {{2}}\n📅 Abreise: {{3}}\n\nWir freuen uns, Sie auf Paros begrüßen zu dürfen.",
    it: "✅ La tua prenotazione *{{1}}* è confermata!\n\n📅 Arrivo: {{2}}\n📅 Partenza: {{3}}\n\nNon vediamo l’ora di accoglierti a Paros.",
    es: "✅ ¡Tu reserva *{{1}}* está confirmada!\n\n📅 Llegada: {{2}}\n📅 Salida: {{3}}\n\nTe esperamos con ilusión en Paros." } },
  pre_arrival: { name: "pre_arrival", samples: ["Maria", "10 Jun 2027", "https://booking.hotelcorali.gr/checkin/abc123"], text: {
    el: "Γεια σας {{1}} 👋\n\nΣας περιμένουμε στις *{{2}}*. Ολοκληρώστε το online check-in για γρήγορη άφιξη:\n{{3}}\n\nΤα λέμε σύντομα!",
    en: "Hello {{1}} 👋\n\nWe look forward to seeing you on *{{2}}*. Complete your online check-in for a quick arrival:\n{{3}}\n\nSee you soon!",
    fr: "Bonjour {{1}} 👋\n\nNous avons hâte de vous accueillir le *{{2}}*. Effectuez votre enregistrement en ligne pour une arrivée rapide :\n{{3}}\n\nÀ très bientôt !",
    de: "Hallo {{1}} 👋\n\nWir freuen uns auf Sie am *{{2}}*. Erledigen Sie den Online-Check-in für eine schnelle Anreise:\n{{3}}\n\nBis bald!",
    it: "Ciao {{1}} 👋\n\nTi aspettiamo il *{{2}}*. Completa il check-in online per un arrivo veloce:\n{{3}}\n\nA presto!",
    es: "Hola {{1}} 👋\n\nTe esperamos el *{{2}}*. Completa el registro en línea para una llegada rápida:\n{{3}}\n\n¡Hasta pronto!" } },
  checkin: { name: "online_checkin", samples: ["Maria", "https://booking.hotelcorali.gr/checkin/abc123"], text: {
    el: "Γεια σας {{1}},\n\nκερδίστε χρόνο στην άφιξη: ολοκληρώστε το online check-in εδώ:\n{{2}}\n\nΧρειάζονται μόνο λίγα λεπτά.",
    en: "Hello {{1}},\n\nsave time on arrival: complete your online check-in here:\n{{2}}\n\nIt only takes a few minutes.",
    fr: "Bonjour {{1}},\n\ngagnez du temps à l’arrivée : effectuez votre enregistrement en ligne ici :\n{{2}}\n\nCela ne prend que quelques minutes.",
    de: "Hallo {{1}},\n\nsparen Sie Zeit bei der Anreise: Erledigen Sie den Online-Check-in hier:\n{{2}}\n\nEs dauert nur wenige Minuten.",
    it: "Ciao {{1}},\n\nrisparmia tempo all’arrivo: completa il check-in online qui:\n{{2}}\n\nBastano pochi minuti.",
    es: "Hola {{1}},\n\nahorra tiempo a tu llegada: completa el registro en línea aquí:\n{{2}}\n\nSolo te llevará unos minutos." } },
  welcome: { name: "welcome_message", samples: ["Maria"], text: {
    el: "Καλώς ήρθατε {{1}}! 🌊\n\nΓια οτιδήποτε χρειαστείτε, η ρεσεψιόν είναι στη διάθεσή σας. Καλή διαμονή!",
    en: "Welcome {{1}}! 🌊\n\nIf you need anything, reception is here for you. Enjoy your stay!",
    fr: "Bienvenue {{1}} ! 🌊\n\nPour tout ce dont vous avez besoin, la réception est à votre disposition. Bon séjour !",
    de: "Willkommen, {{1}}! 🌊\n\nWenn Sie etwas brauchen, ist die Rezeption für Sie da. Einen schönen Aufenthalt!",
    it: "Benvenuto {{1}}! 🌊\n\nPer qualsiasi cosa, la reception è a tua disposizione. Buon soggiorno!",
    es: "¡Bienvenido, {{1}}! 🌊\n\nPara cualquier cosa que necesites, la recepción está a tu disposición. ¡Feliz estancia!" } },
  balance: { name: "balance_reminder", samples: ["Maria", "€240.00", "https://booking.hotelcorali.gr/pay/abc123"], text: {
    el: "Γεια σας {{1}},\n\nτο υπόλοιπο της κράτησής σας είναι *{{2}}*. Μπορείτε να το πληρώσετε με ασφάλεια εδώ:\n{{3}}\n\nΕυχαριστούμε!",
    en: "Hello {{1}},\n\nthe balance of your booking is *{{2}}*. You can pay it securely here:\n{{3}}\n\nThank you!",
    fr: "Bonjour {{1}},\n\nle solde de votre réservation est de *{{2}}*. Vous pouvez le régler en toute sécurité ici :\n{{3}}\n\nMerci !",
    de: "Hallo {{1}},\n\nder Restbetrag Ihrer Buchung beträgt *{{2}}*. Sie können ihn hier sicher bezahlen:\n{{3}}\n\nVielen Dank!",
    it: "Ciao {{1}},\n\nil saldo della tua prenotazione è *{{2}}*. Puoi pagarlo in modo sicuro qui:\n{{3}}\n\nGrazie!",
    es: "Hola {{1}},\n\nel saldo de tu reserva es *{{2}}*. Puedes pagarlo de forma segura aquí:\n{{3}}\n\n¡Gracias!" } },
  pre_departure: { name: "pre_departure", samples: ["Maria", "14 Jun 2027"], text: {
    el: "Γεια σας {{1}},\n\nη αναχώρησή σας είναι *{{2}}*. Ευχαριστούμε που μείνατε μαζί μας — καλό ταξίδι! ☀️",
    en: "Hello {{1}},\n\nyour departure is on *{{2}}*. Thank you for staying with us — have a safe trip! ☀️",
    fr: "Bonjour {{1}},\n\nvotre départ est prévu le *{{2}}*. Merci d’avoir séjourné chez nous — bon voyage ! ☀️",
    de: "Hallo {{1}},\n\nIhre Abreise ist am *{{2}}*. Danke, dass Sie bei uns waren — gute Reise! ☀️",
    it: "Ciao {{1}},\n\nla tua partenza è il *{{2}}*. Grazie per aver soggiornato da noi — buon viaggio! ☀️",
    es: "Hola {{1}},\n\ntu salida es el *{{2}}*. Gracias por alojarte con nosotros, ¡buen viaje! ☀️" } },
  payment_failed: { name: "payment_failed", samples: ["Maria", "€240.00", "https://booking.hotelcorali.gr/pay/abc123", "12 Jun 2027"], text: {
    el: "Γεια σας {{1}},\n\nη πληρωμή *{{2}}* δεν ολοκληρώθηκε. Μπορείτε να τη δοκιμάσετε ξανά εδώ:\n{{3}}\n\nΠροθεσμία: {{4}}\n\nΕυχαριστούμε!",
    en: "Hello {{1}},\n\nthe payment of *{{2}}* did not go through. You can try again here:\n{{3}}\n\nDeadline: {{4}}\n\nThank you!",
    fr: "Bonjour {{1}},\n\nle paiement de *{{2}}* n’a pas abouti. Vous pouvez réessayer ici :\n{{3}}\n\nDate limite : {{4}}\n\nMerci !",
    de: "Hallo {{1}},\n\ndie Zahlung von *{{2}}* ist fehlgeschlagen. Sie können es hier erneut versuchen:\n{{3}}\n\nFrist: {{4}}\n\nVielen Dank!",
    it: "Ciao {{1}},\n\nil pagamento di *{{2}}* non è andato a buon fine. Puoi riprovare qui:\n{{3}}\n\nScadenza: {{4}}\n\nGrazie!",
    es: "Hola {{1}},\n\nel pago de *{{2}}* no se ha completado. Puedes intentarlo de nuevo aquí:\n{{3}}\n\nPlazo: {{4}}\n\n¡Gracias!" } },
  cancellation: { name: "booking_cancelled", samples: ["CRL-1234", "10 Jun 2027", "14 Jun 2027", "Guest request", "€240.00 within 5–10 days"], text: {
    el: "Η κράτηση *{{1}}* ({{2}} – {{3}}) ακυρώθηκε.\n\nΑιτία: {{4}}\nΕπιστροφή: {{5}}\n\nΓια οποιαδήποτε απορία, απαντήστε σε αυτό το μήνυμα.",
    en: "Booking *{{1}}* ({{2}} – {{3}}) has been cancelled.\n\nReason: {{4}}\nRefund: {{5}}\n\nIf you have any questions, just reply to this message.",
    fr: "La réservation *{{1}}* ({{2}} – {{3}}) a été annulée.\n\nMotif : {{4}}\nRemboursement : {{5}}\n\nPour toute question, répondez simplement à ce message.",
    de: "Die Buchung *{{1}}* ({{2}} – {{3}}) wurde storniert.\n\nGrund: {{4}}\nErstattung: {{5}}\n\nBei Fragen antworten Sie einfach auf diese Nachricht.",
    it: "La prenotazione *{{1}}* ({{2}} – {{3}}) è stata cancellata.\n\nMotivo: {{4}}\nRimborso: {{5}}\n\nPer qualsiasi domanda, rispondi a questo messaggio.",
    es: "La reserva *{{1}}* ({{2}} – {{3}}) ha sido cancelada.\n\nMotivo: {{4}}\nReembolso: {{5}}\n\nSi tienes alguna pregunta, responde a este mensaje." } },
  review: { name: "review_request", samples: ["Maria", "https://booking.hotelcorali.gr/review/abc123"], text: {
    el: "Γεια σας {{1}} 🙏\n\nΕλπίζουμε να απολαύσατε τη διαμονή σας. Θα μας λέγατε τη γνώμη σας;\n{{2}}\n\nΕυχαριστούμε που μας επιλέξατε!",
    en: "Hello {{1}} 🙏\n\nWe hope you enjoyed your stay. Would you share your opinion?\n{{2}}\n\nThank you for choosing us!",
    fr: "Bonjour {{1}} 🙏\n\nNous espérons que vous avez apprécié votre séjour. Voulez-vous partager votre avis ?\n{{2}}\n\nMerci de nous avoir choisis !",
    de: "Hallo {{1}} 🙏\n\nWir hoffen, Sie haben Ihren Aufenthalt genossen. Möchten Sie uns Ihre Meinung mitteilen?\n{{2}}\n\nDanke, dass Sie uns gewählt haben!",
    it: "Ciao {{1}} 🙏\n\nSperiamo che il soggiorno ti sia piaciuto. Ci lasceresti la tua opinione?\n{{2}}\n\nGrazie per averci scelto!",
    es: "Hola {{1}} 🙏\n\nEsperamos que hayas disfrutado de tu estancia. ¿Nos dejas tu opinión?\n{{2}}\n\n¡Gracias por elegirnos!" } },
};
export const WHATSAPP_TEMPLATE_LANGS = ["el", "en", "fr", "de", "it", "es"];

export function whatsappTemplateSuggestions(raw) {
  const brand = normalizeBrand(raw);
  const site = brand.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const footer = [brand.name, site].filter(Boolean).join(" · ").slice(0, 60);
  // Text header (the hotel's name): the PMS sends body variables only, so an image header would make every send fail.
  const headerText = waHeaderText(brand.name);
  return Object.entries(WA_TEXTS).map(([event, x]) => ({ event, name: x.name, header: `TEXT: ${headerText}`, headerText, el: x.text.el, en: x.text.en, texts: x.text, samples: x.samples, footer }));
}

/** Header text Meta accepts: one line, no emoji, asterisks or variables, at most 60 characters. */
function waHeaderText(name) {
  return String(name || "Hotel").replace(/[\r\n*_~`{}]/g, " ").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Hotel";
}

/** Reasons Meta would reject a template body (empty when it looks fine). */
export function whatsappTemplateProblems(text, sampleCount) {
  const problems = [], s = String(text ?? "");
  const vars = [...s.matchAll(/{{(\d+)}}/g)].map((m) => Number(m[1]));
  if (!s.trim()) problems.push("EMPTY");
  if (s.length > 1024) problems.push("TOO_LONG");
  if (/^\s*{{\d+}}/.test(s)) problems.push("STARTS_WITH_VARIABLE");
  if (/{{\d+}}\s*$/.test(s)) problems.push("ENDS_WITH_VARIABLE");
  if (/{{\d+}}\s*{{\d+}}/.test(s)) problems.push("ADJACENT_VARIABLES");
  const distinct = [...new Set(vars)].sort((a, b) => a - b);
  if (distinct.some((v, i) => v !== i + 1)) problems.push("VARIABLES_NOT_SEQUENTIAL");
  if (sampleCount !== undefined && distinct.length !== sampleCount) problems.push("SAMPLE_COUNT");
  if (/\n{3,}/.test(s)) problems.push("TOO_MANY_NEWLINES");
  return problems;
}

/** Body of POST /{waba-id}/message_templates for one suggestion in one language. */
export function whatsappTemplatePayload(suggestion, lang) {
  const text = suggestion.texts?.[lang];
  if (!text) throw Error("UNKNOWN_LANGUAGE");
  const components = [];
  if (suggestion.headerText) components.push({ type: "HEADER", format: "TEXT", text: suggestion.headerText });
  components.push({ type: "BODY", text, example: { body_text: [suggestion.samples] } });
  if (suggestion.footer) components.push({ type: "FOOTER", text: suggestion.footer });
  return { name: suggestion.name, language: lang, category: "UTILITY", components };
}
