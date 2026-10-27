// Room air conditioners on Shelly relays: power only while a guest is checked in — and, with a presence sensor (Tuya
// mmWave), only while someone is in the room — or as staff set it by hand in the PMS. Used by the cron jobs
// (run-tv-power every 5 minutes; run-message-automations every minute when presence sensors are on) and by the PMS
// right after check-in / check-out.
import { acTarget, normalizePowerSettings, switchError, switchRequest } from "./tv-power-core.mjs";
import { TUYA_HOSTS, tuyaPresence, tuyaToken } from "./tuya-core.mjs";

const parse = (v) => { try { return JSON.parse(String(v)); } catch { return null; } };

/** Tuya Cloud credentials from PMS → Integrations (null when not set up or switched off). */
async function tuyaCreds(pool, owner, unseal) {
  const r = (await pool.query(`SELECT active,settings_json,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='tuya'`, [owner])).rows[0];
  if (!r || !Number(r.active)) return null;
  const settings = parse(r.settings_json) ?? {}, secrets = parse(unseal(String(r.secrets_encrypted))) ?? {};
  if (!secrets.accessId || !secrets.accessSecret) return null;
  return { host: TUYA_HOSTS[settings.dataCenter] ?? TUYA_HOSTS.eu, accessId: String(secrets.accessId), secret: String(secrets.accessSecret) };
}

async function cachedToken(pool, owner, tuya, seal, unseal) {
  const row = (await pool.query(`SELECT token_encrypted,expires_at FROM provider_tokens WHERE owner_id=$1 AND provider_key='tuya'`, [owner])).rows[0];
  if (row && Number(row.expires_at) > Date.now()) { try { return unseal(String(row.token_encrypted)); } catch { /* new token below */ } }
  const t = await tuyaToken(fetch, tuya.host, tuya);
  if (seal) await pool.query(`INSERT INTO provider_tokens(owner_id,provider_key,token_encrypted,expires_at) VALUES($1,'tuya',$2,$3) ON CONFLICT(owner_id,provider_key) DO UPDATE SET token_encrypted=$2,expires_at=$3`, [owner, seal(t.token), t.expiresAt]);
  return t.token;
}

/** Bring each room's A/C relay to its target. roomIds limits the rooms; force switches even if the state looks right. */
export async function syncRoomAc({ pool, owner, server, key, settings = normalizePowerSettings({ acEnabled: true }), tuya = null, seal = null, unseal = null, roomIds = null, force = false, now = Date.now() }) {
  const rows = (await pool.query(
    `SELECT a.room_id,a.device_id,a.channel,a.state,a.override_on,a.override_occupied,a.override_until,a.presence_device_id,a.presence_seen_at,a.presence_checked_at,a.occupied AS was_occupied,
            EXISTS (SELECT 1 FROM bookings b WHERE b.owner_id=a.owner_id AND b.room_id=a.room_id AND b.status='checked_in') AS occupied
       FROM room_ac_devices a WHERE a.owner_id=$1 AND ($2::bigint[] IS NULL OR a.room_id=ANY($2::bigint[])) ORDER BY a.room_id`,
    [owner, roomIds],
  )).rows;
  // Presence: read the sensors of occupied rooms (empty rooms are off anyway). A new guest starts as "present".
  const presence = {};
  if (settings.acPresence && tuya) {
    const ids = rows.filter((r) => r.occupied && r.presence_device_id).map((r) => String(r.presence_device_id));
    if (ids.length) {
      try {
        const token = await cachedToken(pool, owner, tuya, seal, unseal);
        Object.assign(presence, await tuyaPresence(fetch, tuya.host, tuya, token, ids));
      } catch (e) {
        console.error("Presence sensors (Tuya) failed:", e instanceof Error ? e.message : e);
        if (seal) await pool.query(`DELETE FROM provider_tokens WHERE owner_id=$1 AND provider_key='tuya'`, [owner]);
      }
    }
  }
  let switched = 0, failed = 0;
  for (const r of rows) {
    const occupied = Boolean(r.occupied);
    let seenAt = r.presence_seen_at ? Number(r.presence_seen_at) : 0, checkedAt = r.presence_checked_at ? Number(r.presence_checked_at) : 0;
    if (occupied && Number(r.was_occupied) !== 1) seenAt = now; // just checked in
    const reading = r.presence_device_id ? presence[String(r.presence_device_id)] : undefined;
    if (reading !== undefined && reading !== null) { checkedAt = now; if (reading) seenAt = now; }
    await pool.query(`UPDATE room_ac_devices SET occupied=$3,presence_seen_at=$4,presence_checked_at=$5,presence_now=CASE WHEN $6::int IS NULL THEN presence_now ELSE $6::int END WHERE owner_id=$1 AND room_id=$2`,
      [owner, r.room_id, occupied ? 1 : 0, seenAt || null, checkedAt || null, reading === undefined || reading === null ? null : reading ? 1 : 0]);
    const override = r.override_until ? { on: Number(r.override_on) === 1, occupied: Number(r.override_occupied) === 1, until: Number(r.override_until) } : null;
    const usePresence = settings.acPresence && tuya && r.presence_device_id ? { seenAt, checkedAt, awayMs: settings.acAwayMinutes * 60_000 } : null;
    const target = acTarget(occupied, override, now, usePresence);
    if (override && !(override.until > now && override.occupied === occupied)) await pool.query(`UPDATE room_ac_devices SET override_on=NULL,override_occupied=NULL,override_until=NULL,override_by=NULL WHERE owner_id=$1 AND room_id=$2`, [owner, r.room_id]);
    if (!force && r.state !== null && Number(r.state) === (target ? 1 : 0)) continue;
    let error = "";
    try {
      const req = switchRequest(server, key, String(r.device_id), Number(r.channel), target);
      const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body, signal: AbortSignal.timeout(15_000) });
      error = switchError(res.status, await res.json().catch(() => null), String(r.device_id));
    } catch {
      error = "SHELLY_UNREACHABLE";
    }
    // On failure the stored state stays as it was, so the next run tries again.
    await pool.query(
      `UPDATE room_ac_devices SET error=$1,state=CASE WHEN $1='' THEN $2 ELSE state END,changed_at=CASE WHEN $1='' THEN $3::bigint ELSE changed_at END WHERE owner_id=$4 AND room_id=$5`,
      [error, target ? 1 : 0, now, owner, r.room_id],
    );
    if (error) { failed++; console.error(`A/C power: room ${r.room_id} → ${target ? "on" : "off"} failed: ${error}`); } else switched++;
    await new Promise((ok) => setTimeout(ok, 1100)); // Shelly Cloud: about 1 request per second
  }
  return { rooms: rows.length, switched, failed };
}

/**
 * Cron entry: loads the Shelly and Tuya settings and syncs every room. presenceOnly (the every-minute job) runs only
 * when presence sensors are on, so a guest coming back has power within a minute.
 */
export async function runRoomAc({ pool, owner, unseal, seal = null, presenceOnly = false, roomIds = null, force = false }) {
  const s = (await pool.query(`SELECT settings_json,auth_key_encrypted FROM tv_power_settings WHERE owner_id=$1`, [owner])).rows[0];
  const settings = normalizePowerSettings(s ? parse(s.settings_json) : null);
  if (!settings.acEnabled || !settings.server || !s?.auth_key_encrypted) return null;
  if (presenceOnly && !settings.acPresence) return null;
  const tuya = settings.acPresence ? await tuyaCreds(pool, owner, unseal) : null;
  return syncRoomAc({ pool, owner, server: settings.server, key: unseal(String(s.auth_key_encrypted)), settings, tuya, seal, unseal, roomIds, force });
}
