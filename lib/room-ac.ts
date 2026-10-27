// Room air conditioners on Shelly relays (e.g. Shelly 1PM Gen4): power only while a guest is checked in, so an A/C
// left on in an empty room stops; staff can switch any room on or off from the PMS. Uses the Shelly Cloud account of
// PMS → Corali TV → TV power (server and auth key).
import { db } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { decryptField, encryptField } from "@/lib/security/encryption";
import { acOverride, deviceState, normalizePowerSettings, statusRequest, type PlugState } from "../scripts/tv-power-core.mjs";
import { runRoomAc } from "../scripts/room-ac-worker.mjs";

export type AcRoom = { roomId: number; code: string; roomType: string; guest: string | null; occupied: boolean; deviceId: string; channel: number; state: boolean | null; changedAt: number | null; error: string; overrideOn: boolean | null; overrideUntil: number | null; presenceDeviceId: string; presenceNow: boolean | null; presenceSeenAt: number | null; presenceCheckedAt: number | null };

async function cloud(ownerId: string) {
  const r = (await db().query(`SELECT settings_json,auth_key_encrypted FROM tv_power_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  let raw: unknown = null;
  try { raw = r ? JSON.parse(String(r.settings_json)) : null; } catch { raw = null; }
  const settings = normalizePowerSettings(raw);
  return { settings, ready: Boolean(settings.server && r?.auth_key_encrypted), key: () => decryptField(String(r.auth_key_encrypted), documentKey()) };
}

export type AcStatus = { enabled: boolean; cloudReady: boolean; presence: boolean; awayMinutes: number; tuyaReady: boolean; rooms: AcRoom[] };

export async function acRooms(ownerId: string): Promise<AcStatus> {
  const c = await cloud(ownerId);
  const tuya = (await db().query(`SELECT active FROM provider_connections WHERE owner_id=$1 AND provider_key='tuya'`, [ownerId])).rows[0];
  const r = await db().query(
    `SELECT r.id,r.code,r.room_type,a.device_id,a.channel,a.state,a.changed_at,a.error,a.override_on,a.override_until,a.presence_device_id,a.presence_now,a.presence_seen_at,a.presence_checked_at,
            (SELECT b.guest_name FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status='checked_in' ORDER BY b.check_in DESC LIMIT 1) AS guest
       FROM rooms r LEFT JOIN room_ac_devices a ON a.owner_id=r.owner_id AND a.room_id=r.id WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,
    [ownerId],
  );
  const now = Date.now();
  return {
    enabled: c.settings.acEnabled, cloudReady: c.ready, presence: c.settings.acPresence, awayMinutes: c.settings.acAwayMinutes, tuyaReady: Number(tuya?.active) === 1,
    rooms: r.rows.map((x) => ({
      roomId: Number(x.id), code: String(x.code), roomType: String(x.room_type), guest: x.guest ? String(x.guest) : null, occupied: Boolean(x.guest),
      deviceId: String(x.device_id ?? ""), channel: Number(x.channel ?? 0), state: x.state === null || x.state === undefined ? null : Number(x.state) === 1,
      changedAt: x.changed_at ? Number(x.changed_at) : null, error: String(x.error ?? ""),
      overrideOn: x.override_until && Number(x.override_until) > now ? Number(x.override_on) === 1 : null, overrideUntil: x.override_until && Number(x.override_until) > now ? Number(x.override_until) : null,
      presenceDeviceId: String(x.presence_device_id ?? ""), presenceNow: x.presence_now === null || x.presence_now === undefined ? null : Number(x.presence_now) === 1,
      presenceSeenAt: x.presence_seen_at ? Number(x.presence_seen_at) : null, presenceCheckedAt: x.presence_checked_at ? Number(x.presence_checked_at) : null,
    })),
  };
}

/** Link a room to its relay (empty id removes it); the room is brought to its target at once. */
export async function setAcDevice(ownerId: string, roomId: number, deviceId: string, channel: number, presenceDeviceId: string): Promise<void> {
  if (!deviceId) { await db().query(`DELETE FROM room_ac_devices WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId]); return; }
  await db().query(
    `INSERT INTO room_ac_devices(owner_id,room_id,device_id,channel,presence_device_id,updated_at) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(owner_id,room_id) DO UPDATE SET device_id=$3,channel=$4,presence_device_id=$5,state=NULL,error='',
       presence_now=CASE WHEN room_ac_devices.presence_device_id=$5 THEN room_ac_devices.presence_now END,
       presence_checked_at=CASE WHEN room_ac_devices.presence_device_id=$5 THEN room_ac_devices.presence_checked_at END,updated_at=$6`,
    [ownerId, roomId, deviceId, channel, presenceDeviceId, Date.now()],
  );
  await syncAc(ownerId, [roomId]);
}

/** Staff switch from the PMS: holds while the occupancy is unchanged (3 hours for an empty room). */
export async function switchAc(ownerId: string, userId: number, roomId: number, on: boolean): Promise<string> {
  const occ = (await db().query(`SELECT EXISTS (SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status='checked_in') AS o`, [ownerId, roomId])).rows[0].o === true;
  const o = acOverride(on, occ, Date.now());
  const r = await db().query(`UPDATE room_ac_devices SET override_on=$3,override_occupied=$4,override_until=$5,override_by=$6 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, o.on ? 1 : 0, o.occupied ? 1 : 0, o.until, String(userId)]);
  if (!r.rowCount) return "NO_DEVICE";
  const res = await syncAc(ownerId, [roomId], true);
  if (!res) return "NOT_CONFIGURED";
  const row = (await db().query(`SELECT error FROM room_ac_devices WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  return String(row?.error ?? "");
}

/** Back to automatic (guest checked in = on, else off). */
export async function autoAc(ownerId: string, roomId: number): Promise<void> {
  await db().query(`UPDATE room_ac_devices SET override_on=NULL,override_occupied=NULL,override_until=NULL,override_by=NULL WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId]);
  await syncAc(ownerId, [roomId]);
}

/** Apply the rule now for some rooms (after check-in / check-out); quiet when A/C control is off or not set up. */
export async function syncAc(ownerId: string, roomIds: number[] | null, force = false) {
  const key = documentKey();
  return runRoomAc({ pool: db(), owner: ownerId, unseal: (v) => decryptField(v, key), seal: (v) => encryptField(v, key), roomIds, force });
}

/** Live state of the relays (online, on, watts), 10 devices per cloud request. */
export async function acLiveStates(ownerId: string): Promise<Record<number, PlugState>> {
  const c = await cloud(ownerId);
  if (!c.ready) return {};
  const rows = (await db().query(`SELECT room_id,device_id,channel FROM room_ac_devices WHERE owner_id=$1`, [ownerId])).rows;
  const out: Record<number, PlugState> = {}, key = c.key();
  for (let i = 0; i < rows.length; i += 10) {
    const part = rows.slice(i, i + 10);
    try {
      const req = statusRequest(c.settings.server, key, part.map((r) => String(r.device_id)));
      const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body, signal: AbortSignal.timeout(15_000) });
      const body = res.ok ? await res.json().catch(() => null) : null;
      const list: unknown[] = Array.isArray(body) ? body : Array.isArray(body?.devices) ? body.devices : body && typeof body === "object" ? Object.values(body) : [];
      for (const r of part) out[Number(r.room_id)] = deviceState(list.find((x) => x && typeof x === "object" && String((x as { id?: unknown }).id) === String(r.device_id)), Number(r.channel));
    } catch {
      for (const r of part) out[Number(r.room_id)] = { online: false, on: null, power: null };
    }
    if (i + 10 < rows.length) await new Promise((ok) => setTimeout(ok, 1100));
  }
  return out;
}

export async function setAcEnabled(ownerId: string, userId: number, x: { enabled: boolean; presence: boolean; awayMinutes: number }): Promise<void> {
  const r = (await db().query(`SELECT settings_json FROM tv_power_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  let raw: Record<string, unknown> = {};
  try { raw = r ? JSON.parse(String(r.settings_json)) : {}; } catch { raw = {}; }
  const settings = normalizePowerSettings({ ...raw, acEnabled: x.enabled, acPresence: x.presence, acAwayMinutes: x.awayMinutes });
  await db().query(
    `INSERT INTO tv_power_settings(owner_id,settings_json,auth_key_encrypted,updated_by,updated_at) VALUES($1,$2,'',$3,$4)
     ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_by=$3,updated_at=$4`,
    [ownerId, JSON.stringify(settings), userId, Date.now()],
  );
  if (x.enabled) await syncAc(ownerId, null);
}
