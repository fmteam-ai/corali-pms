// Corali TV screen commands (v158): PMS → Corali TV app (≥ 1.8) with delivery and execution reports.
// See scripts/tv-command-core.mjs for the rules (statuses, expiry, what counts as EXECUTED).
import { db } from "@/lib/db";
import { hotelToday } from "@/lib/tape-chart";
import { hotelTime } from "@/lib/tv";
import { loadPowerSettings, POWER_METHOD_SQL } from "@/lib/tv-power";
import { autoCommand, COMMAND_TTL_MS, expiredStatus, reportStatus, type ScreenCommand } from "../scripts/tv-command-core.mjs";
import { desiredPower } from "../scripts/tv-power-core.mjs";

export type CommandRow = { id: number; room_id: number; command: string; source: string; status: string; error: string; created_at: number; delivered_at: number | null; finished_at: number | null };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toRow = (x: Record<string, unknown>): CommandRow => ({ id: Number(x.id), room_id: Number(x.room_id), command: String(x.command), source: String(x.source), status: String(x.status), error: String(x.error ?? ""), created_at: Number(x.created_at), delivered_at: num(x.delivered_at), finished_at: num(x.finished_at) });

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
export async function queueCommand(ownerId: string, roomId: number, command: ScreenCommand, source: "manual" | "auto", userId: number | null): Promise<CommandRow | null> {
  const now = Date.now();
  const room = (await db().query(`SELECT 1 FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  if (!room) return null;
  await db().query(`UPDATE tv_screen_commands SET status='CANCELLED',error='SUPERSEDED',finished_at=$3 WHERE owner_id=$1 AND room_id=$2 AND status='PENDING'`, [ownerId, roomId, now]);
  const r = await db().query(
    `INSERT INTO tv_screen_commands(owner_id,room_id,command,source,status,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,'PENDING',$5,$6,$7) RETURNING *`,
    [ownerId, roomId, command, source, userId, now, now + COMMAND_TTL_MS],
  );
  return toRow(r.rows[0]);
}

/**
 * The app's check (every ~20 s): records what it measured (screen on/off, version, screen-off permission), applies the
 * automatic arrival / check-out rule for «android_agent» rooms, and hands over the newest waiting command (once).
 */
export async function agentCheck(ownerId: string, roomId: number, report: { interactive: boolean | null; version: number | null; admin: boolean | null }): Promise<{ id: number; command: string } | null> {
  const now = Date.now();
  const row = (await db().query(
    `UPDATE tv_screens SET screen_seen_at=$3,screen_interactive=$4,app_version=COALESCE($5,app_version),app_admin=COALESCE($6,app_admin)
      WHERE owner_id=$1 AND room_id=$2 RETURNING ${POWER_METHOD_SQL} AS method,screen_auto_state`,
    [ownerId, roomId, now, report.interactive === null ? null : report.interactive ? 1 : 0, report.version, report.admin === null ? null : report.admin ? 1 : 0],
  )).rows[0];
  // Only apps that report their state (≥ 1.8) take commands; older apps keep working without remote on / off.
  if (!row || row.method !== "android_agent" || report.version === null) return null;
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
  const next = (await db().query(
    `UPDATE tv_screen_commands SET status='DELIVERED',delivered_at=$3 WHERE id=(SELECT id FROM tv_screen_commands WHERE owner_id=$1 AND room_id=$2 AND status='PENDING' ORDER BY id DESC LIMIT 1) AND status='PENDING' RETURNING id,command`,
    [ownerId, roomId, now],
  )).rows[0];
  return next ? { id: Number(next.id), command: String(next.command) } : null;
}

/** The app's report for a delivered command; applied once. */
export async function agentReport(ownerId: string, roomId: number, id: number, report: { status?: string; interactive?: boolean; error?: string }): Promise<string | null> {
  const r = (await db().query(`SELECT id,command,status FROM tv_screen_commands WHERE id=$1 AND owner_id=$2 AND room_id=$3`, [id, ownerId, roomId])).rows[0];
  if (!r) return null;
  const next = reportStatus({ status: String(r.status), command: String(r.command) }, report);
  if (!next) return String(r.status);
  const error = next === "EXECUTED" ? "" : String(report.error ?? (next === "UNVERIFIED" ? "NO_STATE" : "SCREEN_DID_NOT_CHANGE")).replace(/[^A-Za-z0-9_ .:-]/g, "").slice(0, 120);
  const now = Date.now();
  await db().query(`UPDATE tv_screen_commands SET status=$2,error=$3,finished_at=$4 WHERE id=$1 AND status='DELIVERED'`, [id, next, error, now]);
  if (typeof report.interactive === "boolean") await db().query(`UPDATE tv_screens SET screen_interactive=$3,screen_seen_at=$4 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, report.interactive ? 1 : 0, now]);
  return next;
}

/** The newest command per room, after expiry, for the PMS screen. */
export async function latestCommands(ownerId: string): Promise<Record<number, CommandRow>> {
  await expire(ownerId, null, Date.now());
  const rows = (await db().query(`SELECT DISTINCT ON (room_id) * FROM tv_screen_commands WHERE owner_id=$1 ORDER BY room_id, id DESC`, [ownerId])).rows;
  return Object.fromEntries(rows.map((x) => [Number(x.room_id), toRow(x)]));
}
