// v193 Guest Comfort Score: per occupied room, the conditions the hotel controls and can see — room temperature and
// humidity, open guest requests and their age, the room TV and the guest Wi-Fi working, open technical faults, late
// orders. It does NOT measure or assume how the guest feels: it lists the conditions that need attention, with the
// evidence, and says plainly when a signal is unknown (no sensor, no recent reading) instead of guessing.
const MIN = 60_000, HOUR = 60 * MIN;
export const COMFORT_RANGE = { min: 20, max: 26, hardMin: 18, hardMax: 28, humidMax: 70 };

/**
 * v194 adaptive comfort policy (PMS → Εμπειρία πελάτη → Άνεση → Όρια): a range for the cooling season and one for the
 * heating season (heating months configurable), per-room limits overriding both, the margin beyond which a deviation
 * weighs double, the humidity limit and how old a reading may be. Every value is the hotel's; defaults below.
 */
export const DEFAULT_POLICY = { cooling: { min: 22, max: 26 }, heating: { min: 20, max: 24 }, heatingMonths: [11, 12, 1, 2, 3], hardMargin: 2, humidMax: 70, staleMinutes: 120, rooms: {} };
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
export function normalizePolicy(raw) {
  let x = raw;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { x = {}; } }
  x = x && typeof x === "object" ? x : {};
  const range = (r, d) => { const min = num(r?.min, 10, 35, d.min), max = num(r?.max, 10, 35, d.max); return min < max ? { min, max } : d; };
  const months = Array.isArray(x.heatingMonths) ? [...new Set(x.heatingMonths.map(Number).filter((m) => m >= 1 && m <= 12))] : DEFAULT_POLICY.heatingMonths;
  const rooms = {};
  for (const [id, r] of Object.entries(x.rooms && typeof x.rooms === "object" ? x.rooms : {})) if (/^\d+$/.test(id)) rooms[id] = range(r, { min: 0, max: 0 }).max ? range(r, DEFAULT_POLICY.cooling) : null;
  for (const k of Object.keys(rooms)) if (!rooms[k]) delete rooms[k];
  return { cooling: range(x.cooling, DEFAULT_POLICY.cooling), heating: range(x.heating, DEFAULT_POLICY.heating), heatingMonths: months, hardMargin: num(x.hardMargin, 0.5, 10, DEFAULT_POLICY.hardMargin), humidMax: num(x.humidMax, 40, 95, DEFAULT_POLICY.humidMax), staleMinutes: num(x.staleMinutes, 10, 1440, DEFAULT_POLICY.staleMinutes), rooms };
}
/** The range that applies to a room now: its own limits, else the season's (Athens month). */
export function rangeFor(policy, roomId, now = Date.now()) {
  const own = policy.rooms?.[String(roomId)];
  if (own) return { ...own, source: "room" };
  const month = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", month: "numeric" }).format(new Date(now)));
  return policy.heatingMonths.includes(month) ? { ...policy.heating, source: "heating" } : { ...policy.cooling, source: "cooling" };
}
/** A usable number or null (null, undefined, "", NaN are not 0 °C). */
export const reading = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const URGENT_PROBLEMS = new Set(["ac", "hot_water", "water_leak", "door_lock", "electrical"]);

const ago = (now, t) => { const m = Math.max(0, Math.round((now - Number(t)) / MIN)); return m < 60 ? `${m}′` : `${Math.floor(m / 60)} ώρ. ${m % 60}′`; };

/** Pure: the score of one room from its gathered facts. 100 = nothing needs attention. */
export function scoreRoom(f, now = Date.now(), policy = normalizePolicy(null)) {
  const signals = [], unknown = [];
  const add = (key, penalty, label, detail) => signals.push({ key, penalty, label, detail });
  const range = rangeFor(policy, f.roomId, now);
  const src = { room: "όριο δωματίου", heating: "περίοδος θέρμανσης", cooling: "περίοδος ψύξης" }[range.source];
  // Temperature / humidity: only a valid reading, not from the future, not older than the policy allows.
  if (f.climate) {
    const readAt = reading(f.climate.readAt), temp = reading(f.climate.temp), humidity = reading(f.climate.humidity);
    if (!readAt) unknown.push({ key: "climate", label: "Θερμοκρασία", detail: "ο αισθητήρας δεν έχει δώσει μέτρηση" });
    else if (readAt > now + 5 * MIN) unknown.push({ key: "climate", label: "Θερμοκρασία", detail: "μέτρηση με μελλοντική ώρα — δεν λαμβάνεται υπόψη (ελέγξτε το ρολόι του αισθητήρα)" });
    else if (now - readAt > policy.staleMinutes * MIN) unknown.push({ key: "climate", label: "Θερμοκρασία", detail: `τελευταία μέτρηση πριν ${ago(now, readAt)}` });
    else {
      if (temp === null) unknown.push({ key: "temp", label: "Θερμοκρασία", detail: "η πρόσφατη μέτρηση δεν έχει έγκυρη θερμοκρασία" });
      else if (temp < range.min - policy.hardMargin || temp > range.max + policy.hardMargin) add("temp", 30, "Θερμοκρασία δωματίου", `${temp.toFixed(1)}°C (εκτός ${range.min}–${range.max}°C κατά ${policy.hardMargin}°C+, ${src})`);
      else if (temp < range.min || temp > range.max) add("temp", 15, "Θερμοκρασία δωματίου", `${temp.toFixed(1)}°C (εκτός ${range.min}–${range.max}°C, ${src})`);
      if (humidity !== null && humidity > policy.humidMax) add("humidity", 10, "Υγρασία", `${humidity}% (πάνω από ${policy.humidMax}%)`);
    }
    // The A/C setpoint (when a native A/C integration reports it) is shown apart from the room temperature.
    const setpoint = reading(f.climate.setpoint);
    if (setpoint !== null && (setpoint < range.min - policy.hardMargin || setpoint > range.max + policy.hardMargin)) add("setpoint", 5, "Ρύθμιση κλιματιστικού", `επιλεγμένο ${setpoint}°C (θερμοκρασία δωματίου μετριέται χωριστά)`);
  } else unknown.push({ key: "climate", label: "Θερμοκρασία", detail: "χωρίς αισθητήρα στο δωμάτιο" });
  // Open requests from the TV / app, by age; technical problems weigh more.
  for (const r of f.requests ?? []) {
    const age = now - Number(r.createdAt);
    const base = age > 2 * HOUR ? 25 : age > 30 * MIN ? 15 : 5;
    const urgent = r.kind === "problem" && URGENT_PROBLEMS.has(r.problem);
    add(`req:${r.id}`, base + (urgent ? 10 : 0), r.kind === "problem" ? "Τεχνικό πρόβλημα" : "Αίτημα", `${r.label} — ανοιχτό εδώ και ${ago(now, r.createdAt)}`);
  }
  for (const o of f.orders ?? []) {
    const age = now - Number(o.createdAt);
    if (age > 45 * MIN) add(`order:${o.id}`, age > 2 * HOUR ? 15 : 8, "Παραγγελία", `${o.title} — εκκρεμεί εδώ και ${ago(now, o.createdAt)}`);
  }
  for (const m of f.faults ?? []) add(`fault:${m.id}`, m.severity === "minor" ? 5 : 20, "Βλάβη", `${m.description.slice(0, 80)} (${m.severity === "minor" ? "μικρή" : "σοβαρή"}, από ${ago(now, m.reportedAt)})`);
  // Devices: the room TV and the guest Wi-Fi.
  if (f.tv) {
    if (!f.tv.lastSeenAt) add("tv", 10, "Τηλεόραση", "δεν έχει συνδεθεί ποτέ");
    else if (now - Number(f.tv.lastSeenAt) > 15 * MIN) add("tv", 10, "Τηλεόραση", `χωρίς επαφή εδώ και ${ago(now, f.tv.lastSeenAt)}`);
  }
  if (f.wifiUsed) {
    if (!f.wifi) add("wifi", 15, "Wi-Fi πελάτη", "δεν έχει δημιουργηθεί κωδικός για τη διαμονή");
    else if (f.wifi.status === "failed") add("wifi", 15, "Wi-Fi πελάτη", `ο κωδικός απέτυχε: ${String(f.wifi.error ?? "").slice(0, 80)}`);
  }
  const penalty = signals.reduce((s, x) => s + x.penalty, 0);
  const score = Math.max(0, 100 - penalty);
  return { score, level: score >= 80 ? "ok" : score >= 50 ? "attention" : "act", signals: signals.sort((a, b) => b.penalty - a.penalty), unknown };
}

/** Every occupied room now, worst first. */
export async function comfortBoard({ pool, owner, now = Date.now() }) {
  const q = (sql, p = [owner]) => pool.query(sql, p).then((r) => r.rows);
  const policy = normalizePolicy((await q(`SELECT settings_json FROM comfort_policies WHERE owner_id=$1`).catch(() => []))[0]?.settings_json ?? null);
  const [rooms, climate, requests, orders, faults, tvs, wifi, wifiUsed] = await Promise.all([
    q(`SELECT r.id room_id,r.code,b.id booking_id,b.reference,b.guest_name,b.check_out FROM bookings b JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.status='checked_in' ORDER BY r.code`),
    q(`SELECT room_id,temp,humidity,read_at FROM room_climate WHERE owner_id=$1 AND device_id<>''`).catch(() => []),
    q(`SELECT id,room_id,kind,created_at,details_json FROM tv_requests WHERE owner_id=$1 AND status='open' AND created_at>$2::bigint-3*86400000`, [owner, now]).catch(() => []),
    q(`SELECT o.id,o.booking_id,o.title_el,o.created_at FROM department_orders o WHERE o.owner_id=$1 AND o.status NOT IN ('done','cancelled') AND o.created_at>$2::bigint-2*86400000`, [owner, now]).catch(() => []),
    q(`SELECT id,room_id,severity,description,reported_at FROM maintenance_notices WHERE owner_id=$1 AND status='open'`).catch(() => []),
    q(`SELECT room_id,last_seen_at FROM tv_screens WHERE owner_id=$1 AND active=1`).catch(() => []),
    q(`SELECT booking_id,status,error FROM guest_wifi WHERE owner_id=$1`).catch(() => []),
    q(`SELECT EXISTS(SELECT 1 FROM guest_wifi WHERE owner_id=$1) used`).then((r) => Boolean(r[0]?.used)).catch(() => false),
  ]);
  const labels = { cleaning: "Καθαρισμός", towels: "Πετσέτες", pillows: "Μαξιλάρια", blankets: "Κουβέρτες", toiletries: "Είδη μπάνιου", call_me: "Να τον καλέσουν", taxi: "Ταξί / transfer" };
  const problems = { wifi: "Wi-Fi", tv: "Τηλεόραση", ac: "Κλιματιστικό", electrical: "Ρεύμα", lighting: "Φωτισμός", hot_water: "Ζεστό νερό", water_leak: "Διαρροή νερού", door_lock: "Πόρτα / κλειδαριά", safe: "Χρηματοκιβώτιο", other: "Άλλο" };
  const out = rooms.map((r) => {
    const c = climate.find((x) => Number(x.room_id) === Number(r.room_id));
    const reqs = requests.filter((x) => Number(x.room_id) === Number(r.room_id) && !["dnd_on", "dnd_off", "instay_good"].includes(x.kind)).map((x) => {
      let d = {}; try { d = (typeof x.details_json === "object" ? x.details_json : JSON.parse(String(x.details_json ?? "{}"))) ?? {}; } catch { d = {}; }
      return { id: Number(x.id), kind: x.kind, problem: d.problem, createdAt: Number(x.created_at), label: x.kind === "problem" ? `Πρόβλημα: ${problems[d.problem] ?? d.problem ?? "—"}` : labels[x.kind] ?? x.kind };
    });
    const tv = tvs.find((x) => Number(x.room_id) === Number(r.room_id));
    const facts = {
      roomId: Number(r.room_id),
      climate: c ? { temp: reading(c.temp), humidity: reading(c.humidity), readAt: reading(c.read_at) } : null,
      requests: reqs,
      orders: orders.filter((x) => Number(x.booking_id) === Number(r.booking_id)).map((x) => ({ id: Number(x.id), title: String(x.title_el), createdAt: Number(x.created_at) })),
      faults: faults.filter((x) => Number(x.room_id) === Number(r.room_id)).map((x) => ({ id: Number(x.id), severity: x.severity, description: String(x.description), reportedAt: Number(x.reported_at) })),
      tv: tv ? { lastSeenAt: tv.last_seen_at ? Number(tv.last_seen_at) : null } : null,
      wifiUsed, wifi: wifi.find((x) => Number(x.booking_id) === Number(r.booking_id)) ?? null,
    };
    return { roomId: Number(r.room_id), code: String(r.code), bookingId: Number(r.booking_id), reference: String(r.reference), guest: String(r.guest_name ?? "").split(" ")[0], checkOut: String(r.check_out), range: rangeFor(policy, r.room_id, now), ...scoreRoom(facts, now, policy) };
  });
  out.sort((a, b) => a.score - b.score || a.code.localeCompare(b.code));
  return { at: now, policy, rooms: out, summary: { rooms: out.length, act: out.filter((r) => r.level === "act").length, attention: out.filter((r) => r.level === "attention").length, ok: out.filter((r) => r.level === "ok").length } };
}

/** Saves the hotel's comfort policy (normalised; invalid values fall back to the defaults). */
export async function saveComfortPolicy({ pool, owner, settings, by, now = Date.now() }) {
  const p = normalizePolicy(settings);
  await pool.query(`INSERT INTO comfort_policies(owner_id,settings_json,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_by=$3,updated_at=$4`, [owner, JSON.stringify(p), String(by).slice(0, 80), now]);
  return p;
}
