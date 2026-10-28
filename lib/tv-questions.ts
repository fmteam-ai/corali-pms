// Ready questions on the TV assistant tab (pure; unit tested): the hotel adds, edits, removes and orders them in
// PMS → Corali TV, per language; a language left empty shows the English (or Greek) text.

export type TvQuestion = Partial<Record<"el" | "en" | "fr" | "de" | "it" | "es", string>>;
const langs = ["el", "en", "fr", "de", "it", "es"] as const;
export const MAX_TV_QUESTIONS = 12;

export const defaultTvQuestions: TvQuestion[] = [
  { el: "Τι ώρα είναι το πρωινό;", en: "What time is breakfast?", fr: "À quelle heure est le petit-déjeuner ?", de: "Wann gibt es Frühstück?", it: "A che ora è la colazione?", es: "¿A qué hora es el desayuno?" },
  { el: "Πού να φάω απόψε κοντά;", en: "Where can I eat tonight nearby?", fr: "Où dîner ce soir près d'ici ?", de: "Wo kann ich heute Abend in der Nähe essen?", it: "Dove mangiare stasera qui vicino?", es: "¿Dónde cenar esta noche cerca?" },
  { el: "Ποια παραλία σήμερα, με τον αέρα;", en: "Which beach today, with this wind?", fr: "Quelle plage aujourd'hui, avec ce vent ?", de: "Welcher Strand heute, bei diesem Wind?", it: "Quale spiaggia oggi, con questo vento?", es: "¿Qué playa hoy, con este viento?" },
  { el: "Πώς πάω στην Παροικιά;", en: "How do I get to Parikia?", fr: "Comment aller à Parikia ?", de: "Wie komme ich nach Parikia?", it: "Come arrivo a Parikia?", es: "¿Cómo llego a Parikia?" },
  { el: "Τι υπηρεσίες έχει το ξενοδοχείο;", en: "What services does the hotel offer?", fr: "Quels services propose l'hôtel ?", de: "Welche Leistungen bietet das Hotel?", it: "Quali servizi offre l'hotel?", es: "¿Qué servicios ofrece el hotel?" },
  { el: "Θέλω επιπλέον πετσέτες", en: "I'd like extra towels", fr: "Je voudrais des serviettes en plus", de: "Ich hätte gern zusätzliche Handtücher", it: "Vorrei asciugamani extra", es: "Quisiera toallas extra" },
];

export function normalizeTvQuestions(v: unknown): TvQuestion[] {
  if (!Array.isArray(v)) return defaultTvQuestions.map((q) => ({ ...q }));
  return v.slice(0, MAX_TV_QUESTIONS).flatMap((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const q: TvQuestion = {};
    for (const l of langs) { const s = typeof r[l] === "string" ? (r[l] as string).trim().slice(0, 80) : ""; if (s) q[l] = s; }
    return Object.keys(q).length ? [q] : [];
  });
}

/** The chips shown on a TV in this language. */
export const questionsFor = (qs: TvQuestion[], lang: string): string[] => qs.map((q) => q[lang as keyof TvQuestion] || q.en || q.el || "").filter(Boolean);
