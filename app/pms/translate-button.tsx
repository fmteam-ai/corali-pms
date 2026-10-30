"use client";
import { useState } from "react";
import { targetLangs, translateLangs, type TranslateLang } from "@/lib/translate-core";

type Texts = Record<string, Partial<Record<string, string>>>;
const ui = {
  el: { button: "🌐 Μετάφραση", busy: "Μετάφραση…", overwrite: "Υπάρχουν ήδη κείμενα σε άλλες γλώσσες. Να αντικατασταθούν κι αυτά; (OK = όλες οι γλώσσες, Άκυρο = μόνο οι κενές)", done: "✓ Συμπληρώθηκαν οι γλώσσες — ελέγξτε τα και πατήστε Αποθήκευση.", none: "Όλες οι γλώσσες έχουν ήδη κείμενο.", empty: "Γράψτε πρώτα το κείμενο σε αυτή τη γλώσσα.", noAi: "Χρειάζεται το κλειδί Anthropic (PMS → Ενσωματώσεις).", failed: "Η μετάφραση απέτυχε — δοκιμάστε ξανά.", from: "από" },
  en: { button: "🌐 Translate", busy: "Translating…", overwrite: "Other languages already have text. Replace those too? (OK = all languages, Cancel = only the empty ones)", done: "✓ Languages filled — check them and press Save.", none: "Every language already has text.", empty: "Write the text in this language first.", noAi: "Needs the Anthropic key (PMS → Integrations).", failed: "Translation failed — please try again.", from: "from" },
};
const names: Record<TranslateLang, string> = { el: "Ελληνικά", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", es: "Español" };

/**
 * Fills the other languages from the one on screen with Claude (PMS key). `texts` is key → language → text (one key
 * per field, e.g. a title and a body); `onFill` gets the same shape back. Nothing is saved here.
 */
export function TranslateButton({ from, texts: given, getTexts, onFill, langs = translateLangs, uiLang = "el", compact = false }: { from: string; texts?: Texts; getTexts?: () => Texts; onFill: (filled: Texts) => void; langs?: readonly string[]; uiLang?: "el" | "en"; compact?: boolean }) {
  const t = ui[uiLang];
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function run() {
    setNote("");
    const texts = getTexts?.() ?? given ?? {};
    // The language on screen, or (when it is empty) the first language that has text.
    const has = (l: string) => Object.values(texts).some((v) => String(v[l] ?? "").trim());
    const source = (has(from) ? from : langs.find(has) ?? from) as TranslateLang;
    const fields = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, String(v[source] ?? "")]).filter(([, v]) => v.trim()));
    if (!Object.keys(fields).length) { setNote(t.empty); return; }
    const filledSomewhere = Object.keys(fields).some((k) => targetLangs(texts[k], source, true, langs).some((l) => String(texts[k][l] ?? "").trim()));
    const overwrite = filledSomewhere ? window.confirm(t.overwrite) : true;
    const to = [...new Set(Object.keys(fields).flatMap((k) => targetLangs(texts[k], source, overwrite, langs)))];
    if (!to.length) { setNote(t.none); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/pms/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: source, to, fields }) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setNote(d.error === "NO_AI" ? t.noAi : t.failed); return; }
      const out: Texts = {};
      for (const k of Object.keys(texts)) {
        const next = { ...texts[k] };
        for (const l of to) { const v = d.translations?.[l]?.[k]; if (typeof v === "string" && (overwrite || !String(next[l] ?? "").trim())) next[l] = v; }
        out[k] = next;
      }
      onFill(out);
      setNote(t.done);
    } catch { setNote(t.failed); } finally { setBusy(false); }
  }
  return (
    <span className={`translateBtn${compact ? " compact" : ""}`}>
      <button type="button" className="secondaryButton" disabled={busy} onClick={() => void run()} title={`${t.button} ${t.from} ${names[from as TranslateLang] ?? from}`}>{busy ? t.busy : `${t.button}${compact ? "" : ` ${t.from} ${names[from as TranslateLang] ?? from}`}`}</button>
      {note && <small role="status">{note}</small>}
    </span>
  );
}
