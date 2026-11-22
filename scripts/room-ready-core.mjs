// v186: is a room ready for a guest? (shared SQL; PMS, booking site, OTA sync). Ready = not dirty / out of order and
// no open housekeeping task (to clean, cleaning, waiting for approval, repaired-waiting-approval, defect).
export const OPEN_TASK_STATUSES = ["todo", "in_progress", "cleaned", "repaired", "out_of_order"];

/** SQL: room alias `r` is ready now. */
export const ROOM_READY_SQL = `(r.operational_status NOT IN ('dirty','out_of_order') AND NOT EXISTS (SELECT 1 FROM housekeeping_tasks rt_t WHERE rt_t.owner_id=r.owner_id AND rt_t.room_id=r.id AND rt_t.status IN ('todo','in_progress','cleaned','repaired','out_of_order')))`;

/** SQL: the hotel switched off «not sold for today while not ready» (no settings row = on). */
export const SAME_DAY_RULE_OFF_SQL = `COALESCE((SELECT rr_s.block_same_day FROM room_readiness_settings rr_s WHERE rr_s.owner_id=r.owner_id),1)=0`;

/**
 * SQL: room `r` may be sold for an arrival on `dateSql` given today's hotel date `todaySql` — always for a later
 * arrival; for today only when ready (or the rule is off).
 */
export const sellableForArrival = (dateSql, todaySql) => `(${dateSql}<>${todaySql} OR ${SAME_DAY_RULE_OFF_SQL} OR ${ROOM_READY_SQL})`;

/** Pure: same rule in code (unit tested). */
export function roomReady(room) {
  return !["dirty", "out_of_order"].includes(String(room.operationalStatus)) && !OPEN_TASK_STATUSES.includes(String(room.openTaskStatus ?? ""));
}
export function sellableToday(room, arrival, today, ruleOn = true) {
  return arrival !== today || !ruleOn || roomReady(room);
}
