// Automatic translation in the PMS (pure; unit tested): the hotel writes a text in one language and Claude fills the
// other languages of the booking page / TV. Nothing is saved until the hotel presses Save.

export const translateLangs = ["el", "en", "fr", "de", "it", "es"] as const;
export type TranslateLang = (typeof translateLangs)[number];
export const langLabel: Record<TranslateLang, string> = { el: "Greek", en: "English", fr: "French", de: "German", it: "Italian", es: "Spanish" };
export const MAX_TRANSLATE_CHARS = 12_000;

export const TRANSLATE_RULES = `You translate texts of Hotel Corali, a small family hotel in Piso Livadi, Paros, Greece, for its booking page, guest app and in-room TV.
- Translate faithfully and naturally, in the warm, polite tone of a good hotel; never add or drop information.
- Keep the formatting exactly: line breaks, "- " bullets, **bold**, emojis, numbers, prices, times and every placeholder in braces such as {checkIn} {checkOut} {wifi} {password} {name} unchanged.
- Place names in the usual spelling of the target language (Πίσω Λιβάδι → Piso Livadi, Παροικιά → Parikia, Νάουσα → Naoussa, Λογαράς → Logaras); in Greek keep the Greek names.
- Brand and product names (Hotel Corali, Wi-Fi, Netflix, WhatsApp) stay as they are.
- An empty text stays empty. Return every key for every requested language with the record_translations tool.`;

/** The tool Claude answers with: { "<lang>": { "<key>": "text" } }. */
export function translationTool(keys: string[], to: TranslateLang[]) {
  const fields = Object.fromEntries(keys.map((k) => [k, { type: "string" }]));
  return {
    name: "record_translations",
    description: "Record the translation of every text into every requested language.",
    input_schema: { type: "object" as const, properties: Object.fromEntries(to.map((l) => [l, { type: "object", properties: fields, required: keys }])), required: to },
  };
}

export function translationPrompt(from: TranslateLang, to: TranslateLang[], fields: Record<string, string>): string {
  return `Translate from ${langLabel[from]} into ${to.map((l) => `${langLabel[l]} (${l})`).join(", ")}.\n\nTexts (JSON, key → text):\n${JSON.stringify(fields, null, 2)}`;
}

/** Only strings for the asked languages and keys; anything else from the model is dropped. */
export function cleanTranslations(raw: unknown, keys: string[], to: TranslateLang[], maxLen = 3000): Partial<Record<TranslateLang, Record<string, string>>> {
  const out: Partial<Record<TranslateLang, Record<string, string>>> = {};
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const l of to) {
    const x = r[l] && typeof r[l] === "object" ? (r[l] as Record<string, unknown>) : null;
    if (!x) continue;
    const row: Record<string, string> = {};
    for (const k of keys) if (typeof x[k] === "string") row[k] = (x[k] as string).slice(0, maxLen);
    if (Object.keys(row).length) out[l] = row;
  }
  return out;
}

/** Languages that would be filled: all others, or only the empty ones when the hotel keeps its own translations. */
export function targetLangs(values: Partial<Record<string, string>>, from: string, overwrite: boolean, langs: readonly string[] = translateLangs): TranslateLang[] {
  return langs.filter((l): l is TranslateLang => l !== from && (overwrite || !String(values[l] ?? "").trim()) && (translateLangs as readonly string[]).includes(l));
}
