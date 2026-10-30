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
 * Ready WhatsApp templates to submit in Meta Business Manager (WhatsApp → Message templates): logo as image header,
 * the text with {{1}} {{2}}… in the order the PMS fills them, and the hotel's name and website as footer.
 */
export function whatsappTemplateSuggestions(raw) {
  const brand = normalizeBrand(raw);
  const site = brand.website.replace(/^https?:\/\//, "");
  const footer = [brand.name, site].filter(Boolean).join(" · ").slice(0, 60);
  const t = (event, name, el, en) => ({ event, name, header: "IMAGE (λογότυπο / logo)", el, en, footer });
  return [
    t("confirmation", "booking_confirmation", "✅ Η κράτησή σας *{{1}}* επιβεβαιώθηκε!\n\n📅 Άφιξη: {{2}}\n📅 Αναχώρηση: {{3}}\n\nΑνυπομονούμε να σας καλωσορίσουμε στην Πάρο.", "✅ Your booking *{{1}}* is confirmed!\n\n📅 Arrival: {{2}}\n📅 Departure: {{3}}\n\nWe look forward to welcoming you to Paros."),
    t("pre_arrival", "pre_arrival", "Γεια σας {{1}} 👋\n\nΣας περιμένουμε στις *{{2}}*. Ολοκληρώστε το online check-in για γρήγορη άφιξη:\n{{3}}", "Hello {{1}} 👋\n\nWe look forward to seeing you on *{{2}}*. Complete your online check-in for a quick arrival:\n{{3}}"),
    t("checkin", "online_checkin", "Γεια σας {{1}},\n\nκερδίστε χρόνο στην άφιξη: ολοκληρώστε το online check-in εδώ:\n{{2}}", "Hello {{1}},\n\nsave time on arrival: complete your online check-in here:\n{{2}}"),
    t("welcome", "welcome_message", "Καλώς ήρθατε {{1}}! 🌊\n\nΓια οτιδήποτε χρειαστείτε, η ρεσεψιόν είναι στη διάθεσή σας. Καλή διαμονή!", "Welcome {{1}}! 🌊\n\nIf you need anything, reception is here for you. Enjoy your stay!"),
    t("balance", "balance_reminder", "Γεια σας {{1}},\n\nτο υπόλοιπο της κράτησής σας είναι *{{2}}*. Μπορείτε να το πληρώσετε με ασφάλεια εδώ:\n{{3}}", "Hello {{1}},\n\nthe balance of your booking is *{{2}}*. You can pay it securely here:\n{{3}}"),
    t("pre_departure", "pre_departure", "Γεια σας {{1}},\n\nη αναχώρησή σας είναι *{{2}}*. Ευχαριστούμε που μείνατε μαζί μας — καλό ταξίδι! ☀️", "Hello {{1}},\n\nyour departure is on *{{2}}*. Thank you for staying with us — have a safe trip! ☀️"),
    t("payment_failed", "payment_failed", "Γεια σας {{1}},\n\nη πληρωμή *{{2}}* δεν ολοκληρώθηκε. Μπορείτε να τη δοκιμάσετε ξανά εδώ:\n{{3}}\n\nΠροθεσμία: {{4}}", "Hello {{1}},\n\nthe payment of *{{2}}* did not go through. You can try again here:\n{{3}}\n\nDeadline: {{4}}"),
    t("cancellation", "booking_cancelled", "Η κράτηση *{{1}}* ({{2}} – {{3}}) ακυρώθηκε.\n\nΑιτία: {{4}}\nΕπιστροφή: {{5}}", "Booking *{{1}}* ({{2}} – {{3}}) has been cancelled.\n\nReason: {{4}}\nRefund: {{5}}"),
    t("review", "review_request", "Γεια σας {{1}} 🙏\n\nΕλπίζουμε να απολαύσατε τη διαμονή σας. Θα μας λέγατε τη γνώμη σας;\n{{2}}", "Hello {{1}} 🙏\n\nWe hope you enjoyed your stay. Would you share your opinion?\n{{2}}"),
  ];
}
