// v193 Guest Comfort Score: per occupied room, the conditions the hotel controls and can see — room temperature and
// humidity, open guest requests and their age, the room TV and the guest Wi-Fi working, open technical faults, late
// orders. It does NOT measure or assume how the guest feels: it lists the conditions that need attention, with the
// evidence, and says plainly when a signal is unknown (no sensor, no recent reading) instead of guessing.
const MIN = 60_000, HOUR = 60 * MIN;
export const COMFORT_RANGE = { min: 20, max: 26, hardMin: 18, hardMax: 28, humidMax: 70 };
const URGENT_PROBLEMS = new Set(["ac", "hot_water", "water_leak", "door_lock", "electrical"]);

const ago = (now, t) => { const m = Math.max(0, Math.round((now - Number(t)) / MIN)); return m < 60 ? `${m}′` : `${Math.floor(m / 60)} ώρ. ${m % 60}′`; };

/** Pure: the score of one room from its gathered facts. 100 = nothing needs attention. */
export function scoreRoom(f, now = Date.now()) {
  const signals = [], unknown = [];
  const add = (key, penalty, label, detail) => signals.push({ key, penalty, label, detail });
  // Temperature / humidity (only a reading of the last 2 hours counts).
  if (f.climate) {
    const fresh = f.climate.readAt && now - Number(f.climate.readAt) <= 2 * HOUR;
    if (!fresh) unknown.push({ key: "climate", label: "Θερμοκρασία", detail: f.climate.readAt ? `τελευταία μέτρηση πριν ${ago(now, f.climate.readAt)}` : "ο αισθητήρας δεν έχει δώσει μέτρηση" });
    else {
      const t = Number(f.climate.temp);
      if (Number.isFinite(t) && (t < COMFORT_RANGE.hardMin || t > COMFORT_RANGE.hardMax)) add("temp", 30, "Θερμοκρασία", `${t.toFixed(1)}°C (εκτός ${COMFORT_RANGE.hardMin}–${COMFORT_RANGE.hardMax}°C)`);
      else if (Number.isFinite(t) && (t < COMFORT_RANGE.min || t > COMFORT_RANGE.max)) add("temp", 15, "Θερμοκρασία", `${t.toFixed(1)}°C (εκτός ${COMFORT_RANGE.min}–${COMFORT_RANGE.max}°C)`);
      if (Number(f.climate.humidity) > COMFORT_RANGE.humidMax) add("humidity", 10, "Υγρασία", `${f.climate.humidity}% (πάνω από ${COMFORT_RANGE.humidMax}%)`);
    }
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
      climate: c ? { temp: c.temp === null ? null : Number(c.temp), humidity: c.humidity === null ? null : Number(c.humidity), readAt: c.read_at ? Number(c.read_at) : null } : null,
      requests: reqs,
      orders: orders.filter((x) => Number(x.booking_id) === Number(r.booking_id)).map((x) => ({ id: Number(x.id), title: String(x.title_el), createdAt: Number(x.created_at) })),
      faults: faults.filter((x) => Number(x.room_id) === Number(r.room_id)).map((x) => ({ id: Number(x.id), severity: x.severity, description: String(x.description), reportedAt: Number(x.reported_at) })),
      tv: tv ? { lastSeenAt: tv.last_seen_at ? Number(tv.last_seen_at) : null } : null,
      wifiUsed, wifi: wifi.find((x) => Number(x.booking_id) === Number(r.booking_id)) ?? null,
    };
    return { roomId: Number(r.room_id), code: String(r.code), bookingId: Number(r.booking_id), reference: String(r.reference), guest: String(r.guest_name ?? "").split(" ")[0], checkOut: String(r.check_out), ...scoreRoom(facts, now) };
  });
  out.sort((a, b) => a.score - b.score || a.code.localeCompare(b.code));
  return { at: now, rooms: out, summary: { rooms: out.length, act: out.filter((r) => r.level === "act").length, attention: out.filter((r) => r.level === "attention").length, ok: out.filter((r) => r.level === "ok").length } };
}
