// Browser-safe DM reply helpers (pure; unit tested).

const replies: Record<string, string> = {
  el: "Γεια σας και ευχαριστούμε για το μήνυμα! Δείτε διαθεσιμότητα και την καλύτερη απευθείας τιμή εδώ: {link} — Αν θέλετε, στείλτε μας ημερομηνίες και αριθμό ατόμων και θα σας βοηθήσουμε.",
  en: "Hello and thank you for your message! You can check availability and our best direct rate here: {link} — or send us your dates and number of guests and we will gladly help.",
  fr: "Bonjour et merci pour votre message ! Consultez nos disponibilités et notre meilleur tarif direct ici : {link} — ou envoyez-nous vos dates et le nombre de personnes.",
  de: "Hallo und danke für Ihre Nachricht! Verfügbarkeit und unseren besten Direktpreis finden Sie hier: {link} – oder senden Sie uns Ihre Reisedaten und die Personenzahl.",
  it: "Ciao e grazie per il messaggio! Verifica la disponibilità e la nostra migliore tariffa diretta qui: {link} — oppure inviaci le date e il numero di persone.",
  es: "¡Hola y gracias por tu mensaje! Consulta la disponibilidad y nuestra mejor tarifa directa aquí: {link} — o envíanos tus fechas y el número de personas.",
};

/** Guess the guest's language from their message (Greek script or common words), defaulting to English. */
export function detectLanguage(text: string): keyof typeof replies {
  if (/[Ͱ-Ͽ]/.test(text)) return "el";
  const t = ` ${text.toLowerCase()} `;
  if (/ (bonjour|merci|chambre|réserv)/.test(t)) return "fr";
  if (/ (hallo|danke|zimmer|buchen)/.test(t)) return "de";
  if (/ (ciao|grazie|camera|prenot)/.test(t)) return "it";
  if (/ (hola|gracias|habitaci|reserv)/.test(t)) return "es";
  return "en";
}

/** Suggested DM reply with a tracked booking link; staff review and send it (never automatic). */
export function suggestedReply(message: string, bookingUrl: string, platform: string) {
  const lang = detectLanguage(message);
  const link = `${bookingUrl}${bookingUrl.includes("?") ? "&" : "?"}lang=${lang}&utm_source=${encodeURIComponent(platform)}&utm_medium=dm`;
  return replies[lang].replace("{link}", link);
}
