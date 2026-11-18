// Corali TV screen commands (v158): PMS → Corali TV app (≥ 1.8) with delivery and execution reports.
// See scripts/tv-command-core.mjs for the rules (statuses, expiry, what counts as EXECUTED).
import { db } from "@/lib/db";
import { hotelToday } from "@/lib/tape-chart";
import { hotelTime } from "@/lib/tv";
import { loadPowerSettings, POWER_METHOD_SQL } from "@/lib/tv-power";
import { GAP_MS, MENU_LOCK_COMMANDS, menuLockState, menuLockVerdict, parseMenuLockRaw, type StandbyDiag } from "../scripts/tv-command-core.mjs";
import { agentState, autoCommand, COMMAND_TTL_MS, expiredStatus, normalizeSoundPolicy, parseCapabilities, reportStatus, resetPlan, resetRoomStatus, type ResetAction, type ResetStatus, type SoundPolicy, type TvCommand } from "../scripts/tv-command-core.mjs";
import { desiredPower } from "../scripts/tv-power-core.mjs";

export type CommandRow = { id: number; room_id: number; command: string; source: string; status: string; error: string; created_at: number; delivered_at: number | null; finished_at: number | null; value: number | null; cap: number | null; result_volume: number | null; result_muted: number | null; not_before: number | null; result_text: string };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toRow = (x: Record<string, unknown>): CommandRow => ({ id: Number(x.id), room_id: Number(x.room_id), command: String(x.command), source: String(x.source), status: String(x.status), error: String(x.error ?? ""), created_at: Number(x.created_at), delivered_at: num(x.delivered_at), finished_at: num(x.finished_at), value: num(x.value), cap: num(x.cap), result_volume: num(x.result_volume), result_muted: num(x.result_muted), not_before: num(x.not_before), result_text: String(x.result_text ?? "") });

/** Close commands whose time ran out (TIMEOUT / UNVERIFIED), for one room or all. */
async function expire(ownerId: string, roomId: number | null, now: number) {
  const rows = (await db().query(`SELECT id,status,expires_at,delivered_at FROM tv_screen_commands WHERE owner_id=$1 AND status IN ('PENDING','DELIVERED') ${roomId === null ? "" : "AND room_id=$2"}`, roomId === null ? [ownerId] : [ownerId, roomId])).rows;
  for (const r of rows) {
    const next = expiredStatus({ status: String(r.status), expires_at: Number(r.expires_at), delivered_at: num(r.delivered_at) }, now);
    if (next !== r.status) {
      await db().query(`UPDATE tv_screen_commands SET status=$2,error=$3,finished_at=$4 WHERE id=$1 AND status=$5`, [r.id, next, next === "TIMEOUT" ? "NOT_DELIVERED" : "NO_REPORT", now, r.status]);
    }
  }
}

/** Queue a command for the room; an older one still waiting is CANCELLED (the newest wins). */
export async function queueCommand(ownerId: string, roomId: number, command: TvCommand, source: "manual" | "auto" | "reset", userId: number | null, value: number | null = null, opts: { supersede?: boolean; ttlMs?: number; notBefore?: number } = {}): Promise<CommandRow | null> {
  const now = Date.now();
  const room = (await db().query(`SELECT 1 FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  if (!room) return null;
  // Only one command waits per room: a newer one replaces it (a quick double press never runs twice). A reset queues
  // its steps together (supersede only before the first), delivered oldest first, one per check.
  if (opts.supersede !== false) await db().query(`UPDATE tv_screen_commands SET status='CANCELLED',error='SUPERSEDED',finished_at=$3 WHERE owner_id=$1 AND room_id=$2 AND status='PENDING'`, [ownerId, roomId, now]);
  const policy = (await soundPolicies(ownerId))[roomId];
  const cap = policy?.enforceMax ? policy.maxVolume : null;
  const r = await db().query(
    `INSERT INTO tv_screen_commands(owner_id,room_id,command,source,status,created_by,created_at,expires_at,value,cap,not_before) VALUES($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10) RETURNING *`,
    // v164: a scheduled command (standby test) is handed over only from not_before, and expires ttl after it.
    [ownerId, roomId, command, source, userId, now, (opts.notBefore ?? now) + (opts.ttlMs ?? COMMAND_TTL_MS), value, cap, opts.notBefore ?? null],
  );
  return toRow(r.rows[0]);
}

/**
 * The app's check (every ~20 s): records what it measured (screen on/off, version, screen-off permission), applies the
 * automatic arrival / check-out rule for «android_agent» rooms, and hands over the newest waiting command (once).
 */
export type AgentReport = { interactive: boolean | null; version: number | null; admin: boolean | null; volume?: number | null; muted?: boolean | null; fixed?: boolean | null; caps?: Record<string, unknown> | null; clamped?: boolean; policyRev?: number | null; menuLock?: string | null; standby?: StandbyDiag | null };
export type AgentAnswer = { command: { id: number; command: string; value: number | null; cap: number | null } | null; policy: (SoundPolicy & { rev: number }) | null; standby?: { network: boolean; offMode: string } | null };

export async function agentCheck(ownerId: string, roomId: number, report: AgentReport): Promise<AgentAnswer> {
  const now = Date.now();
  const b = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);
  // v164: what the PMS knew before this check — to record silences (TV / Wi-Fi asleep) and screen changes.
  const before = (await db().query(`SELECT screen_seen_at,screen_interactive FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  const row = (await db().query(
    `UPDATE tv_screens SET screen_seen_at=$3,screen_interactive=$4,app_version=COALESCE($5,app_version),app_admin=COALESCE($6,app_admin),
       volume_percent=COALESCE($7,volume_percent),volume_muted=COALESCE($8,volume_muted),volume_fixed=COALESCE($9,volume_fixed),
       caps_json=COALESCE($10,caps_json),policy_clamped_at=CASE WHEN $11::boolean THEN $3 ELSE policy_clamped_at END,policy_rev_applied=COALESCE($12,policy_rev_applied)
      WHERE owner_id=$1 AND room_id=$2 RETURNING ${POWER_METHOD_SQL} AS method,screen_auto_state,network_standby,power_off_mode`,
    [ownerId, roomId, now, b(report.interactive), report.version, b(report.admin), report.volume ?? null, b(report.muted), b(report.fixed), report.caps ? JSON.stringify(parseCapabilities(report.caps)) : null, report.clamped === true, report.policyRev ?? null],
  )).rows[0];
  if (row && before) {
    const prevSeen = num(before.screen_seen_at), prevOn = num(before.screen_interactive), nowOn = b(report.interactive);
    if (prevSeen !== null && now - prevSeen > GAP_MS) {
      await db().query(`INSERT INTO tv_power_events(owner_id,room_id,at,kind,detail) VALUES($1,$2,$3,'GAP',$4::jsonb)`, [ownerId, roomId, now, JSON.stringify({ from: prevSeen, to: now, seconds: Math.round((now - prevSeen) / 1000), screenBefore: prevOn, screenAfter: nowOn })]);
    }
    if (nowOn !== null && prevOn !== null && nowOn !== prevOn) {
      await db().query(`INSERT INTO tv_power_events(owner_id,room_id,at,kind,detail) VALUES($1,$2,$3,'SCREEN',$4::jsonb)`, [ownerId, roomId, now, JSON.stringify({ on: nowOn === 1, standby: report.standby ?? null })]);
    }
  }
  if (row && report.standby) await db().query(`UPDATE tv_screens SET standby_diag=$3 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, JSON.stringify(report.standby)]);
  // v163: the menu lock as the TV read it (≥ 1.14); the state is derived here, never taken from the app as text.
  if (row && report.menuLock && parseMenuLockRaw(report.menuLock)) {
    await db().query(`UPDATE tv_screens SET menu_lock_raw=$3,menu_lock_state=$4,menu_lock_seen_at=$5 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, report.menuLock, menuLockState(report.menuLock), now]);
  }
  // Sound policy for apps that apply it (≥ 1.9), whatever the power method.
  const policy = row && report.version !== null && report.version >= 10 ? (await soundPolicies(ownerId))[roomId] ?? null : null;
  // v164 (≥ 1.15): keep CPU / Wi-Fi awake in standby or not, and how PMS OFF is done in this room.
  const standby = row && report.version !== null && report.version >= 16 ? { network: Number(row.network_standby) !== 0, offMode: String(row.power_off_mode ?? "device_admin") } : null;
  // Only apps that report their state (≥ 1.8) take commands; older apps keep working without remote control.
  if (!row || report.version === null) return { command: null, policy, standby };
  if (row.method !== "android_agent") {
    // Sound commands work in any room with an app ≥ 1.9; screen on / off only with the «android_agent» method.
    await expire(ownerId, roomId, now);
    return { command: await deliver(ownerId, roomId, now, true), policy, standby };
  }
  const { settings } = await loadPowerSettings(ownerId);
  if (settings.enabled) {
    const today = hotelToday();
    const stays = (await db().query(`SELECT status,check_in,check_out FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status IN ('confirmed','checked_in') AND check_in<=$3 AND check_out>=$3`, [ownerId, roomId, today])).rows;
    const want = desiredPower(stays.map((x) => ({ status: String(x.status), check_in: String(x.check_in), check_out: String(x.check_out) })), today, hotelTime(), settings.onTime);
    const auto = autoCommand(row.screen_auto_state === null ? null : String(row.screen_auto_state), want, settings);
    if (auto.state !== row.screen_auto_state) await db().query(`UPDATE tv_screens SET screen_auto_state=$3 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, auto.state]);
    if (auto.command) await queueCommand(ownerId, roomId, auto.command, "auto", null);
  }
  await expire(ownerId, roomId, now);
  return { command: await deliver(ownerId, roomId, now, false), policy, standby };
}

/** Hand over the newest waiting command once (atomic). soundOnly: rooms not run by the app keep screen commands back. */
async function deliver(ownerId: string, roomId: number, now: number, soundOnly: boolean) {
  const next = (await db().query(
    `UPDATE tv_screen_commands SET status='DELIVERED',delivered_at=$3 WHERE id=(SELECT id FROM tv_screen_commands WHERE owner_id=$1 AND room_id=$2 AND status='PENDING' AND COALESCE(not_before,0)<=$3 ${soundOnly ? "AND command NOT IN ('SCREEN_ON','SCREEN_OFF')" : ""} ORDER BY id ASC LIMIT 1) AND status='PENDING' RETURNING id,command,value,cap`,
    [ownerId, roomId, now],
  )).rows[0];
  return next ? { id: Number(next.id), command: String(next.command), value: num(next.value), cap: num(next.cap) } : null;
}

/** Sound policies of all rooms (desired state set in PMS → Corali TV → Ήχος). */
export async function soundPolicies(ownerId: string): Promise<Record<number, SoundPolicy & { rev: number }>> {
  const rows = (await db().query(`SELECT room_id,default_volume,max_volume,enforce_max,updated_at FROM tv_sound_policies WHERE owner_id=$1`, [ownerId])).rows;
  return Object.fromEntries(rows.map((r) => [Number(r.room_id), { ...normalizeSoundPolicy({ defaultVolume: r.default_volume, maxVolume: r.max_volume, enforceMax: Number(r.enforce_max) === 1 }), rev: Number(r.updated_at) }]));
}

/** Save one policy for several rooms (bulk); returns the rooms saved. The TVs pick it up on their next check. */
export async function saveSoundPolicy(ownerId: string, roomIds: number[], raw: unknown, userId: number): Promise<number[]> {
  const p = normalizeSoundPolicy(raw);
  const now = Date.now();
  const saved: number[] = [];
  for (const roomId of roomIds) {
    const r = await db().query(
      `INSERT INTO tv_sound_policies(owner_id,room_id,default_volume,max_volume,enforce_max,updated_by,updated_at)
         SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS (SELECT 1 FROM tv_screens WHERE owner_id=$1 AND room_id=$2)
       ON CONFLICT(owner_id,room_id) DO UPDATE SET default_volume=$3,max_volume=$4,enforce_max=$5,updated_by=$6,updated_at=$7`,
      [ownerId, roomId, p.defaultVolume, p.maxVolume, p.enforceMax ? 1 : 0, userId, now],
    );
    if (r.rowCount) saved.push(roomId);
  }
  return saved;
}

/** The app's report for a delivered command; applied once. */
export async function agentReport(ownerId: string, roomId: number, id: number, report: { status?: string; interactive?: boolean; error?: string; volume?: number; muted?: boolean; fixed?: boolean; opened?: boolean; detail?: string; menuLock?: string }): Promise<string | null> {
  const r = (await db().query(`SELECT id,command,status,value,cap,created_at FROM tv_screen_commands WHERE id=$1 AND owner_id=$2 AND room_id=$3`, [id, ownerId, roomId])).rows[0];
  if (!r) return null;
  let next = reportStatus({ status: String(r.status), command: String(r.command), value: num(r.value), cap: num(r.cap) }, report);
  if (!next) return String(r.status);
  let byOther = false;
  if (next === "EXECUTED" && String(r.command) === "SCREEN_ON") {
    // v166: the screen came on by the remote (or Cast) while the command waited for an unreachable TV — the TV then
    // takes the command and finds the screen on. That is not a PMS wake-up: never shown as success.
    byOther = Boolean((await db().query(
      `SELECT 1 FROM tv_power_events WHERE owner_id=$1 AND room_id=$2 AND kind='SCREEN' AND (detail->>'on')::boolean AND NOT detail ? 'command' AND at>=$3 LIMIT 1`,
      [ownerId, roomId, Number(r.created_at)],
    )).rowCount);
    if (byOther) next = "FAILED";
  }
  // v167: Lock / Unlock — the server's own verdict from the reported state (the TV's code when it refused).
  const lockVerdict = MENU_LOCK_COMMANDS.includes(String(r.command) as never) ? menuLockVerdict(String(r.command), report) : null;
  const error = (byOther ? "TURNED_ON_BY_REMOTE" : next === "EXECUTED" ? "" : String(lockVerdict?.error || report.error || (next === "UNVERIFIED" ? "NO_STATE" : "STATE_DID_NOT_CHANGE"))).replace(/[^A-Za-z0-9_ .:-]/g, "").slice(0, 120);
  const now = Date.now();
  if (report.menuLock && parseMenuLockRaw(report.menuLock)) {
    await db().query(`UPDATE tv_screens SET menu_lock_raw=$3,menu_lock_state=$4,menu_lock_seen_at=$5 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, report.menuLock, menuLockState(report.menuLock), now]);
  }
  const error2 = next === "FAILED" && report.fixed === true && !report.error ? "FIXED_VOLUME" : error;
  // v164: the TV's own text (wake method used, diagnostics), printable characters only, at most 4000.
  const detail = typeof report.detail === "string" ? report.detail.replace(/[^\x20-\x7E\n\u0370-\u03FF]/g, "").slice(0, 4000) : null;
  await db().query(`UPDATE tv_screen_commands SET status=$2,error=$3,finished_at=$4,result_volume=$5,result_muted=$6,result_text=COALESCE($7,result_text) WHERE id=$1 AND status='DELIVERED'`, [id, next, error2, now, Number.isInteger(report.volume) ? report.volume : null, typeof report.muted === "boolean" ? (report.muted ? 1 : 0) : null, detail]);
  if (Number.isInteger(report.volume) || typeof report.muted === "boolean") {
    await db().query(`UPDATE tv_screens SET volume_percent=COALESCE($3,volume_percent),volume_muted=COALESCE($4,volume_muted) WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, Number.isInteger(report.volume) ? report.volume : null, typeof report.muted === "boolean" ? (report.muted ? 1 : 0) : null]);
  }
  if (typeof report.interactive === "boolean") {
    // v164: a screen change reported with a command is recorded as an event too (with the command that caused it).
    const prev = (await db().query(`SELECT screen_interactive FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
    if (prev && prev.screen_interactive !== null && Number(prev.screen_interactive) !== (report.interactive ? 1 : 0)) {
      await db().query(`INSERT INTO tv_power_events(owner_id,room_id,at,kind,detail) VALUES($1,$2,$3,'SCREEN',$4::jsonb)`, [ownerId, roomId, now, JSON.stringify({ on: report.interactive, command: String(r.command), commandId: id })]);
    }
    await db().query(`UPDATE tv_screens SET screen_interactive=$3,screen_seen_at=$4 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, report.interactive ? 1 : 0, now]);
  }
  return next;
}

/** The newest command per room, after expiry, for the PMS screen. */
export async function latestCommands(ownerId: string): Promise<Record<number, CommandRow>> {
  await expire(ownerId, null, Date.now());
  const rows = (await db().query(`SELECT DISTINCT ON (room_id) * FROM tv_screen_commands WHERE owner_id=$1 ORDER BY room_id, id DESC`, [ownerId])).rows;
  return Object.fromEntries(rows.map((x) => [Number(x.room_id), toRow(x)]));
}

/** Corali TV app versions: sound commands (1.9) and the applied-policy report (1.10). */
export const SOUND_APP = 10;
export const POLICY_ACK_APP = 11;
const RESET_TTL_MS = 30 * 60_000;

export type ResetRoomResult = { roomId: number; roomCode: string; policySaved: boolean; commandIds: number[]; status: ResetStatus };

/**
 * v160 reset for the selected rooms (never all implicitly). Idempotent by key: a repeat returns the first request.
 * Saves the policy (desired state) and queues the sound steps; per room the status then follows the TV's reports.
 * Never touches the room token, Wi-Fi, power method, welcome screen, bookings or any factory / vendor setting.
 */
export async function runReset(ownerId: string, userId: number, action: ResetAction | "restore_sound", roomIds: number[], key: string, preset: unknown): Promise<{ requestId: number; repeated: boolean }> {
  const existing = (await db().query(`SELECT id FROM tv_reset_requests WHERE owner_id=$1 AND idempotency_key=$2`, [ownerId, key])).rows[0];
  if (existing) return { requestId: Number(existing.id), repeated: true };
  const now = Date.now();
  const screens = new Map((await db().query(`SELECT room_id,app_version FROM tv_screens WHERE owner_id=$1 AND active=1`, [ownerId])).rows.map((r) => [Number(r.room_id), r.app_version === null ? null : Number(r.app_version)]));
  const before = await soundPolicies(ownerId);
  const after: Record<number, unknown> = {}, commands: Record<number, number[]> = {};
  const ins = await db().query(
    `INSERT INTO tv_reset_requests(owner_id,idempotency_key,action,room_ids,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,idempotency_key) DO NOTHING RETURNING id`,
    [ownerId, key, action, JSON.stringify(roomIds), userId, now],
  );
  if (!ins.rowCount) return { requestId: Number((await db().query(`SELECT id FROM tv_reset_requests WHERE owner_id=$1 AND idempotency_key=$2`, [ownerId, key])).rows[0].id), repeated: true };
  for (const roomId of roomIds) {
    if (!screens.has(roomId)) continue;
    const plan = resetPlan(action, before[roomId] ?? null, preset);
    if (plan.policy) { await saveSoundPolicy(ownerId, [roomId], plan.policy, userId); after[roomId] = plan.policy; }
    const version = screens.get(roomId) ?? null;
    if (version === null || version < SOUND_APP) continue; // APP_TOO_OLD: the policy waits for the app update
    const ids: number[] = [];
    for (const [i, step] of plan.commands.entries()) {
      const c = await queueCommand(ownerId, roomId, step.command, "reset", userId, step.value, { supersede: i === 0, ttlMs: RESET_TTL_MS });
      if (c) ids.push(c.id);
    }
    commands[roomId] = ids;
  }
  await db().query(`UPDATE tv_reset_requests SET before_json=$2,after_json=$3,commands_json=$4 WHERE id=$1`, [ins.rows[0].id, JSON.stringify(Object.fromEntries(roomIds.map((r) => [r, before[r] ?? null]))), JSON.stringify(after), JSON.stringify(commands)]);
  return { requestId: Number(ins.rows[0].id), repeated: false };
}

/** Status of a reset request per room, from the TVs' own reports (commands + applied policy). */
export async function resetResults(ownerId: string, requestId: number): Promise<{ action: string; results: ResetRoomResult[] } | null> {
  const req = (await db().query(`SELECT * FROM tv_reset_requests WHERE owner_id=$1 AND id=$2`, [ownerId, requestId])).rows[0];
  if (!req) return null;
  const now = Date.now();
  await expire(ownerId, null, now);
  const roomIds = JSON.parse(String(req.room_ids)) as number[];
  const after = JSON.parse(String(req.after_json)) as Record<string, unknown>;
  const cmdIds = JSON.parse(String(req.commands_json)) as Record<string, number[]>;
  const all = Object.values(cmdIds).flat();
  const cmds = new Map(all.length ? (await db().query(`SELECT id,status FROM tv_screen_commands WHERE owner_id=$1 AND id = ANY($2::bigint[])`, [ownerId, all])).rows.map((r) => [Number(r.id), String(r.status)]) : []);
  const policies = await soundPolicies(ownerId);
  const screens = new Map((await db().query(`SELECT s.room_id,r.code,s.app_version,s.screen_seen_at,s.screen_interactive,s.policy_rev_applied FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1`, [ownerId])).rows.map((r) => [Number(r.room_id), r]));
  const results = roomIds.map((roomId): ResetRoomResult => {
    const s = screens.get(roomId);
    const ids = cmdIds[String(roomId)] ?? [];
    const online = s ? !["offline", "unknown"].includes(agentState(num(s.screen_seen_at), num(s.screen_interactive), now)) : false;
    return {
      roomId, roomCode: s ? String(s.code) : String(roomId), policySaved: String(roomId) in after, commandIds: ids,
      status: resetRoomStatus({ appVersion: s ? num(s.app_version) : null, online, commands: ids.map((id) => ({ status: cmds.get(id) ?? "PENDING" })), policyRev: String(roomId) in after ? policies[roomId]?.rev ?? null : null, appliedRev: s ? num(s.policy_rev_applied) : null, needsPolicyAck: String(roomId) in after }),
    };
  });
  return { action: String(req.action), results };
}
