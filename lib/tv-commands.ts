// Corali TV screen commands (v158): PMS → Corali TV app (≥ 1.8) with delivery and execution reports.
// See scripts/tv-command-core.mjs for the rules (statuses, expiry, what counts as EXECUTED).
import { db } from "@/lib/db";
import { hotelToday } from "@/lib/tape-chart";
import { hotelTime } from "@/lib/tv";
import { loadPowerSettings, POWER_METHOD_SQL } from "@/lib/tv-power";
import { autoCommand, COMMAND_TTL_MS, expiredStatus, normalizeSoundPolicy, parseCapabilities, reportStatus, type SoundPolicy, type TvCommand } from "../scripts/tv-command-core.mjs";
import { desiredPower } from "../scripts/tv-power-core.mjs";

export type CommandRow = { id: number; room_id: number; command: string; source: string; status: string; error: string; created_at: number; delivered_at: number | null; finished_at: number | null; value: number | null; cap: number | null; result_volume: number | null; result_muted: number | null };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toRow = (x: Record<string, unknown>): CommandRow => ({ id: Number(x.id), room_id: Number(x.room_id), command: String(x.command), source: String(x.source), status: String(x.status), error: String(x.error ?? ""), created_at: Number(x.created_at), delivered_at: num(x.delivered_at), finished_at: num(x.finished_at), value: num(x.value), cap: num(x.cap), result_volume: num(x.result_volume), result_muted: num(x.result_muted) });

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
export async function queueCommand(ownerId: string, roomId: number, command: TvCommand, source: "manual" | "auto", userId: number | null, value: number | null = null): Promise<CommandRow | null> {
  const now = Date.now();
  const room = (await db().query(`SELECT 1 FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  if (!room) return null;
  // Only one command waits per room: a newer one replaces it (a quick double press never runs twice).
  await db().query(`UPDATE tv_screen_commands SET status='CANCELLED',error='SUPERSEDED',finished_at=$3 WHERE owner_id=$1 AND room_id=$2 AND status='PENDING'`, [ownerId, roomId, now]);
  const policy = (await soundPolicies(ownerId))[roomId];
  const cap = policy?.enforceMax ? policy.maxVolume : null;
  const r = await db().query(
    `INSERT INTO tv_screen_commands(owner_id,room_id,command,source,status,created_by,created_at,expires_at,value,cap) VALUES($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9) RETURNING *`,
    [ownerId, roomId, command, source, userId, now, now + COMMAND_TTL_MS, value, cap],
  );
  return toRow(r.rows[0]);
}

/**
 * The app's check (every ~20 s): records what it measured (screen on/off, version, screen-off permission), applies the
 * automatic arrival / check-out rule for «android_agent» rooms, and hands over the newest waiting command (once).
 */
export type AgentReport = { interactive: boolean | null; version: number | null; admin: boolean | null; volume?: number | null; muted?: boolean | null; fixed?: boolean | null; caps?: Record<string, unknown> | null; clamped?: boolean };
export type AgentAnswer = { command: { id: number; command: string; value: number | null; cap: number | null } | null; policy: (SoundPolicy & { rev: number }) | null };

export async function agentCheck(ownerId: string, roomId: number, report: AgentReport): Promise<AgentAnswer> {
  const now = Date.now();
  const b = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);
  const row = (await db().query(
    `UPDATE tv_screens SET screen_seen_at=$3,screen_interactive=$4,app_version=COALESCE($5,app_version),app_admin=COALESCE($6,app_admin),
       volume_percent=COALESCE($7,volume_percent),volume_muted=COALESCE($8,volume_muted),volume_fixed=COALESCE($9,volume_fixed),
       caps_json=COALESCE($10,caps_json),policy_clamped_at=CASE WHEN $11::boolean THEN $3 ELSE policy_clamped_at END
      WHERE owner_id=$1 AND room_id=$2 RETURNING ${POWER_METHOD_SQL} AS method,screen_auto_state`,
    [ownerId, roomId, now, b(report.interactive), report.version, b(report.admin), report.volume ?? null, b(report.muted), b(report.fixed), report.caps ? JSON.stringify(parseCapabilities(report.caps)) : null, report.clamped === true],
  )).rows[0];
  // Sound policy for apps that apply it (≥ 1.9), whatever the power method.
  const policy = row && report.version !== null && report.version >= 10 ? (await soundPolicies(ownerId))[roomId] ?? null : null;
  // Only apps that report their state (≥ 1.8) take commands; older apps keep working without remote control.
  if (!row || report.version === null) return { command: null, policy };
  if (row.method !== "android_agent") {
    // Sound commands work in any room with an app ≥ 1.9; screen on / off only with the «android_agent» method.
    await expire(ownerId, roomId, now);
    return { command: await deliver(ownerId, roomId, now, true), policy };
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
  return { command: await deliver(ownerId, roomId, now, false), policy };
}

/** Hand over the newest waiting command once (atomic). soundOnly: rooms not run by the app keep screen commands back. */
async function deliver(ownerId: string, roomId: number, now: number, soundOnly: boolean) {
  const next = (await db().query(
    `UPDATE tv_screen_commands SET status='DELIVERED',delivered_at=$3 WHERE id=(SELECT id FROM tv_screen_commands WHERE owner_id=$1 AND room_id=$2 AND status='PENDING' ${soundOnly ? "AND command NOT IN ('SCREEN_ON','SCREEN_OFF')" : ""} ORDER BY id DESC LIMIT 1) AND status='PENDING' RETURNING id,command,value,cap`,
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
export async function agentReport(ownerId: string, roomId: number, id: number, report: { status?: string; interactive?: boolean; error?: string; volume?: number; muted?: boolean; fixed?: boolean }): Promise<string | null> {
  const r = (await db().query(`SELECT id,command,status,value,cap FROM tv_screen_commands WHERE id=$1 AND owner_id=$2 AND room_id=$3`, [id, ownerId, roomId])).rows[0];
  if (!r) return null;
  const next = reportStatus({ status: String(r.status), command: String(r.command), value: num(r.value), cap: num(r.cap) }, report);
  if (!next) return String(r.status);
  const error = next === "EXECUTED" ? "" : String(report.error ?? (next === "UNVERIFIED" ? "NO_STATE" : "STATE_DID_NOT_CHANGE")).replace(/[^A-Za-z0-9_ .:-]/g, "").slice(0, 120);
  const now = Date.now();
  const error2 = next === "FAILED" && report.fixed === true && !report.error ? "FIXED_VOLUME" : error;
  await db().query(`UPDATE tv_screen_commands SET status=$2,error=$3,finished_at=$4,result_volume=$5,result_muted=$6 WHERE id=$1 AND status='DELIVERED'`, [id, next, error2, now, Number.isInteger(report.volume) ? report.volume : null, typeof report.muted === "boolean" ? (report.muted ? 1 : 0) : null]);
  if (Number.isInteger(report.volume) || typeof report.muted === "boolean") {
    await db().query(`UPDATE tv_screens SET volume_percent=COALESCE($3,volume_percent),volume_muted=COALESCE($4,volume_muted) WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, Number.isInteger(report.volume) ? report.volume : null, typeof report.muted === "boolean" ? (report.muted ? 1 : 0) : null]);
  }
  if (typeof report.interactive === "boolean") await db().query(`UPDATE tv_screens SET screen_interactive=$3,screen_seen_at=$4 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, report.interactive ? 1 : 0, now]);
  return next;
}

/** The newest command per room, after expiry, for the PMS screen. */
export async function latestCommands(ownerId: string): Promise<Record<number, CommandRow>> {
  await expire(ownerId, null, Date.now());
  const rows = (await db().query(`SELECT DISTINCT ON (room_id) * FROM tv_screen_commands WHERE owner_id=$1 ORDER BY room_id, id DESC`, [ownerId])).rows;
  return Object.fromEntries(rows.map((x) => [Number(x.room_id), toRow(x)]));
}
