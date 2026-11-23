// v189 OTA reconciliation: what the PMS would sell now per room type and date, against what was last sent to the
// channel manager (channel_availability_state, written after every accepted push). A difference with no queued push
// covering that date means a change that never reached the OTAs (e.g. a room's readiness deadline passed, a change
// made outside the normal flows). Dates still waiting in the queue are not differences: they are on their way.
// Note: «sent» means the channel manager accepted the request (HTTP 2xx); its own copy is not read back.
import { AVAILABILITY_SQL, sellable } from "./channel-core.mjs";

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const athensToday = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));

/** Consecutive dates with the same room type and the same pair of values become one range. */
export function groupMismatches(list) {
  const out = [];
  for (const m of [...list].sort((a, b) => (a.roomType === b.roomType ? a.date.localeCompare(b.date) : a.roomType.localeCompare(b.roomType)))) {
    const last = out.at(-1);
    if (last && last.roomType === m.roomType && last.pms === m.pms && last.ota === m.ota && addDays(last.to, 1) === m.date) last.to = m.date;
    else out.push({ roomType: m.roomType, from: m.date, to: m.date, pms: m.pms, ota: m.ota });
  }
  return out;
}

export async function otaReconcile({ pool, owner, now = Date.now(), days = 120 }) {
  const mapped = (await pool.query(`SELECT DISTINCT room_type FROM channel_room_mappings WHERE owner_id=$1`, [owner])).rows;
  if (!mapped.length) return { active: false, checked: 0, neverPushed: 0, mismatches: [] };
  const from = athensToday(now), to = addDays(from, days);
  const [current, state, open] = await Promise.all([
    pool.query(AVAILABILITY_SQL, [owner, from, to, now]).then((r) => r.rows),
    pool.query(`SELECT room_type,date,available FROM channel_availability_state WHERE owner_id=$1 AND date>=$2 AND date<=$3`, [owner, from, to]).then((r) => r.rows),
    pool.query(`SELECT date_from,date_to FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed','processing')`, [owner]).then((r) => r.rows),
  ]);
  const sent = new Map(state.map((s) => [`${s.room_type}|${s.date}`, Number(s.available)]));
  // A booking's range is check-in .. check-out (exclusive end in the PMS, but the queue may hold either form).
  const queued = (d) => open.some((o) => o.date_from <= d && o.date_to >= d);
  const list = [];
  let neverPushed = 0, pendingSync = 0;
  for (const r of current) {
    const k = `${r.room_type}|${r.date}`;
    const pms = sellable(r.free);
    // v191: a queued date is «pending sync» (counted and shown), not «in agreement». The queue pushes every mapped
    // room type of a date together, and a row is marked sent only when the push covered every type × date (see
    // missingCoverage), so a pending row really covers this room type too.
    if (queued(r.date)) { if (!sent.has(k) || sent.get(k) !== pms) pendingSync++; continue; }
    // v190: a date never sent is a difference too (ota: null) and is queued like the others.
    if (!sent.has(k)) { neverPushed++; list.push({ roomType: r.room_type, date: r.date, pms, ota: null }); continue; }
    const ota = sent.get(k);
    if (pms !== ota) list.push({ roomType: r.room_type, date: r.date, pms, ota });
  }
  const mismatches = groupMismatches(list);
  return { active: true, checked: current.length, neverPushed, pendingSync, mismatches, unsent: mismatches.filter((m) => m.ota === null), changed: mismatches.filter((m) => m.ota !== null) };
}

/** Queues a push for every difference (the next channel sync sends them). Returns how many ranges were queued. */
export async function queueOtaResync({ pool, owner, mismatches, now = Date.now() }) {
  for (const m of mismatches) await pool.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,created_at,updated_at) VALUES($1,$2,$3,'reconcile',$4,$4)`, [owner, m.from, m.to, now]);
  return mismatches.length;
}

/**
 * v190 read-back: the availability the channel manager itself holds (Channex GET /availability), turned into
 * { "<room type>|<date>": n }. Accepts { data: { <room_type_id>: { <date>: n | {availability:n} } } } and the
 * JSON:API list form [{ attributes: { room_type_id, date, availability } }]. Returns null for an unknown shape (then
 * nothing is concluded from it).
 */
export function parseRemoteAvailability(body, typeByExternal) {
  const out = {};
  const put = (ext, date, v) => {
    const type = typeByExternal[ext];
    const n = typeof v === "object" && v !== null ? Number(v.availability ?? v.value) : Number(v);
    if (type && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) && Number.isFinite(n)) out[`${type}|${date}`] = Math.max(0, Math.trunc(n));
  };
  const d = body?.data;
  if (Array.isArray(d)) {
    for (const x of d) { const a = x?.attributes ?? x; put(a?.room_type_id, a?.date, a?.availability); }
  } else if (d && typeof d === "object") {
    for (const [ext, dates] of Object.entries(d)) {
      if (dates && typeof dates === "object") for (const [date, v] of Object.entries(dates)) put(ext, date, v);
    }
  } else {
    return null;
  }
  return out;
}

/**
 * v191: every room type × date the PMS sells is classified against what the channel manager returned —
 * MATCHED, MISMATCHED, NOT_RETURNED (expected but missing from the answer) or NOT_CHECKED (a push is queued for that
 * date, so the answer may be out of date). responseComplete: nothing NOT_RETURNED; fullyReconciled: also nothing
 * MISMATCHED or NOT_CHECKED — only that is reported as full agreement.
 */
export function compareRemote(current, remote, open = []) {
  const queued = (d) => open.some((o) => o.date_from <= d && o.date_to >= d);
  const mism = [], missing = [];
  const counts = { MATCHED: 0, MISMATCHED: 0, NOT_RETURNED: 0, NOT_CHECKED: 0 };
  for (const r of current) {
    const k = `${r.room_type}|${r.date}`, pms = sellable(r.free);
    if (queued(r.date)) { counts.NOT_CHECKED++; continue; }
    if (!(k in remote)) { counts.NOT_RETURNED++; missing.push({ roomType: r.room_type, date: r.date, pms, ota: null }); continue; }
    if (pms !== remote[k]) { counts.MISMATCHED++; mism.push({ roomType: r.room_type, date: r.date, pms, ota: remote[k] }); } else counts.MATCHED++;
  }
  // v192: two different facts. responseComplete — Channex returned a value for every room type × date expected;
  // fullyReconciled — and every one of them was checked and equal (no MISMATCHED, NOT_RETURNED or NOT_CHECKED).
  const responseComplete = counts.NOT_RETURNED === 0;
  const fullyReconciled = responseComplete && counts.MISMATCHED === 0 && counts.NOT_CHECKED === 0 && counts.MATCHED > 0;
  return { counts, mismatches: groupMismatches(mism), notReturned: groupMismatches(missing), responseComplete, fullyReconciled };
}

/**
 * v191 push coverage: the room type × date pairs of [from, to] that the availability values about to be marked «sent»
 * do NOT cover (values use the channel manager's room type ids). Empty = every mapped type has every date.
 */
export function missingCoverage({ mappings, values, from, to }) {
  const covered = new Set();
  const typeOf = Object.fromEntries(mappings.map((m) => [m.external_room_type_id, m.room_type]));
  for (const v of values) for (let d = v.date_from; d <= v.date_to; d = addDays(d, 1)) covered.add(`${typeOf[v.room_type_id]}|${d}`);
  const out = [];
  for (const m of mappings) for (let d = from; d <= to; d = addDays(d, 1)) if (!covered.has(`${m.room_type}|${d}`)) out.push({ roomType: m.room_type, date: d });
  return out;
}

/** v192: the channels Channex reports for the property (title, active), read defensively; [] when unknown. */
export function parseChannels(body) {
  const d = Array.isArray(body?.data) ? body.data : [];
  return d.map((x) => { const a = x?.attributes ?? x ?? {}; return { id: String(x?.id ?? a.id ?? ""), title: String(a.title ?? a.channel ?? a.name ?? "κανάλι"), active: a.is_active === undefined ? null : Boolean(a.is_active) }; }).slice(0, 30);
}
