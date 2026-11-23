// v187 Guest Journey Orchestrator (pure; unit tested). Each step looks at the real state of a stay and returns its
// result — succeeded / failed / unconfirmed / pending / skipped — what to do to recover (an action the worker
// performs), when to look again, and whether staff must be alerted. The worker (journey-worker.mjs) keeps the rows
// and the history; the PMS shows them and lets staff retry or confirm by hand.
export const JOURNEY_STEPS = ["hk_ready", "msg_instructions", "climate_comfort", "tv_welcome"];
export const STEP_LABELS = {
  hk_ready: { el: "Housekeeping · επιβεβαίωση ετοιμότητας", en: "Housekeeping · room ready" },
  msg_instructions: { el: "Μηνύματα · οδηγίες άφιξης", en: "Messaging · arrival instructions" },
  climate_comfort: { el: "Κλιματισμός · έλεγχος άνεσης", en: "Climate · comfort check" },
  tv_welcome: { el: "Corali TV · προσωπικό καλωσόρισμα", en: "Corali TV · personal welcome" },
};
export const FINAL = ["succeeded", "skipped"];
export const COMFORT = { min: 20, max: 26 };
const MIN = 60_000;
const hhmm = (ms) => new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

/**
 * Which steps apply to a stay now. Instructions from two days before arrival; readiness and comfort on the arrival
 * day until check-in; the TV welcome once the guest has checked in.
 */
export function stepsFor(b, today) {
  const out = [];
  const arrivalDay = b.checkIn === today, upcoming = b.checkIn >= today;
  if (b.status === "confirmed" && upcoming) out.push("msg_instructions");
  if (arrivalDay && (b.status === "confirmed" || b.status === "checked_in")) out.push("hk_ready", "climate_comfort");
  if (b.status === "checked_in" && b.checkOut > today) out.push("tv_welcome");
  return out;
}

/** Housekeeping: is the room ready — or will it be — by the check-in time? */
export function evalHkReady(c) {
  const { booking: b, now, checkInMs, room } = c;
  if (b.status === "checked_in") return { status: "succeeded", detail: "Ο πελάτης έκανε check-in σε έτοιμο δωμάτιο.", next: null };
  if (!b.roomId) return { status: "failed", detail: "Δεν έχει δοθεί δωμάτιο στην κράτηση.", next: now + 10 * MIN, alert: "reception" };
  if (!room) return { status: "failed", detail: "Το δωμάτιο δεν βρέθηκε.", next: now + 10 * MIN, alert: "reception" };
  if (room.state === "ready") return { status: "succeeded", detail: `Το δωμάτιο ${room.code} είναι έτοιμο και εγκεκριμένο.`, next: now + 15 * MIN };
  if (room.state === "out_of_service") return { status: "failed", detail: `Το δωμάτιο ${room.code} είναι εκτός λειτουργίας — χρειάζεται άλλο δωμάτιο.`, next: now + 10 * MIN, alert: "reception" };
  if (room.eta && room.eta <= checkInMs) return { status: "pending", detail: `Σε προετοιμασία· αναμένεται έτοιμο στις ${hhmm(room.eta)} (check-in ${hhmm(checkInMs)}).`, next: now + 5 * MIN };
  if (room.eta) return { status: "failed", detail: `Θα είναι έτοιμο στις ${hhmm(room.eta)}, μετά την ώρα check-in (${hhmm(checkInMs)}).`, next: now + 5 * MIN, alert: "housekeeping" };
  if (now < checkInMs - 3 * 60 * MIN) return { status: "pending", detail: "Σε αναμονή καθαρισμού (δεν έχει οριστεί ώρα ετοιμότητας ακόμη).", next: now + 10 * MIN };
  return { status: "failed", detail: `Δεν είναι έτοιμο και δεν έχει οριστεί ώρα ετοιμότητας (check-in ${hhmm(checkInMs)}).`, next: now + 5 * MIN, alert: "housekeeping" };
}

/** Messaging: did the arrival instructions (pre-arrival / check-in message) reach the guest? */
export function evalInstructions(c) {
  const { booking: b, now, checkInMs, deliveries = [], arrivalAutomationOn, prev } = c;
  if (!b.email && !b.phone) return { status: "skipped", detail: "Η κράτηση δεν έχει email ή τηλέφωνο.", next: null };
  const mine = deliveries.filter((d) => d.event === "pre_arrival" || d.event === "checkin");
  const sent = mine.find((d) => d.status === "sent");
  if (sent) return { status: "succeeded", detail: `Στάλθηκαν (${sent.channel === "whatsapp" ? "WhatsApp" : "email"}${sent.sentAt ? `, ${hhmm(sent.sentAt)}` : ""}).`, next: null };
  const failed = mine.filter((d) => d.status === "failed");
  const retries = Number(prev?.result?.retries ?? 0);
  if (failed.length) {
    if (retries < 2) return { status: "pending", detail: `Η αποστολή απέτυχε (${failed[0].error || "σφάλμα"}) — νέα προσπάθεια ${retries + 1}/2.`, next: now + 15 * MIN, action: { type: "retry_deliveries" } };
    return { status: "failed", detail: `Η αποστολή απέτυχε και μετά από 2 επαναλήψεις: ${failed[0].error || "σφάλμα"}. Στείλτε τις οδηγίες χειροκίνητα ή πατήστε «Επανάληψη».`, next: now + 30 * MIN, alert: "reception" };
  }
  if (mine.some((d) => d.status === "pending" || d.status === "processing")) return { status: "pending", detail: "Προγραμματισμένα για αποστολή.", next: now + 10 * MIN };
  if (!arrivalAutomationOn) return { status: "unconfirmed", detail: "Τα αυτόματα μηνύματα άφιξης είναι απενεργοποιημένα — δεν υπάρχει επιβεβαίωση ότι ο πελάτης έλαβε οδηγίες.", next: now + 60 * MIN };
  if (b.checkIn === c.today && now > checkInMs) return { status: "failed", detail: "Δεν στάλθηκαν οδηγίες άφιξης πριν την ώρα check-in.", next: now + 30 * MIN, alert: "reception" };
  return { status: "pending", detail: "Θα σταλούν από τα αυτόματα μηνύματα.", next: now + 30 * MIN };
}

/** Climate: is the room comfortable for the arrival (sensor reading), and if not, pre-condition it with the A/C. */
export function evalClimate(c) {
  const { booking: b, now, checkInMs, climate, ac, prev } = c;
  if (b.status === "checked_in") return prev && prev.status !== "pending" ? { status: prev.status, detail: prev.detail, next: null } : { status: "unconfirmed", detail: "Ο πελάτης έκανε check-in πριν ολοκληρωθεί ο έλεγχος άνεσης.", next: null };
  if (now < checkInMs - 90 * MIN) return { status: "pending", detail: `Ο έλεγχος γίνεται από τις ${hhmm(checkInMs - 90 * MIN)}.`, next: checkInMs - 90 * MIN };
  if (!climate) return { status: "unconfirmed", detail: "Χωρίς αισθητήρα θερμοκρασίας στο δωμάτιο — δεν υπάρχει μέτρηση.", next: now + 60 * MIN };
  if (!climate.readAt || now - climate.readAt > 45 * MIN || climate.temp === null) return { status: "unconfirmed", detail: "Η τελευταία μέτρηση του αισθητήρα είναι παλιά (>45′).", next: now + 15 * MIN };
  const t = Number(climate.temp), ok = t >= COMFORT.min && t <= COMFORT.max;
  if (ok) return { status: "succeeded", detail: `${t.toFixed(1)} °C — εντός ορίων άνεσης (${COMFORT.min}–${COMFORT.max} °C).`, next: now + 30 * MIN };
  const startedAt = Number(prev?.result?.acStartedAt ?? 0);
  if (ac?.device && ac.enabled && !ac.occupied && !startedAt) return { status: "pending", detail: `${t.toFixed(1)} °C — ενεργοποίηση κλιματισμού για προετοιμασία του δωματίου.`, next: now + 15 * MIN, action: { type: "ac_precondition", until: checkInMs + 2 * 60 * MIN } };
  if (startedAt && now - startedAt < 45 * MIN) return { status: "pending", detail: `${t.toFixed(1)} °C — ο κλιματισμός λειτουργεί από τις ${hhmm(startedAt)}, αναμονή.`, next: now + 10 * MIN };
  return { status: "failed", detail: `${t.toFixed(1)} °C — εκτός ορίων άνεσης${startedAt ? " και μετά από 45′ κλιματισμού" : ac?.device ? " (ο αυτόματος κλιματισμός είναι απενεργοποιημένος)" : " (χωρίς αυτόματο κλιματισμό)"}. Ελέγξτε το δωμάτιο.`, next: now + 15 * MIN, alert: "reception" };
}

/** Corali TV: a personal welcome on the room TV, confirmed when the TV reports that it was shown. */
export function evalTvWelcome(c) {
  const { now, tv, prev, booking: b } = c;
  if (!tv) return { status: "skipped", detail: "Δεν υπάρχει Corali TV στο δωμάτιο.", next: null };
  const r = prev?.result ?? {};
  if (!r.messageId) return { status: "pending", detail: `Αποστολή προσωπικού καλωσορίσματος (${firstName(b.guestName) || "πελάτης"}).`, next: now + 5 * MIN, action: { type: "tv_send" } };
  if (tv.seenAt) return { status: "succeeded", detail: `Προβλήθηκε στην τηλεόραση στις ${hhmm(tv.seenAt)}.`, next: null };
  const online = tv.lastSeenAt && now - tv.lastSeenAt < 10 * MIN;
  if (!online) {
    if (!r.wokeAt) return { status: "pending", detail: "Η τηλεόραση δεν απαντά — νέα αποστολή με αφύπνιση της οθόνης.", next: now + 10 * MIN, action: { type: "tv_send", wake: true } };
    return { status: "failed", detail: `Η τηλεόραση δεν είναι συνδεδεμένη${tv.lastSeenAt ? ` (τελευταία επαφή ${hhmm(tv.lastSeenAt)})` : ""}.`, next: now + 15 * MIN, alert: "reception" };
  }
  if (now - Number(r.sentAt ?? now) > 4 * 60 * MIN) return { status: "unconfirmed", detail: "Η τηλεόραση είναι συνδεδεμένη αλλά δεν ανέφερε προβολή του καλωσορίσματος.", next: now + 60 * MIN };
  return { status: "pending", detail: "Στάλθηκε· αναμονή επιβεβαίωσης από την τηλεόραση.", next: now + 5 * MIN };
}

export const evaluators = { hk_ready: evalHkReady, msg_instructions: evalInstructions, climate_comfort: evalClimate, tv_welcome: evalTvWelcome };
export const firstName = (n) => String(n ?? "").trim().split(/\s+/)[0] ?? "";

/** The welcome text on the TV (guest language; Greek / English fall-back). */
export function welcomeBody(name, lang) {
  const n = firstName(name);
  const t = {
    el: `Καλώς ήρθατε${n ? `, ${n}` : ""}! Σας ευχόμαστε υπέροχη διαμονή στο Hotel Corali.`,
    en: `Welcome${n ? `, ${n}` : ""}! We wish you a wonderful stay at Hotel Corali.`,
    fr: `Bienvenue${n ? `, ${n}` : ""} ! Nous vous souhaitons un excellent séjour à l'Hotel Corali.`,
    de: `Willkommen${n ? `, ${n}` : ""}! Wir wünschen Ihnen einen wunderschönen Aufenthalt im Hotel Corali.`,
    it: `Benvenuti${n ? `, ${n}` : ""}! Vi auguriamo un soggiorno meraviglioso all'Hotel Corali.`,
    es: `¡Bienvenidos${n ? `, ${n}` : ""}! Les deseamos una estancia maravillosa en el Hotel Corali.`,
  };
  const l = String(lang ?? "en").slice(0, 2);
  return { el: t.el, en: t.en, ...(t[l] && l !== "el" && l !== "en" ? { [l]: t[l] } : {}) };
}

/** One line per stay for the PMS: worst status first. */
export function journeySummary(actions) {
  const order = ["failed", "unconfirmed", "pending", "succeeded", "skipped"];
  return [...actions].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0]?.status ?? "pending";
}

/** Cron step health: alert after 3 failures in a row (once, until it succeeds again). */
export function automationAlert(row) {
  return row.consecutive_failures >= 3 && !row.alerted_at;
}
