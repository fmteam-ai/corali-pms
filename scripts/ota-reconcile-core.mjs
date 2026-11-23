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
  let neverPushed = 0;
  for (const r of current) {
    const k = `${r.room_type}|${r.date}`;
    if (!sent.has(k)) { neverPushed++; continue; }
    const pms = sellable(r.free), ota = sent.get(k);
    if (pms !== ota && !queued(r.date)) list.push({ roomType: r.room_type, date: r.date, pms, ota });
  }
  return { active: true, checked: current.length, neverPushed, mismatches: groupMismatches(list) };
}

/** Queues a push for every difference (the next channel sync sends them). Returns how many ranges were queued. */
export async function queueOtaResync({ pool, owner, mismatches, now = Date.now() }) {
  for (const m of mismatches) await pool.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,created_at,updated_at) VALUES($1,$2,$3,'reconcile',$4,$4)`, [owner, m.from, m.to, now]);
  return mismatches.length;
}
