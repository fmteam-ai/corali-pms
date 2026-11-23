// v201 Corali Sentinel Foundation — answers three questions for every problem, from evidence:
//   1. What exactly does not work?   2. Why — with which evidence?   3. How is it fixed, and how is the fix confirmed?
// It OBSERVES ONLY: every check runs inside a READ ONLY transaction (PostgreSQL itself refuses any write to production
// data); the Sentinel writes nothing but its own tables (sentinel_runs, sentinel_incidents). No database repair, no
// deployment, no service restart, no device command — fixes are proposed to a person, never executed.
import { randomUUID } from "node:crypto";
import { checkReliability } from "./reliability-core.mjs";
import { deepHealth } from "./health-core.mjs";

const MIN = 60_000;
/** A resolved incident needs this many consecutive clean checks spanning at least RECOVERY_MIN_MS. */
export const RECOVERY_CHECKS = 2;
export const RECOVERY_MIN_MS = 10 * MIN;

/**
 * Inventory of everything the PMS runs — services, cron jobs, integrations, device workflows — and how each is
 * monitored (`checks`: reliability areas / health components that observe it). The test suite fails if a packaged
 * cron script has no entry, so new jobs cannot go unmonitored silently.
 */
export const INVENTORY = [
  { id: "pms-app", kind: "service", el: "Εφαρμογή PMS (Next.js, Passenger)", checks: ["health:database", "watchdog:/api/health"], critical: true },
  { id: "booking-app", kind: "service", el: "Σελίδα κρατήσεων (Next.js, Passenger)", checks: ["health:booking", "watchdog:/api/health"], critical: true },
  { id: "postgres", kind: "service", el: "PostgreSQL", checks: ["health:database"], critical: true },
  { id: "cron-automations", kind: "job", script: "run-message-automations.mjs", el: "Κεντρικό cron (μηνύματα, συγχρονισμοί, συσκευές, αξιοπιστία)", checks: ["health:automations", "health:steps", "automations"], critical: true },
  { id: "cron-channel-sync", kind: "job", script: "run-channel-sync.mjs", el: "Συγχρονισμός OTA (Channex)", checks: ["health:channelSync", "health:otaQueue", "channel"], critical: true },
  { id: "cron-sentinel", kind: "job", script: "run-sentinel.mjs", el: "Corali Sentinel (αυτή η παρακολούθηση)", checks: ["health:sentinel", "watchdog:heartbeat"], critical: true },
  { id: "cron-backup", kind: "job", script: "run-db-backup.mjs", el: "Αντίγραφα ασφαλείας βάσης", checks: ["health:backups", "backups"] },
  { id: "cron-restore-rehearsal", kind: "job", script: "run-restore-rehearsal.mjs", el: "Δοκιμαστική επαναφορά", checks: ["backups"] },
  { id: "cron-balance", kind: "job", script: "run-balance-collection.mjs", el: "Είσπραξη υπολοίπων", checks: ["payments"] },
  { id: "cron-mydata", kind: "job", script: "run-mydata-queue.mjs", el: "myDATA (ΑΑΔΕ)", checks: ["mydata"] },
  { id: "cron-birthday", kind: "job", script: "run-birthday-automation.mjs", el: "Ευχές γενεθλίων", checks: ["messaging", "health:steps"] },
  { id: "cron-retention", kind: "job", script: "run-data-retention.mjs", el: "Διατήρηση / διαγραφή δεδομένων", checks: ["health:steps"] },
  { id: "cron-social", kind: "job", script: "run-social-publisher.mjs", el: "Δημοσιεύσεις Facebook / Instagram", checks: ["health:social"] },
  { id: "cron-rate-shopper", kind: "job", script: "run-rate-shopper.mjs", el: "Σύγκριση τιμών ανταγωνισμού", checks: ["health:steps"] },
  { id: "cron-tv-power", kind: "job", script: "run-tv-power.mjs", el: "Τροφοδοσία τηλεοράσεων", checks: ["devices"] },
  { id: "payments", kind: "integration", el: "Stripe / Viva (πληρωμές)", checks: ["payments"], critical: true },
  { id: "ota", kind: "integration", el: "Channex → Booking.com / Airbnb / Expedia", checks: ["channel", "health:otaQueue"], critical: true },
  { id: "guest-messaging", kind: "workflow", el: "Μηνύματα πελατών (email / WhatsApp)", checks: ["messaging"], critical: true },
  { id: "alerts", kind: "workflow", el: "Ειδοποιήσεις προσωπικού (push / email)", checks: ["automations", "health:alerts"] },
  { id: "housekeeping", kind: "workflow", el: "Καθαριότητα και επιθεώρηση", checks: ["turnover"] },
  { id: "room-readiness", kind: "workflow", el: "Ετοιμότητα δωματίου πριν την άφιξη", checks: ["turnover"], critical: true },
  { id: "tv", kind: "device", el: "Corali TV (τηλεοράσεις δωματίων)", checks: ["devices"] },
  { id: "climate", kind: "device", el: "Αισθητήρες θερμοκρασίας / ρελέ κλιματιστικών", checks: ["devices"] },
  { id: "wifi-cards", kind: "device", el: "Wi-Fi πελατών (Omada) και κάρτες πρόσβασης", checks: ["network"] },
  { id: "webhooks", kind: "integration", el: "API & webhooks συνεργατών", checks: ["integrations"] },
  { id: "release", kind: "service", el: "Εγκατεστημένη έκδοση και έλεγχοι", checks: ["release"] },
];

/**
 * Playbook per problem family (by key prefix): impact, PROBABLE causes (never stated as confirmed), proposed fix,
 * risks of the fix, and the reproducible validation. The CONFIRMED part of a report is only what the evidence shows.
 */
const PLAYBOOK = [
  { match: /^health:database/, impact: "Καμία λειτουργία του PMS ή της σελίδας κρατήσεων δεν εξυπηρετείται.", probable: ["Η υπηρεσία PostgreSQL σταμάτησε ή υπερφορτώθηκε", "Λάθος DATABASE_URL / κωδικός μετά από αλλαγή", "Γέμισε ο δίσκος του server"], fix: ["Έλεγχος κατάστασης PostgreSQL στο cPanel (Databases)", "Έλεγχος χώρου δίσκου", "Επαλήθευση του runtime.env"], risks: ["Επανεκκίνηση PostgreSQL διακόπτει τις ενεργές συνδέσεις"], validate: ["GET /api/health → ok:true", "GET /api/health/deep → database ok"] },
  { match: /^(cron:|health:automations|health:steps|step:)/, impact: "Οι αυτοματισμοί δεν εκτελούνται: μηνύματα, συγχρονισμοί, έλεγχοι συσκευών και ειδοποιήσεις καθυστερούν.", probable: ["Το Cron Job του cPanel αφαιρέθηκε ή άλλαξε", "Το script τερματίζεται από όριο μνήμης / χρόνου του hosting", "Σφάλμα σε συγκεκριμένο βήμα (δείτε το μήνυμα σφάλματος)"], fix: ["cPanel → Cron Jobs: επιβεβαίωση της εντολής του DEPLOY-CPANEL.md", "Χειροκίνητη εκτέλεση της εντολής από το τερματικό και ανάγνωση της εξόδου"], risks: ["Χειροκίνητη εκτέλεση παράλληλα με τρέχουσα: προστατεύεται από leases, αλλά ελέγξτε ότι δεν τρέχει ήδη"], validate: ["Κέντρο αξιοπιστίας → Αυτοματισμοί: «τελευταία εκτέλεση» πρόσφατη", "/api/health/deep → automations ok"] },
  { match: /^(outbox:|sync:|ota|noroom:|recon:|readback|cron:channel-sync|health:otaQueue|health:channelSync)/, impact: "Η διαθεσιμότητα στα OTA μπορεί να διαφέρει από το PMS — κίνδυνος overbooking ή χαμένων πωλήσεων.", probable: ["Το Channex δεν απαντά ή απορρίπτει (δείτε τον κωδικό σφάλματος)", "Λήξη / ανάκληση του API key", "Τύπος δωματίου χωρίς αντιστοίχιση"], fix: ["Κέντρο αξιοπιστίας → «Ξαναστείλε» (δικό σας κουμπί — ο Sentinel δεν το πατά)", "Έλεγχος αντιστοιχίσεων στο Channex"], risks: ["Επαναποστολή διαθεσιμότητας είναι ασφαλής (idempotent), αλλά ελέγξτε για overbooking πριν"], validate: ["Η ουρά OTA αδειάζει (oldest pending < 10′)", "Συμφωνία OTA: καμία απόκλιση"] },
  { match: /^(delivery:|uncertain:|stuck:|campaign:)/, impact: "Ένας πελάτης ίσως δεν έλαβε μήνυμα (υπενθύμιση, check-in, υπόλοιπο).", probable: ["Λάθος / ανενεργός λογαριασμός SMTP ή WhatsApp", "Μη έγκυρη διεύθυνση ή αριθμός πελάτη", "Ο πάροχος δεν απάντησε (αβέβαιη αποστολή)"], fix: ["Έλεγχος της αιτίας στο μήνυμα σφάλματος", "Για «αβέβαιο»: έλεγχος με τον πελάτη πριν από επαναποστολή"], risks: ["Επαναποστολή αβέβαιου μηνύματος μπορεί να στείλει διπλό"], validate: ["Η αποστολή εμφανίζεται «sent» ή επιβεβαιωμένη από τον πάροχο"] },
  { match: /^(balance:|session:|payment|stripe|viva)/, impact: "Πληρωμή ή σύνδεσμος πληρωμής σε εκκρεμότητα — κίνδυνος απώλειας εσόδων ή διπλής χρέωσης.", probable: ["Ο πελάτης δεν ολοκλήρωσε την πληρωμή", "Δεν έφτασε το webhook του παρόχου", "Λάθος webhook secret"], fix: ["Έλεγχος της συναλλαγής στον πίνακα του παρόχου", "Συμφωνία πληρωμών στο PMS"], risks: ["Χειροκίνητη καταχώριση πληρωμής χωρίς έλεγχο στον πάροχο μπορεί να είναι λάθος"], validate: ["Η κράτηση δείχνει την πληρωμή με το id του παρόχου", "Συμφωνία οικονομικών: καμία απόκλιση"] },
  { match: /^fiscal:/, impact: "Παραστατικό χωρίς MARK από την ΑΑΔΕ (myDATA).", probable: ["Η ΑΑΔΕ δεν απάντησε", "Λάθος στοιχεία παραστατικού (δείτε το σφάλμα)"], fix: ["Έλεγχος του σφάλματος και επαναποστολή από την ουρά myDATA"], risks: ["Διπλή αποστολή παραστατικού — η ουρά το αποτρέπει"], validate: ["Το παραστατικό έχει MARK"] },
  { match: /^turnover/, impact: "Δωμάτιο ίσως δεν είναι έτοιμο για τον επόμενο πελάτη.", probable: ["Εκκρεμεί καθαρισμός ή επιθεώρηση", "Ανοιχτή σοβαρή βλάβη", "Δεν ανακλήθηκε Wi-Fi / κάρτα / λογαριασμός TV"], fix: ["Εμπειρία πελάτη → Παράδοση δωματίων: ολοκλήρωση των βημάτων που λείπουν"], risks: ["Επιβεβαίωση χωρίς έλεγχο στο δωμάτιο"], validate: ["Η παράδοση γίνεται «Τώρα: έτοιμο» και επιβεβαιώνεται"] },
  { match: /^(tv:|plug:|climate:|ac:|presence:)/, impact: "Συσκευή δωματίου χωρίς πρόσφατη επιβεβαίωση λειτουργίας.", probable: ["Η συσκευή είναι εκτός ρεύματος / δικτύου", "Έληξε το κλειδί του cloud (Tuya)", "Η συσκευή αντικαταστάθηκε"], fix: ["Έλεγχος στο δωμάτιο", "Έλεγχος σύνδεσης στην αντίστοιχη σελίδα του PMS"], risks: ["Καμία αυτόματη εντολή — ο Sentinel δεν ελέγχει συσκευές"], validate: ["Η συσκευή εμφανίζει νέα μέτρηση / επικοινωνία"] },
  { match: /^(wifi:|card:|bridge)/, impact: "Wi-Fi πελάτη ή κάρτα πρόσβασης δεν δημιουργήθηκε / ανακλήθηκε όπως έπρεπε.", probable: ["Η γέφυρα Omada (Raspberry Pi) δεν επικοινωνεί", "Αποτυχία αποστολής email κάρτας"], fix: ["Έλεγχος της γέφυρας Omada", "Επαναποστολή κάρτας από το PMS"], risks: ["Ενεργός κωδικός Wi-Fi μετά το check-out είναι ζήτημα ασφαλείας"], validate: ["Η εκκρεμότητα εξαφανίζεται από το Κέντρο αξιοπιστίας"] },
  { match: /^(hook:|alertdelivery:|health:alerts)/, impact: "Ειδοποίηση ή webhook δεν παραδόθηκε.", probable: ["Ο παραλήπτης δεν απαντά", "Λάθος διεύθυνση / κλειδί"], fix: ["Έλεγχος του σφάλματος και του παραλήπτη"], risks: ["Επανάληψη αβέβαιης παράδοσης μπορεί να δώσει διπλό"], validate: ["Η παράδοση γίνεται «sent»"] },
  { match: /^(backup:|rehearsal:|health:backups)/, impact: "Χωρίς πρόσφατο / επαληθευμένο αντίγραφο ασφαλείας: κίνδυνος απώλειας δεδομένων.", probable: ["Το cron του backup δεν τρέχει", "Δεν υπάρχει χώρος δίσκου", "Λάθος ρυθμίσεις pg_dump"], fix: ["Χειροκίνητη εκτέλεση του run-db-backup.mjs και ανάγνωση της εξόδου"], risks: ["Το backup φορτώνει τη βάση — προτιμήστε ώρες χαμηλής κίνησης"], validate: ["Νέο backup «ok» και επιτυχής δοκιμαστική επαναφορά"] },
  { match: /^(release|health:release)/, impact: "Η εγκατεστημένη έκδοση δεν έχει πλήρη αποδοχή ή αποδεικτικό.", probable: ["Δεν έτρεξαν οι έλεγχοι παρόχων σε sandbox", "Αρχεία διαφορετικά από το ελεγμένο πακέτο"], fix: ["Έλεγχος μετά την εγκατάσταση (post-install-check)"], risks: [], validate: ["post-install-check: OK"] },
  { match: /^health:social/, impact: "Δημοσίευση social σε αβέβαιη κατάσταση ή κολλημένη.", probable: ["Το Meta δεν απάντησε (ίσως δημοσιεύτηκε)", "Διακόπηκε η εκτέλεση του publisher"], fix: ["Έλεγχος στο Facebook / Instagram και επίλυση από τη σελίδα Social"], risks: ["Επαναποστολή χωρίς έλεγχο = διπλή δημοσίευση"], validate: ["Η ανάρτηση γίνεται «Δημοσιεύτηκε» ή ξαναστέλνεται μόνο η πλατφόρμα που λείπει"] },
  { match: /^(health:booking)/, impact: "Η σελίδα κρατήσεων δεν μπορεί να πουλήσει (κανένα ενεργό δωμάτιο).", probable: ["Τα δωμάτια απενεργοποιήθηκαν", "Λάθος δεδομένα μετά από εισαγωγή"], fix: ["Έλεγχος Δωμάτια → Διαχείριση"], risks: [], validate: ["Η διαθεσιμότητα της σελίδας κρατήσεων επιστρέφει δωμάτια"] },
  { match: /^(sentinel:|health:sentinel)/, impact: "Η ίδια η παρακολούθηση δεν λειτουργεί — προβλήματα μπορεί να περάσουν απαρατήρητα.", probable: ["Το cron του Sentinel σταμάτησε", "Σφάλμα ανάγνωσης στη βάση"], fix: ["cPanel → Cron Jobs: εντολή run-sentinel.mjs (DEPLOY-CPANEL.md)"], risks: [], validate: ["Νέα εκτέλεση Sentinel «ok» και πρόσφατο heartbeat στο Fly.io watchdog"] },
  { match: /^data-unavailable:/, impact: "Ένα σύνολο δεδομένων δεν μπορεί να διαβαστεί — οι σχετικοί έλεγχοι είναι τυφλοί.", probable: ["Λείπει πίνακας / στήλη (μεταναστεύσεις)", "Κλείδωμα ή υπερφόρτωση της βάσης"], fix: ["Επανάληψη init-postgres (idempotent) και έλεγχος του σφάλματος στο log"], risks: [], validate: ["Ο έλεγχος δεν αναφέρει DATA_UNAVAILABLE"] },
];
const FALLBACK = { impact: "Δείτε το εύρημα στο Κέντρο αξιοπιστίας.", probable: ["Δεν υπάρχει καταγεγραμμένη γνώση για αυτόν τον τύπο προβλήματος"], fix: ["Διερεύνηση από τον διαχειριστή"], risks: [], validate: ["Το εύρημα εξαφανίζεται σε δύο διαδοχικούς ελέγχους"] };
export const playbookFor = (key) => PLAYBOOK.find((p) => p.match.test(key)) ?? FALLBACK;

const CRITICAL_AREAS = new Set(["payments", "channel", "automations", "turnover"]);
/** critical · high · medium — from the finding's level and how critical its area is. */
export function severityOf(f) {
  if (f.level === "fail" && (CRITICAL_AREAS.has(f.area) || /^health:(database|booking|automations|sentinel)/.test(f.key))) return "critical";
  return f.level === "fail" ? "high" : "medium";
}

/** Pure: findings from the reliability check and the deep health (what is observed, with its evidence reference). */
export function findingsFrom(reliability, health) {
  const out = [];
  for (const a of reliability?.areas ?? []) for (const i of a.items ?? []) {
    if (!["fail", "warn"].includes(i.level)) continue;
    out.push({ key: String(i.key), area: a.key, level: i.level, title: `${a.el}: ${String(i.text).slice(0, 200)}`, evidence: [{ source: "reliability", area: a.key, item: String(i.key), observed: String(i.text).slice(0, 400), at: Number(i.at ?? 0) || null, link: i.link ?? "/pms/reliability" }] });
  }
  for (const [name, c] of Object.entries(health?.components ?? {})) {
    if (!["fail", "warn", "unknown"].includes(c.status)) continue;
    const level = c.status === "fail" ? "fail" : "warn";
    out.push({ key: `health:${name}`, area: "health", level, title: `Υγεία συστήματος — ${name}: ${c.status}`, evidence: [{ source: "deep-health", component: name, observed: JSON.stringify(c).slice(0, 400), at: health.at }] });
  }
  return out;
}

/** The report: the three questions, with confirmed facts kept apart from probable causes. */
export function buildReport(inc, now) {
  const p = playbookFor(inc.key);
  return {
    what: inc.title,
    impact: p.impact,
    severity: inc.severity,
    evidence: inc.evidence,
    confirmed: inc.evidence.map((e) => `${e.source}${e.item ? ` · ${e.item}` : e.component ? ` · ${e.component}` : ""}: ${e.observed}`),
    probableCauses: p.probable.map((x) => `${x} (πιθανή αιτία — δεν έχει επιβεβαιωθεί)`),
    proposedFix: p.fix, risks: p.risks,
    validation: [...p.validate, `Ο Sentinel επιβεβαιώνει την αποκατάσταση όταν το εύρημα λείπει σε ${RECOVERY_CHECKS} διαδοχικούς ελέγχους σε τουλάχιστον ${RECOVERY_MIN_MS / MIN}′`],
    sentinelActions: "Καμία — ο Sentinel μόνο παρατηρεί. Η διόρθωση γίνεται από άνθρωπο.",
    generatedAt: now,
  };
}

/**
 * A read-only view of the database for the checks — two independent guards:
 *   1. the connection is switched to default_transaction_read_only (PostgreSQL refuses any INSERT / UPDATE / DELETE /
 *      DDL), statement by statement, so one failed read does not abort the others;
 *   2. the wrapper refuses, before sending, any statement that is not a read (SELECT / WITH … SELECT / EXPLAIN).
 */
const READ = /^\s*(\/\*[\s\S]*?\*\/\s*)?(SELECT|WITH|EXPLAIN|SHOW|VALUES)\b/i;
const WRITE_IN_CTE = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\b/i;
export function readOnlyPool(client) {
  return {
    query: (sql, params) => {
      const text = String(sql);
      if (!READ.test(text) || (/^\s*WITH\b/i.test(text) && WRITE_IN_CTE.test(text))) return Promise.reject(Object.assign(new Error("SENTINEL_READ_ONLY: statement refused"), { code: "SENTINEL_READ_ONLY" }));
      return client.query(sql, params);
    },
  };
}
export async function collectReadOnly({ pool, owner, now, readPool = null }) {
  // v202: with a dedicated read-only pool (every connection opened with default_transaction_read_only=on) the checks
  // run their reads in parallel on separate connections — no queueing several queries on one client.
  if (readPool) {
    const ro = readOnlyPool(readPool);
    return { reliability: await checkReliability({ pool: ro, owner, now }), health: await deepHealth({ pool: ro, owner, now }) };
  }
  const c = typeof pool.connect === "function" ? await pool.connect() : pool;
  try {
    await c.query("SET default_transaction_read_only = on");
    const ro = readOnlyPool(c);
    const reliability = await checkReliability({ pool: ro, owner, now });
    const health = await deepHealth({ pool: ro, owner, now });
    return { reliability, health };
  } finally {
    await c.query("RESET default_transaction_read_only").catch(() => undefined);
    c.release?.();
  }
}

const parse = (s, d) => { try { return JSON.parse(String(s)); } catch { return d; } };

/**
 * One Sentinel run: collect (read only) → incidents (dedup by key, severity, evidence, report) → recovery verification
 * (an incident absent in RECOVERY_CHECKS consecutive runs spanning RECOVERY_MIN_MS is resolved, recovery verified).
 */
export async function runSentinel({ pool, owner, now = Date.now(), correlationId = randomUUID(), collect = collectReadOnly, readPool = null }) {
  const run = (await pool.query(`INSERT INTO sentinel_runs(owner_id,correlation_id,started_at,status) VALUES($1,$2,$3,'running') RETURNING id`, [owner, correlationId, now])).rows[0];
  let findings, collected = false, blindAreas = new Set(), blindHealth = new Set();
  try {
    const { reliability, health } = await collect({ pool, owner, now, readPool });
    findings = findingsFrom(reliability, health);
    collected = true;
    // v202: what this run could NOT observe — an area whose data was unreadable, a health component that is unknown.
    // Incidents there are not «absent», they are unobserved: their state stays as it is.
    for (const f of findings) {
      if (f.key.startsWith("data-unavailable:")) blindAreas.add(f.area);
      if (f.key.startsWith("health:") && f.evidence?.[0]?.observed?.includes('"status":"unknown"')) blindHealth.add(f.key);
    }
    for (const a of reliability?.areas ?? []) if (a.status === "unknown") blindAreas.add(a.key);
  } catch (e) {
    // The check itself failed: that is an incident too (the monitoring is blind), with the error as evidence.
    findings = [{ key: "sentinel:check-failed", area: "sentinel", level: "fail", title: "Ο Sentinel δεν μπόρεσε να ολοκληρώσει τους ελέγχους", evidence: [{ source: "sentinel", observed: String(e?.message ?? e).slice(0, 300), at: now }] }];
  }
  const active = (await pool.query(`SELECT * FROM sentinel_incidents WHERE owner_id=$1 AND status IN ('open','recovering')`, [owner])).rows;
  const seen = new Set();
  for (const f of findings) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const severity = severityOf(f);
    const prev = active.find((a) => a.incident_key === f.key);
    const inc = { key: f.key, title: f.title, severity, evidence: f.evidence };
    const report = JSON.stringify(buildReport(inc, now));
    if (prev) {
      await pool.query(`UPDATE sentinel_incidents SET status='open',severity=$2,title=$3,last_seen_at=$4,occurrences=occurrences+1,clean_checks=0,evidence_json=$5,report_json=$6,correlation_id=$7 WHERE id=$1`, [prev.id, severity, f.title, now, JSON.stringify(f.evidence), report, correlationId]);
    } else {
      await pool.query(`INSERT INTO sentinel_incidents(owner_id,incident_key,area,severity,status,title,first_seen_at,last_seen_at,evidence_json,report_json,correlation_id) VALUES($1,$2,$3,$4,'open',$5,$6,$6,$7,$8,$9)`, [owner, f.key, f.area, severity, f.title, now, JSON.stringify(f.evidence), report, correlationId]);
    }
  }
  let resolved = 0;
  // v202: recovery only from a COMPLETED check that observed normal operation. A failed collection changes no other
  // incident (no clean check counted, nothing «recovering», nothing resolved); an unobserved area neither.
  for (const a of collected ? active : []) {
    if (seen.has(a.incident_key)) continue;
    if (blindAreas.has(a.area) || blindHealth.has(a.incident_key)) continue;
    const clean = Number(a.clean_checks) + 1;
    const verified = clean >= RECOVERY_CHECKS && now - Number(a.last_seen_at) >= RECOVERY_MIN_MS;
    if (verified) {
      const report = { ...parse(a.report_json, {}), recovery: { verifiedAt: now, cleanChecks: clean, lastSeenAt: Number(a.last_seen_at), method: `το εύρημα δεν εμφανίστηκε σε ${clean} διαδοχικούς ελέγχους` } };
      await pool.query(`UPDATE sentinel_incidents SET status='resolved',clean_checks=$2,resolved_at=$3,recovery_verified_at=$3,report_json=$4 WHERE id=$1`, [a.id, clean, now, JSON.stringify(report)]);
      resolved++;
    } else {
      await pool.query(`UPDATE sentinel_incidents SET status='recovering',clean_checks=$2 WHERE id=$1`, [a.id, clean]);
    }
  }
  const open = (await pool.query(`SELECT count(*)::int n FROM sentinel_incidents WHERE owner_id=$1 AND status='open'`, [owner])).rows[0].n;
  const status = findings.some((f) => f.key === "sentinel:check-failed") ? "check_failed" : "ok";
  await pool.query(`UPDATE sentinel_runs SET finished_at=$2,status=$3,checks=$4,open_incidents=$5 WHERE id=$1`, [run.id, now, status, findings.length, open]);
  return { correlationId, status, findings: findings.length, open: Number(open), resolved };
}

/** Incidents with their reports (for the PMS page and the API). */
export async function sentinelIncidents({ pool, owner, limit = 100 }) {
  const rows = (await pool.query(`SELECT * FROM sentinel_incidents WHERE owner_id=$1 ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'recovering' THEN 1 ELSE 2 END, CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT ${Number(limit)}`, [owner])).rows;
  const runs = (await pool.query(`SELECT correlation_id,started_at,finished_at,status,checks,open_incidents FROM sentinel_runs WHERE owner_id=$1 ORDER BY started_at DESC LIMIT 5`, [owner])).rows;
  return {
    inventory: INVENTORY.map((i) => ({ id: i.id, kind: i.kind, el: i.el, checks: i.checks, critical: Boolean(i.critical) })),
    runs: runs.map((r) => ({ correlationId: String(r.correlation_id), startedAt: Number(r.started_at), finishedAt: r.finished_at ? Number(r.finished_at) : null, status: String(r.status), checks: Number(r.checks), open: Number(r.open_incidents) })),
    incidents: rows.map((r) => ({ id: Number(r.id), key: String(r.incident_key), area: String(r.area), severity: String(r.severity), status: String(r.status), title: String(r.title), firstSeenAt: Number(r.first_seen_at), lastSeenAt: Number(r.last_seen_at), occurrences: Number(r.occurrences), cleanChecks: Number(r.clean_checks), correlationId: String(r.correlation_id), resolvedAt: r.resolved_at ? Number(r.resolved_at) : null, recoveryVerifiedAt: r.recovery_verified_at ? Number(r.recovery_verified_at) : null, report: parse(r.report_json, {}) })),
  };
}

/** The report as Markdown (download / share with the person who fixes it). */
export function reportMarkdown(inc) {
  const r = inc.report ?? {};
  const list = (xs) => (xs ?? []).map((x) => `- ${x}`).join("\n") || "- —";
  return [
    `# Συμβάν #${inc.id}: ${r.what ?? inc.title}`, "",
    `Σοβαρότητα **${inc.severity}** · κατάσταση **${inc.status}** · πρώτη εμφάνιση ${new Date(inc.firstSeenAt).toISOString()} · τελευταία ${new Date(inc.lastSeenAt).toISOString()} · ${inc.occurrences} έλεγχοι · correlation id \`${inc.correlationId}\``, "",
    "## 1. Τι δεν λειτουργεί", r.what ?? inc.title, "", "**Επίπτωση:** " + (r.impact ?? "—"), "",
    "## 2. Γιατί — αποδεικτικά", "### Επιβεβαιωμένα (από τα δεδομένα)", list(r.confirmed), "", "### Πιθανές αιτίες (ΔΕΝ έχουν επιβεβαιωθεί)", list(r.probableCauses), "",
    "## 3. Πώς διορθώνεται και πώς επιβεβαιώνεται", "### Προτεινόμενη διόρθωση (από άνθρωπο)", list(r.proposedFix), "", "### Κίνδυνοι", list(r.risks), "", "### Επαλήθευση (αναπαραγώγιμη)", list(r.validation), "",
    r.recovery ? `**Αποκατάσταση επιβεβαιώθηκε** ${new Date(r.recovery.verifiedAt).toISOString()}: ${r.recovery.method}.` : "Η αποκατάσταση δεν έχει επιβεβαιωθεί ακόμη.", "",
    `_${r.sentinelActions ?? "Ο Sentinel μόνο παρατηρεί."}_`,
  ].join("\n");
}
