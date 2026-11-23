// v186–v187: the three room states (shared SQL and pure rules; PMS, booking site, OTA sync, journey orchestrator).
//   out_of_service — out of order or an open defect: never sold, nobody checked in.
//   ready          — housekeeping approved (no open task, not dirty): sold, check-in allowed.
//   preparing      — dirty / cleaning / waiting for approval: sold for an arrival TODAY only when the expected ready
//                    time (set by staff, or estimated when cleaning starts / ends) is before the check-in time (and at
//                    least an hour from now); later arrivals are sold as usual; no check-in until ready.
export const OPEN_TASK_STATUSES = ["todo", "in_progress", "cleaned", "repaired", "out_of_order"];
/** Minutes a cleaning usually takes (used for the expected ready time when it starts); approval adds INSPECTION_MIN. */
export const CLEAN_MINUTES = { departure_clean: 45, stayover_clean: 25, touch_up: 20, final_inspection: 15 };
export const INSPECTION_MIN = 30;
export const SAME_DAY_MARGIN_MIN = 60;
export const DEFAULT_CHECKIN_TIME = "13:00";

const OPEN = `('todo','in_progress','cleaned','repaired','out_of_order')`;
/** SQL: room alias `r` is ready now. */
export const ROOM_READY_SQL = `(r.operational_status NOT IN ('dirty','out_of_order') AND NOT EXISTS (SELECT 1 FROM housekeeping_tasks rt_t WHERE rt_t.owner_id=r.owner_id AND rt_t.room_id=r.id AND rt_t.status IN ${OPEN}))`;
/** SQL: room `r` is out of service. */
export const ROOM_OUT_OF_SERVICE_SQL = `(r.operational_status='out_of_order' OR EXISTS (SELECT 1 FROM housekeeping_tasks os_t WHERE os_t.owner_id=r.owner_id AND os_t.room_id=r.id AND os_t.status='out_of_order'))`;
/** SQL: the hotel switched off «not sold for today while not ready» (no settings row = on). */
export const SAME_DAY_RULE_OFF_SQL = `COALESCE((SELECT rr_s.block_same_day FROM room_readiness_settings rr_s WHERE rr_s.owner_id=r.owner_id),1)=0`;
/** SQL: today's check-in time from Corali TV settings (text match, so a damaged JSON never breaks a query). */
const CHECKIN_TIME_SQL = `COALESCE((SELECT substring(ts.settings_json from '"checkInTime"\\s*:\\s*"(([01][0-9]|2[0-3]):[0-5][0-9])"') FROM tv_settings ts WHERE ts.owner_id=r.owner_id),'${DEFAULT_CHECKIN_TIME}')`;
/** SQL (epoch ms): an arrival today must find the room ready by this moment — the check-in time, or an hour from now. */
export const sameDayDeadlineSql = (todaySql, nowMsSql) => `GREATEST((extract(epoch from (((${todaySql})::date + (${CHECKIN_TIME_SQL})::time) AT TIME ZONE 'Europe/Athens'))*1000)::bigint, (${nowMsSql})::bigint + ${SAME_DAY_MARGIN_MIN * 60_000})`;
/** SQL: not out of service, and ready — or every open task has an expected ready time no later than `deadlineSql`. */
export const roomReadyBySql = (deadlineSql) => `(NOT ${ROOM_OUT_OF_SERVICE_SQL} AND (${ROOM_READY_SQL} OR (EXISTS (SELECT 1 FROM housekeeping_tasks eta_t WHERE eta_t.owner_id=r.owner_id AND eta_t.room_id=r.id AND eta_t.status IN ${OPEN}) AND NOT EXISTS (SELECT 1 FROM housekeeping_tasks eta_t WHERE eta_t.owner_id=r.owner_id AND eta_t.room_id=r.id AND eta_t.status IN ${OPEN} AND (eta_t.expected_ready_at IS NULL OR eta_t.expected_ready_at > ${deadlineSql})))))`;

/**
 * SQL: room `r` may be sold for a night starting `dateSql` — always for later dates (out-of-order rooms are excluded
 * by the callers); for today only when ready in time for check-in (or the rule is off).
 */
export const sellableForArrival = (dateSql, todaySql, nowMsSql) => `(${dateSql}<>${todaySql} OR ${SAME_DAY_RULE_OFF_SQL} OR ${roomReadyBySql(sameDayDeadlineSql(todaySql, nowMsSql))})`;

// ───────────────────────────── pure (unit tested) ─────────────────────────────

/** "out_of_service" | "ready" | "preparing" from the room status and its open tasks. */
export function roomState(room) {
  const tasks = Array.isArray(room.openTasks) ? room.openTasks : room.openTaskStatus ? [{ status: room.openTaskStatus, expectedReadyAt: room.expectedReadyAt ?? null }] : [];
  if (room.operationalStatus === "out_of_order" || tasks.some((t) => t.status === "out_of_order")) return "out_of_service";
  if (room.operationalStatus === "dirty" || tasks.some((t) => OPEN_TASK_STATUSES.includes(String(t.status)))) return "preparing";
  return "ready";
}
export const roomReady = (room) => roomState(room) === "ready";
/** Expected ready time of a preparing room: the latest of its open tasks; null when any is unknown. */
export function expectedReadyAt(room) {
  const tasks = Array.isArray(room.openTasks) ? room.openTasks : room.openTaskStatus ? [{ status: room.openTaskStatus, expectedReadyAt: room.expectedReadyAt ?? null }] : [];
  const open = tasks.filter((t) => OPEN_TASK_STATUSES.includes(String(t.status)));
  if (!open.length || open.some((t) => t.expectedReadyAt === null || t.expectedReadyAt === undefined)) return null;
  return Math.max(...open.map((t) => Number(t.expectedReadyAt)));
}
const athens = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** Epoch ms of a hotel (Athens) date and time. */
export function hotelMs(date, time) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  for (const off of [3, 2]) {
    const ms = guess - off * 3_600_000, p = Object.fromEntries(athens.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}` === date && `${p.hour % 24}`.padStart(2, "0") + `:${p.minute}` === time) return ms;
  }
  return guess - 2 * 3_600_000;
}
export const sameDayDeadline = (today, checkInTime, now) => Math.max(hotelMs(today, /^([01]\d|2[0-3]):[0-5]\d$/.test(checkInTime ?? "") ? checkInTime : DEFAULT_CHECKIN_TIME), now + SAME_DAY_MARGIN_MIN * 60_000);
/** May the room be sold for an arrival on `arrival`? */
export function sellableToday(room, arrival, today, ruleOn = true, deadline = Infinity) {
  const state = roomState(room);
  if (state === "out_of_service") return false;
  if (arrival !== today || !ruleOn || state === "ready") return true;
  const eta = expectedReadyAt(room);
  return eta !== null && eta <= deadline;
}
/** Expected ready time when a cleaning starts / is finished. */
export const etaOnStart = (taskType, now) => now + ((CLEAN_MINUTES[taskType] ?? 45) + INSPECTION_MIN) * 60_000;
export const etaOnComplete = (now) => now + INSPECTION_MIN * 60_000;
