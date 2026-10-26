// Voice / typed commands in the Corali Staff app (pure; unit tested). "Το 304 είναι έτοιμο, αλλά η λάμπα στο μπαλκόνι
// είναι καμένη" → finish the clean of 304 + a defect for the lamp. Claude parses when an API key is set; these rules are
// the built-in parser (Greek and English) and the safety net. Nothing runs before the person confirms the list.

export const voiceActionTypes = ["complete_clean", "start_clean", "report_issue", "linen", "message"] as const;
export type VoiceActionType = (typeof voiceActionTypes)[number];
export type VoiceAction = {
  type: VoiceActionType;
  room: string | null;
  description?: string;
  severity?: "minor" | "major" | "out_of_order";
  service?: "sheets" | "towels";
  body?: string;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const has = (text: string, words: RegExp) => words.test(norm(text));

const READY = /(?<![\p{L}\d])(ετοιμο|ετοιμη|καθαρο|καθαρισα|τελειωσα|τελειωσε|ολοκληρωθηκε|ολοκληρωσα|ready|clean(ed)?|done|finished)(?![\p{L}\d])/u;
const START = /(?<![\p{L}\d])(ξεκιναω|ξεκινω|ξεκινησα|αρχιζω|μπαινω|start(ing)?|begin)(?![\p{L}\d])/u;
const DEFECT = /(χαλασμεν|καμεν|σπασμεν|δεν (λειτουργει|δουλευει|αναβει|κλεινει|ανοιγει)|σταζει|τρεχει νερο|βουλωμεν|βλαβη|επισκευ|φθορα|λειπει|broken|not working|doesn'?t work|leak|blocked|clogged|repair|fix|damaged|missing|burnt|burned out)/;
const SERIOUS = /(εκτος λειτουργιας|πλημμυρ|σοβαρ|επικινδυν|out of order|flood|serious|dangerous)/;
const MAJOR = /(κλιματιστικ|ζεστο νερο|θερμοσιφων|πορτα|κλειδαρια|air ?con|a\/?c|hot water|door|lock|toilet|τουαλετα)/;
const SHEETS = /(σεντονι|sheets?|linen)/;
const TOWELS = /(πετσετ|towels?)/;
const CHANGED = /(αλλαξα|αλλαχτηκαν|αλλαγη|changed|replaced|new)/;
const MESSAGE = /^(πες|πειτε|ενημερωσε|μηνυμα|tell|message|let reception know)(?![\p{L}\d])/u;

/** Room codes mentioned, kept only if they are real rooms. */
export function roomsIn(text: string, known: string[]): string[] {
  const set = new Set(known.map(String));
  return [...text.matchAll(/(?<![\p{L}\d])(\d{1,4}[a-zA-Zα-ωΑ-Ω]?)(?![\p{L}\d])/gu)].map((m) => m[1]).filter((c) => set.has(c));
}

/** Built-in parser: clause by clause, a clause without a room uses the last room mentioned. */
export function parseVoiceRules(text: string, known: string[]): VoiceAction[] {
  const clauses = text.split(/(?:,|;|\.(?!\d)|(?<![\p{L}])(?:αλλά|αλλα|και επίσης|but|also)(?![\p{L}]))/iu).map((c) => c.trim()).filter(Boolean);
  const out: VoiceAction[] = [];
  let room: string | null = null;
  for (const clause of clauses) {
    const rooms = roomsIn(clause, known);
    if (rooms.length) room = rooms[0];
    const n = norm(clause);
    if (MESSAGE.test(n)) { out.push({ type: "message", room, body: clause.replace(/^\S+\s+(στη ρεσεψιον|στη ρεσεψιόν|reception)?\s*(οτι|ότι|that)?\s*/i, "").trim() || clause }); continue; }
    // "…, out of order" right after a defect makes that defect serious.
    const last = out.at(-1);
    if (!has(clause, DEFECT) && has(clause, SERIOUS) && last?.type === "report_issue" && last.room === room) { last.severity = "out_of_order"; last.description = `${last.description} (${clause})`; continue; }
    if (has(clause, DEFECT)) {
      out.push({ type: "report_issue", room, description: clause.replace(/^(και|and)\s+/i, "").trim(), severity: has(clause, SERIOUS) ? "out_of_order" : has(clause, MAJOR) ? "major" : "minor" });
      continue;
    }
    if (has(clause, CHANGED) && (has(clause, SHEETS) || has(clause, TOWELS))) {
      if (has(clause, SHEETS)) out.push({ type: "linen", room, service: "sheets" });
      if (has(clause, TOWELS)) out.push({ type: "linen", room, service: "towels" });
      continue;
    }
    if (has(clause, READY)) { out.push({ type: "complete_clean", room }); continue; }
    if (has(clause, START)) out.push({ type: "start_clean", room });
  }
  return out;
}

/** Drop actions that cannot run (no room where one is needed, empty texts) and exact duplicates. */
export function cleanActions(list: VoiceAction[], known: string[]): VoiceAction[] {
  const rooms = new Set(known.map(String)), seen = new Set<string>();
  return list.filter((a) => {
    if (a.type !== "message" && (!a.room || !rooms.has(String(a.room)))) return false;
    if (a.type === "report_issue" && (a.description ?? "").trim().length < 3) return false;
    if (a.type === "message" && !(a.body ?? "").trim()) return false;
    if (a.type === "linen" && a.service !== "sheets" && a.service !== "towels") return false;
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
