// Built-in answers for the booking-engine assistant when no AI key is configured or the AI is unavailable (pure;
// unit tested). Answers come from the reservation policy text, which is already in the guest's language.

export type FaqTopic = "cancel" | "payment" | "arrival" | "climate" | "access" | "transfer" | "manage" | "rooms";

const topics: [FaqTopic, RegExp][] = [
  ["manage", /(change|modify|my booking|amend|αλλαγ|τροποπ|κράτησή μου|modif|änder|meine buchung|cambi|modific|mi reserva)/i],
  ["cancel", /(cancel|ακύρ|ακυρ|annul|storn|cancell|cancelac|refund|επιστροφ|rembours|erstatt|rimbors|reembols)/i],
  ["payment", /(pay|deposit|prepay|card|last.?minute|πληρω|προκαταβ|εξόφλ|κάρτα|τελευταίας|paie|acompte|carte|zahl|anzahl|karte|pagam|acconto|carta|pago|depósito|tarjeta)/i],
  ["climate", /(climate|tax|fee|τέλος|φόρο|κλιματ|taxe|climat|klima|steuer|gebühr|tassa|clima|tasa|impuesto)/i],
  ["access", /(step|stair|lift|elevator|luggage|access|σκαλ|ασανσέρ|ανελκυστ|αποσκευ|πρόσβασ|marche|escalier|ascenseur|bagage|accès|stufe|treppe|aufzug|gepäck|zugang|scal|ascensore|bagagl|accesso|escal|ascensor|equipaje|acceso)/i],
  ["transfer", /(transfer|airport|port|ferry|taxi|pick.?up|αεροδρ|λιμάν|ταξί|μεταφορ|aéroport|navette|flughafen|hafen|fähre|aeroporto|porto|traghetto|aeropuerto|puerto|ferri)/i],
  ["arrival", /(check.?in|check.?out|arriv|depart|time|άφιξ|αναχώρ|ώρα|heure|ankunft|anreise|abreise|uhr|arrivo|partenza|orario|llegada|salida|hora)/i],
  ["rooms", /(room|price|rate|cost|how much|available|availability|δωμάτ|τιμή|τιμές|πόσο|κοστ|διαθεσιμ|chambre|prix|combien|coût|disponib|zimmer|preis|kostet|wie viel|verfügbar|camera|prezz|quanto|costa|habitaci|precio|cuánto|cuesta)/i],
];

export function detectTopics(question: string): FaqTopic[] {
  return topics.filter(([, re]) => re.test(question)).map(([t]) => t);
}

/** Policy paragraphs (heading + text) keyed by the topic their heading or text matches. */
export function policyParagraphs(policyText: string): { topic: FaqTopic | null; text: string }[] {
  return policyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const head = p.split("\n")[0];
    const topic = (["cancel", "payment", "climate", "access", "arrival"] as FaqTopic[]).find((t) => topics.find(([k]) => k === t)![1].test(head)) ?? null;
    return { topic, text: p };
  });
}

export type FaqText = { fallback: string; transfer: string; manage: string; rooms: string };

/** Prices from the guest's current search (lines "Room: N available; plan total …"), narrowed to a room the guest names. */
export function searchPrices(question: string, context: string): string[] {
  const lines = context.split("\n").filter((l) => / available; /.test(l));
  const q = question.toLowerCase();
  const named = lines.filter((l) => l.split(":")[0].toLowerCase().split(/\s+/).some((w) => w.length > 3 && q.includes(w)));
  return named.length ? named : lines;
}

/** Best built-in answer: matching policy paragraphs, prices from the current search, or a short pointer. */
export function faqAnswer(question: string, policyText: string, text: FaqText, context = ""): string {
  const wanted = detectTopics(question);
  if (!wanted.length) return text.fallback;
  const paragraphs = policyParagraphs(policyText);
  const parts: string[] = [];
  for (const topic of wanted) {
    if (topic === "transfer") parts.push(text.transfer);
    else if (topic === "manage") parts.push(text.manage);
    else if (topic === "rooms") { const prices = searchPrices(question, context); parts.push(prices.length ? prices.slice(0, 4).join("\n") : text.rooms); }
    else for (const p of paragraphs.filter((p) => p.topic === topic)) if (!parts.includes(p.text)) parts.push(p.text);
    if (parts.length >= 3) break;
  }
  return parts.length ? parts.join("\n\n") : text.fallback;
}
