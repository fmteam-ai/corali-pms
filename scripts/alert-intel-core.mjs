// v202 Corali Sentinel — Alert Intelligence & Notification Control (pure: no database, no sending).
//
// Turns the reliability check (one item per pending row) into INCIDENTS — one per real problem — used by both the
// alerts (push / e-mail) and the Sentinel incidents, so a backlog of 50 rows is one incident with a count, not 50
// e-mails.
//
//   Deduplication   one incident per real problem; its key does not depend on which rows are pending
//   Aggregation     items of the same kind (key «<kind>:<n>») in an area → one incident with count + oldest
//   Severity        critical · high · medium · low (low = shown in the PMS only, never pushed or e-mailed)
//   State awareness Channel Manager not configured / configured but inactive / active — only «active» can be urgent
//   Root cause      for the OTA sync: the actual reason (no sync run, sync failing with its error, outbox stuck
//                   while the sync succeeds) is decided from the evidence, and said apart from the probable causes
//
// The cooldown, escalation on worsening, reminders and the single recovery notice are applied by alert-core.mjs.
import { SYNC_FAIL_GRACE_MS } from "./integration-state-core.mjs";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const PRIORITIES = ["low", "medium", "high", "critical"];
export const priorityRank = (p) => Math.max(0, PRIORITIES.indexOf(p));
export const PRIORITY_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_EL = { critical: "Κρίσιμο", high: "Υψηλό", medium: "Μεσαίο", low: "Χαμηλό" };

/** What each priority is told: channels, first reminder, repeated reminders. */
export const NOTIFY_POLICY = {
  critical: { push: true, email: true, escalateAfterMs: 30 * MIN, remindEveryMs: DAY },
  high: { push: true, email: true, escalateAfterMs: 4 * HOUR, remindEveryMs: DAY },
  medium: { push: true, email: false, escalateAfterMs: null, remindEveryMs: null },
  low: { push: false, email: false, escalateAfterMs: null, remindEveryMs: null },
};
export const policyText = (p) => {
  const x = NOTIFY_POLICY[p] ?? NOTIFY_POLICY.high;
  if (!x.push && !x.email) return "Μόνο στο PMS (Κέντρο αξιοπιστίας / Sentinel) — χωρίς push ή email.";
  return `Μία αρχική ειδοποίηση${x.email ? " (push + email)" : " (push)"}· νέα μόνο αν επιδεινωθεί η σοβαρότητα${x.escalateAfterMs ? ` ή αν δεν επιβεβαιωθεί (πρώτη υπενθύμιση μετά από ${x.escalateAfterMs >= HOUR ? `${x.escalateAfterMs / HOUR} ώρ.` : `${x.escalateAfterMs / MIN}′`}, μετά το πολύ μία ανά 24 ώρες)` : ""}· μία ειδοποίηση όταν αποκατασταθεί.`;
};

const days = (ms) => { const m = Math.max(0, Math.round(ms / MIN)); return m < 60 ? `${m}′` : m < 48 * 60 ? `${Math.round(m / 60)} ώρ.` : `${Math.round(m / 1440)} ημέρες`; };

/** Area → priority of its critical items (the OTA sync is decided by channelIncident). */
const AREA_PRIORITY = { payments: "critical", automations: "critical", channel: "high", turnover: "high", backups: "high", mydata: "high", messaging: "high", release: "medium", network: "medium", devices: "medium", integrations: "medium" };
const SERVICE = { channel: "OTA Sync", payments: "Payments", messaging: "Guest Messaging", mydata: "myDATA", devices: "Devices", network: "Guest Network", integrations: "Integrations", automations: "Automations", turnover: "Room Turnover", backups: "Backups", release: "Release" };

/**
 * The OTA sync incident from the channel statistics (checkReliability → channelStats), or null when there is nothing
 * to report. connection: NOT_CONFIGURED · DISABLED · TESTING · ACTIVE · DEGRADED.
 */
export function channelIncident(s, now) {
  if (!s) return null;
  // State awareness: a connection that is not configured / disabled is not a failure — no incident at all (the
  // Reliability Center shows one information line). TESTING: shown as LOW (PMS only), never pushed or e-mailed.
  if (s.connection === "NOT_CONFIGURED" || s.connection === "DISABLED") return null;
  const live = Number(s.live ?? 0);
  const oldest = s.oldestAt ? now - Number(s.oldestAt) : 0;
  const summary = `${live} εκκρεμή γεγονότα διαθεσιμότητας${s.oldestAt ? `, με παλαιότερο πριν από ${days(oldest)}` : ""}${s.oldestRange ? ` (${s.oldestRange})` : ""}${s.failed ? ` · ${s.failed} απέτυχαν` : ""}${s.past ? ` · και ${s.past} για ημερομηνίες που πέρασαν (χωρίς σημασία)` : ""}.`;
  const base = { key: "sync:ota", area: "channel", service: "OTA Sync", count: live, oldestAt: s.oldestAt ?? null, summary, connection: s.connection };
  if (s.connection === "TESTING") {
    if (!(live > 0)) return null;
    return { ...base, priority: "low", problem: "Ο Channel Manager είναι σε δοκιμή (δεν έχει ενεργοποιηθεί) — μεταβολές διαθεσιμότητας σε αναμονή.",
      rootCause: "Επιβεβαιωμένο: η σύνδεση δεν έχει ενεργοποιηθεί (δεν έχουν αποδειχθεί η αντιστοίχιση τύπων / rate plans και η αρχική πλήρης σύγκριση διαθεσιμότητας). Οι αποτυχίες της δεν ειδοποιούνται μέχρι την ενεργοποίηση.",
      causes: [], action: "Συνδέσεις → Channel Manager: «Έλεγχος σύνδεσης Channex» μέχρι όλα ✅, «Πλήρης συγχρονισμός», και «Ενεργοποίηση»." };
  }
  // Activated (ACTIVE / DEGRADED / UNVERIFIED): a broken sync is an incident even with an empty queue — the OTA
  // bookings are imported by the same sync.
  const soon = s.soon ? ` ${s.soon} από αυτά αφορούν τις επόμενες 14 ημέρες — κίνδυνος overbooking.` : "";
  const ran = s.lastRunAt ? `τελευταία εκτέλεση πριν από ${days(now - Number(s.lastRunAt))}` : "δεν έχει εκτελεστεί ποτέ";
  const ok = s.lastOkAt ? `τελευταία επιβεβαιωμένη επιτυχία πριν από ${days(now - Number(s.lastOkAt))}` : "καμία επιβεβαιωμένη επιτυχία";
  const evidence = `Channex: ${ran}· ${ok}${s.lastError ? `· τελευταίο σφάλμα: ${String(s.lastError).slice(0, 160)}` : ""}.`;
  if (s.credentials && !["OK", "CREDENTIAL_FREE", "CANNOT_VERIFY"].includes(s.credentials)) {
    return { ...base, priority: "critical", problem: "Ο Channel Manager είναι ενεργοποιημένος, αλλά τα στοιχεία σύνδεσής του λείπουν ή δεν διαβάζονται — ο συγχρονισμός δεν μπορεί να λειτουργήσει." + soon,
      rootCause: `Επιβεβαιωμένο: έλεγχος στοιχείων σύνδεσης → ${s.credentials}${s.credentialsMissing?.length ? ` (λείπουν: ${s.credentialsMissing.join(", ")})` : ""}. ${evidence}`,
      causes: ["Άλλαξε το PMS_DOCUMENT_KEY (τα κλειδιά δεν αποκρυπτογραφούνται)", "Διαγράφηκε πεδίο στις Συνδέσεις → Channel Manager"],
      action: "Συνδέσεις → Channel Manager: αποθηκεύστε ξανά API key και property id, «Έλεγχος σύνδεσης Channex», μετά «Συγχρονισμός τώρα»." };
  }
  if (!s.lastRunAt || now - Number(s.lastRunAt) > 30 * MIN) {
    return { ...base, cause: "not_running", priority: "critical", problem: "Ο συγχρονισμός με τον Channel Manager δεν εκτελείται — οι μεταβολές διαθεσιμότητας και οι κρατήσεις OTA δεν συγχρονίζονται." + soon,
      rootCause: `Επιβεβαιωμένο: ${evidence} Ο συγχρονισμός (scripts/run-channel-sync.mjs) δεν τρέχει.`,
      causes: ["Λείπει το cron του run-channel-sync.mjs στο cPanel", "Το cron αποτυγχάνει πριν ξεκινήσει (δείτε /home/corali/logs/corali-channels.log)"],
      action: "Ελέγξτε στο cPanel → Cron Jobs ότι υπάρχει το scripts/run-channel-sync.mjs (κάθε λεπτό) και το log του. Μετά: Κέντρο αξιοπιστίας → «Συγχρονισμός τώρα»." };
  }
  // v204: judged by the LATEST run; raised after SYNC_FAIL_GRACE_MS of CONTINUOUS failure, measured from when the
  // current failure started (failingSince, written by run-channel-sync; unknown → the failed run itself). During the
  // grace window an incident that is already open stays open (no false «recovered»), and an old backlog is still
  // reported — never the «sync succeeds» diagnosis.
  const runFailed = !s.lastOkAt || Number(s.lastOkAt) < Number(s.lastRunAt) || Boolean(String(s.lastError ?? "").trim());
  if (runFailed) {
    // failingSince counts only if it is after the last success (a stale value is ignored); unknown → the last success
    // bounds it; never succeeded → the failed run.
    // (failingSince === undefined: the schema update has not run — the start is unknown; never succeeded → the
    // grace is not applied, otherwise it would restart at every run.)
    const fs = s.failingSince == null ? null : Number(s.failingSince);
    const unknownStart = !(fs != null && fs >= Number(s.lastOkAt ?? 0)) && s.lastOkAt == null && s.failingSince === undefined;
    const since = fs != null && fs >= Number(s.lastOkAt ?? 0) ? fs : s.lastOkAt != null ? Number(s.lastOkAt) : unknownStart ? now - SYNC_FAIL_GRACE_MS : Number(s.lastRunAt);
    const failingFor = now - since;
    const failing = { ...base, priority: failingFor > 6 * HOUR ? "critical" : "high", problem: "Ο συγχρονισμός εκτελείται αλλά η τελευταία εκτέλεση απέτυχε — οι αλλαγές δεν φτάνουν στον Channel Manager." + soon,
      rootCause: `Επιβεβαιωμένο: ${evidence} ${unknownStart ? "Από πότε αποτυγχάνει δεν είναι γνωστό (η ενημέρωση της βάσης δεν έχει εφαρμοστεί)." : `Αποτυγχάνει συνεχώς εδώ και ${days(failingFor)}.`}`,
      causes: ["Λάθος / ληγμένο API key ή property ID στο Channex", "Το Channex δεν απαντά (5xx / χρονικό όριο) ή επιστρέφει warnings", "Μη αντιστοιχισμένος τύπος δωματίου ή rate plan"],
      action: "Κάντε «Έλεγχος σύνδεσης Channex» στο PMS· διορθώστε ό,τι δείχνει το σφάλμα· μετά «Συγχρονισμός τώρα» και επιβεβαιώστε ότι η επόμενη εκτέλεση πετυχαίνει." };
    if (failingFor >= SYNC_FAIL_GRACE_MS || s.incidentOpen) return failing;
    if (live > 0 && oldest > 30 * MIN) return { ...failing, problem: "Μεταβολές διαθεσιμότητας σε αναμονή και η τελευταία εκτέλεση του συγχρονισμού απέτυχε." + soon };
    return null;
  }
  if (live > 0 && oldest > 30 * MIN) {
    return { ...base, priority: "high", problem: "Ο συγχρονισμός πετυχαίνει, αλλά μεταβολές διαθεσιμότητας παραμένουν σε αναμονή." + soon,
      rootCause: `Επιβεβαιωμένο: ${evidence} Η τελευταία εκτέλεση πέτυχε, αλλά οι εγγραφές της ουράς δεν κλείνουν — λανθασμένη κατάσταση outbox ή εγγραφές εκτός ορίου αποστολής.`,
      causes: ["Εγγραφές έμειναν «processing» από διακοπείσα εκτέλεση", "Η πλήρης αποστολή δεν κάλυψε όλους τους τύπους × ημερομηνίες (δείτε OTA reconciliation)"],
      action: "Κέντρο αξιοπιστίας → «Επανάληψη» για τις εκκρεμότητες· αν μένουν, «Πλήρης συγχρονισμός διαθεσιμότητας» και έλεγχος OTA reconciliation." };
  }
  return null;
}

/** Pure: incidents from a reliability check (one per real problem), most important first. */
export function buildIncidents(reliability, now) {
  const out = [];
  const ch = channelIncident(reliability?.channelStats, now);
  if (ch) out.push(ch);
  for (const a of reliability?.areas ?? []) {
    const groups = new Map();
    for (const i of a.items ?? []) {
      if (i.level !== "fail") continue;
      const key = String(i.key);
      // The OTA sync items are the channel incident's symptoms (rows of its backlog).
      // The OTA sync's own items (rows of its backlog, sync / cron state, credentials) are the ONE channel incident.
      if (a.key === "channel" && /^(outbox:|sync:|integration:channelManager:credentials|cron:channel-sync)/.test(key)) continue;
      // v204: a channel manager that is not activated never alerts (TESTING / NOT_CONFIGURED / DISABLED).
      if (a.key === "channel" && reliability?.integrations && !["ACTIVE", "DEGRADED", "UNVERIFIED"].includes(reliability.integrations.channelManager) && !key.startsWith("noroom:")) continue;
      // Many items of one kind = one incident: «<kind>:<number>» and the per-range / per-room families.
      // (Per-range OTA reconciliation differences only: one cause, the channel sync. Other kinds stay separate.)
      const m = /^([a-z_]+):\d+$/i.exec(key) ?? /^(ota|ota-unsent):/.exec(key);
      const gk = m ? `${m[1]}:*` : key;
      const g = groups.get(gk) ?? { key: gk, items: [] };
      g.items.push(i);
      groups.set(gk, g);
    }
    for (const g of groups.values()) {
      const first = g.items[0], n = g.items.length;
      out.push({ key: g.key, area: a.key, service: SERVICE[a.key] ?? a.en ?? a.key, priority: AREA_PRIORITY[a.key] ?? "high", count: n, oldestAt: Math.min(...g.items.map((i) => Number(i.at) || Infinity)) || null,
        problem: n === 1 ? `${a.el}: ${first.text}` : `${a.el}: ${n} εκκρεμότητες του ίδιου είδους.`,
        summary: n === 1 ? first.text : `${n} εκκρεμότητες· η πρώτη: ${first.text}`,
        rootCause: null, causes: [], action: "Δείτε το Κέντρο αξιοπιστίας — κάθε εκκρεμότητα έχει την ενέργεια αποκατάστασης.", examples: g.items.slice(0, 5).map((i) => ({ key: i.key, text: i.text })) });
    }
  }
  return out.sort((x, y) => priorityRank(y.priority) - priorityRank(x.priority));
}

/** The message (subject + text) of one delivery, in the incident format. purpose: alert · escalation · reminder:* · worsened · recovery. */
export function formatAlertMessage(row) {
  let d = {};
  try { d = JSON.parse(String(row.details_json || "{}")) ?? {}; } catch { d = {}; }
  const p = row.priority || d.priority || "high";
  const purpose = String(row.purpose || "alert");
  const tag = purpose === "recovery" ? "[Αποκατάσταση] " : purpose === "worsened" ? "[Επιδείνωση] " : purpose === "escalation" || purpose.startsWith("reminder") ? "[Υπενθύμιση] " : "";
  const service = d.service || "PMS";
  const subject = `${tag}[Corali PMS] ${service} — ${PRIORITY_LABEL[p] ?? p}: ${String(d.problem || row.title).slice(0, 120)}`;
  const lines = [`Corali Sentinel — ${service} Incident`, `${PRIORITY_LABEL[p] ?? p} (${PRIORITY_EL[p] ?? p})`, ""];
  if (purpose === "recovery") lines.push("Αποκαταστάθηκε: το πρόβλημα δεν εμφανίζεται πλέον στον έλεγχο.", "");
  lines.push(`Πρόβλημα: ${d.problem || row.title}`);
  if (d.summary) lines.push(`Σύνοψη: ${d.summary}`);
  if (d.rootCause) lines.push(`Αιτία (από τα στοιχεία): ${d.rootCause}`);
  if (d.causes?.length) lines.push(`Πιθανές αιτίες (δεν έχουν επιβεβαιωθεί): ${d.causes.join(" · ")}`);
  if (d.action && purpose !== "recovery") lines.push(`Προτεινόμενη ενέργεια: ${d.action}`);
  lines.push(`Ειδοποιήσεις: ${policyText(p)}`);
  const origin = String(row.origin ?? "").replace(/\/$/, "");
  lines.push("", `${origin}${row.link || "/pms/reliability"}`, "", purpose === "recovery" ? "" : "Επιβεβαιώστε στο PMS → Αξιοπιστία ότι το είδατε.");
  return { subject, text: lines.join("\n").trim() };
}
