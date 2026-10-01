// Staff AI assistant on the PMS dashboard: the data snapshot it answers from, rendered as text, and the built-in
// answers used when no Anthropic key is configured (pure; unit tested).

export type StayRow = { reference: string; guest_name: string; room_code: string | null; check_in: string; check_out: string; status: string; balance_cents?: number | null; adults?: number | null; children?: number | null };
export type PmsSnapshot = {
  today: string; totalRooms: number; financial: boolean;
  arrivalsToday: StayRow[]; arrivalsTomorrow: StayRow[]; departuresToday: StayRow[]; departuresTomorrow: StayRow[]; inHouse: number;
  occupancy: { date: string; occupied: number }[];
  latest: (StayRow & { channel: string; created_at: number })[];
  balances: { count: number; totalCents: number; top: StayRow[] } | null;
  messages: { reference: string; guest_name: string; body: string; created_at: number }[];
  housekeeping: { todo: number; inProgress: number; ooo: number; openDefects: number };
};

const euro = (c: number) => `€${(Number(c) / 100).toFixed(2)}`;
const stay = (s: StayRow, financial: boolean) => `${s.reference} · ${s.guest_name} · room ${s.room_code ?? "-"} · ${s.check_in} → ${s.check_out} · ${s.status}${s.adults ? ` · ${s.adults} adults${s.children ? ` + ${s.children} children` : ""}` : ""}${financial && Number(s.balance_cents) > 0 ? ` · balance ${euro(Number(s.balance_cents))}` : ""}`;

export function snapshotText(s: PmsSnapshot): string {
  const list = (title: string, rows: StayRow[]) => `${title} (${rows.length})\n${rows.map((r) => `- ${stay(r, s.financial)}`).join("\n") || "- none"}`;
  const occ = s.occupancy.map((o) => `${o.date}: ${o.occupied}/${s.totalRooms} (${s.totalRooms ? Math.round((o.occupied / s.totalRooms) * 100) : 0}%)`).join("\n");
  return [
    `Today (hotel time): ${s.today}. Active rooms: ${s.totalRooms}. Guests in house tonight: ${s.inHouse}.`,
    list("ARRIVALS TODAY", s.arrivalsToday), list("ARRIVALS TOMORROW", s.arrivalsTomorrow),
    list("DEPARTURES TODAY", s.departuresToday), list("DEPARTURES TOMORROW", s.departuresTomorrow),
    `OCCUPANCY NEXT 14 NIGHTS (occupied/total)\n${occ}`,
    `LATEST BOOKINGS\n${s.latest.map((b) => `- ${stay(b, s.financial)} · ${b.channel} · booked ${new Date(Number(b.created_at)).toISOString().slice(0, 10)}`).join("\n") || "- none"}`,
    s.balances ? `UNPAID BALANCES: ${s.balances.count} bookings, total ${euro(s.balances.totalCents)}\n${s.balances.top.map((b) => `- ${stay(b, true)}`).join("\n")}` : "UNPAID BALANCES: not visible to this user (no financial permission).",
    `UNREAD GUEST MESSAGES (${s.messages.length})\n${s.messages.map((m) => `- ${m.reference} · ${m.guest_name}: ${m.body.replace(/\s+/g, " ").slice(0, 300)}`).join("\n") || "- none"}`,
    `HOUSEKEEPING: ${s.housekeeping.todo} to clean, ${s.housekeeping.inProgress} in progress, ${s.housekeeping.ooo} out of order, ${s.housekeeping.openDefects} open defects.`,
  ].join("\n\n");
}

type Lang = "el" | "en";
const L = {
  el: { arrToday: "Αφίξεις σήμερα", arrTomorrow: "Αφίξεις αύριο", depToday: "Αναχωρήσεις σήμερα", depTomorrow: "Αναχωρήσεις αύριο", occ: "Πληρότητα επόμενων 7 βραδιών", bal: "Εκκρεμή υπόλοιπα", msg: "Αδιάβαστα μηνύματα επισκεπτών", hk: "Καθαριότητα", none: "καμία", noFinance: "Δεν έχετε δικαίωμα να βλέπετε οικονομικά στοιχεία.", help: "Χωρίς κλειδί AI απαντώ μόνο σε βασικές ερωτήσεις (αφίξεις, αναχωρήσεις, πληρότητα, υπόλοιπα, μηνύματα, καθαριότητα). Για πλήρη AI προσθέστε κλειδί στο Ενσωματώσεις → Anthropic (Claude).", toClean: "για καθάρισμα", ooo: "εκτός λειτουργίας", defects: "ανοιχτές βλάβες" },
  en: { arrToday: "Arrivals today", arrTomorrow: "Arrivals tomorrow", depToday: "Departures today", depTomorrow: "Departures tomorrow", occ: "Occupancy next 7 nights", bal: "Unpaid balances", msg: "Unread guest messages", hk: "Housekeeping", none: "none", noFinance: "You don't have permission to see financial data.", help: "Without an AI key I only answer basic questions (arrivals, departures, occupancy, balances, messages, housekeeping). For full AI answers add a key in Integrations → Anthropic (Claude).", toClean: "to clean", ooo: "out of order", defects: "open defects" },
};

/** Built-in answers from the snapshot for the usual front-desk questions. */
export function builtInAnswer(question: string, s: PmsSnapshot, lang: Lang): string {
  const t = L[lang], q = question.toLowerCase();
  const rows = (title: string, list: StayRow[]) => `${title}:${list.length ? `\n${list.map((r) => `• ${r.reference} · ${r.guest_name} · ${r.room_code ?? "-"}`).join("\n")}` : ` ${t.none}`}`;
  const tomorrow = /(tomorrow|αύριο|αυριο)/.test(q);
  const parts: string[] = [];
  if (/(arriv|check.?in|άφιξ|αφιξ|έρχοντ|ερχοντ|φτάν|φταν)/.test(q)) parts.push(tomorrow ? rows(t.arrTomorrow, s.arrivalsTomorrow) : rows(t.arrToday, s.arrivalsToday));
  if (/(depart|check.?out|αναχώρ|αναχωρ|φεύγ|φευγ)/.test(q)) parts.push(tomorrow ? rows(t.depTomorrow, s.departuresTomorrow) : rows(t.depToday, s.departuresToday));
  if (/(occup|πληρότ|πληροτ|availability|διαθεσιμ)/.test(q)) parts.push(`${t.occ}:\n${s.occupancy.slice(0, 7).map((o) => `• ${o.date}: ${o.occupied}/${s.totalRooms}`).join("\n")}`);
  if (/(balance|unpaid|owe|υπόλοιπ|υπολοιπ|οφειλ|απλήρωτ|απληρωτ)/.test(q)) parts.push(s.balances ? `${t.bal}: ${s.balances.count} · ${euro(s.balances.totalCents)}${s.balances.top.length ? `\n${s.balances.top.map((b) => `• ${b.reference} · ${b.guest_name} · ${euro(Number(b.balance_cents))}`).join("\n")}` : ""}` : t.noFinance);
  if (/(message|μήνυμ|μηνυμ)/.test(q)) parts.push(`${t.msg}: ${s.messages.length ? `\n${s.messages.map((m) => `• ${m.reference} · ${m.guest_name}: ${m.body.slice(0, 120)}`).join("\n")}` : t.none}`);
  if (/(housekeep|clean|defect|καθαρ|βλάβ|βλαβ)/.test(q)) parts.push(`${t.hk}: ${s.housekeeping.todo} ${t.toClean} · ${s.housekeeping.ooo} ${t.ooo} · ${s.housekeeping.openDefects} ${t.defects}`);
  return parts.length ? parts.join("\n\n") : t.help;
}
