// Corali TV power: Shelly Cloud smart plugs switch each room's TV on for the guest's stay and off after check-out.
// The TV itself must turn on when power returns (its "power on mode"); the Corali TV app then opens by itself.
import { db } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { decryptField, encryptField } from "@/lib/security/encryption";
import { hotelToday } from "@/lib/tape-chart";
import { hotelTime } from "@/lib/tv";
import { desiredPower, deviceState, normalizePowerSettings, statusRequest, switchError, switchRequest, type PowerSettings } from "../scripts/tv-power-core.mjs";

export type { PowerSettings };
export type RoomPowerState = { roomId: number; online: boolean; on: boolean | null };

export async function loadPowerSettings(ownerId: string): Promise<{ settings: PowerSettings; hasKey: boolean }> {
  const r = (await db().query(`SELECT settings_json,auth_key_encrypted FROM tv_power_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  let raw: unknown = null;
  try { raw = r ? JSON.parse(String(r.settings_json)) : null; } catch { raw = null; }
  return { settings: normalizePowerSettings(raw), hasKey: Boolean(r?.auth_key_encrypted) };
}

/** Save settings; an empty key keeps the stored one. */
export async function savePowerSettings(ownerId: string, userId: number, raw: unknown, authKey: string) {
  const settings = normalizePowerSettings(raw);
  const sealed = authKey ? encryptField(authKey, documentKey()) : null;
  await db().query(
    `INSERT INTO tv_power_settings(owner_id,settings_json,auth_key_encrypted,updated_by,updated_at) VALUES($1,$2,COALESCE($3,''),$4,$5)
     ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,auth_key_encrypted=COALESCE($3,tv_power_settings.auth_key_encrypted),updated_by=$4,updated_at=$5`,
    [ownerId, JSON.stringify(settings), sealed, userId, Date.now()],
  );
  return loadPowerSettings(ownerId);
}

async function cloud(ownerId: string) {
  const r = (await db().query(`SELECT settings_json,auth_key_encrypted FROM tv_power_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  if (!r?.auth_key_encrypted) return null;
  let raw: unknown = null;
  try { raw = JSON.parse(String(r.settings_json)); } catch { raw = null; }
  const settings = normalizePowerSettings(raw);
  if (!settings.server) return null;
  return { settings, key: decryptField(String(r.auth_key_encrypted), documentKey()) };
}

/** Switch one room's plug. Records the result on the screen row; returns the error code or "". */
export async function setRoomPower(ownerId: string, roomId: number, on: boolean, auto?: boolean): Promise<string> {
  const row = (await db().query(`SELECT power_device_id,power_channel FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  if (!row?.power_device_id) return "NO_DEVICE";
  const c = await cloud(ownerId);
  if (!c) return "NOT_CONFIGURED";
  let error = "";
  try {
    const req = switchRequest(c.settings.server, c.key, String(row.power_device_id), Number(row.power_channel), on);
    const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body, signal: AbortSignal.timeout(15_000) });
    error = switchError(res.status, await res.json().catch(() => null), String(row.power_device_id));
  } catch {
    error = "SHELLY_UNREACHABLE";
  }
  await db().query(
    `UPDATE tv_screens SET power_state=CASE WHEN $1='' THEN $2 ELSE power_state END,power_changed_at=CASE WHEN $1='' THEN $3 ELSE power_changed_at END,
       power_error=$1,power_auto_state=CASE WHEN $4::boolean AND $1='' THEN $2 ELSE power_auto_state END WHERE owner_id=$5 AND room_id=$6`,
    [error, on ? 1 : 0, Date.now(), auto === true, ownerId, roomId],
  );
  return error;
}

/**
 * Apply the automatic rule for one room (after check-in/check-out in PMS, and from the run-tv-power worker): act only
 * when the decision changed since the last automatic switch, so a manual change from PMS is respected.
 */
export async function syncRoomPower(ownerId: string, roomId: number): Promise<void> {
  const { settings } = await loadPowerSettings(ownerId);
  if (!settings.enabled) return;
  const row = (await db().query(`SELECT power_device_id,power_auto_state FROM tv_screens WHERE owner_id=$1 AND room_id=$2 AND active=1`, [ownerId, roomId])).rows[0];
  if (!row?.power_device_id) return;
  const today = hotelToday();
  const stays = (await db().query(`SELECT status,check_in,check_out FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status IN ('confirmed','checked_in') AND check_in<=$3 AND check_out>=$3`, [ownerId, roomId, today])).rows;
  const want = desiredPower(stays.map((s) => ({ status: String(s.status), check_in: String(s.check_in), check_out: String(s.check_out) })), today, hotelTime(), settings.onTime);
  if (row.power_auto_state !== null && Number(row.power_auto_state) === (want ? 1 : 0)) return;
  if (want ? settings.autoOn : settings.autoOff) await setRoomPower(ownerId, roomId, want, true);
  else await db().query(`UPDATE tv_screens SET power_auto_state=$1 WHERE owner_id=$2 AND room_id=$3`, [want ? 1 : 0, ownerId, roomId]);
}

/** Live state (online, output) of every room plug, 10 devices per cloud request. */
export async function roomPowerStates(ownerId: string): Promise<RoomPowerState[]> {
  const c = await cloud(ownerId);
  if (!c) return [];
  const rows = (await db().query(`SELECT room_id,power_device_id,power_channel FROM tv_screens WHERE owner_id=$1 AND power_device_id<>''`, [ownerId])).rows;
  const out: RoomPowerState[] = [];
  for (let i = 0; i < rows.length; i += 10) {
    const part = rows.slice(i, i + 10);
    try {
      const req = statusRequest(c.settings.server, c.key, part.map((r) => String(r.power_device_id)));
      const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body, signal: AbortSignal.timeout(15_000) });
      const body = res.ok ? await res.json().catch(() => null) : null;
      const list: unknown[] = Array.isArray(body) ? body : Array.isArray(body?.devices) ? body.devices : body && typeof body === "object" ? Object.values(body) : [];
      for (const r of part) {
        const d = list.find((x) => x && typeof x === "object" && String((x as { id?: unknown }).id) === String(r.power_device_id));
        out.push({ roomId: Number(r.room_id), ...deviceState(d, Number(r.power_channel)) });
      }
    } catch {
      for (const r of part) out.push({ roomId: Number(r.room_id), online: false, on: null });
    }
    if (i + 10 < rows.length) await new Promise((ok) => setTimeout(ok, 1100));
  }
  return out;
}
