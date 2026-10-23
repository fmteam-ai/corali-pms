// Corali TV power worker (PMS instance only, cPanel cron every 5 minutes). For each room with a Shelly plug, applies the
// automatic rule (on from the switch-on time of the arrival day while a stay is confirmed / checked in, off after
// check-out) when that decision changed since the last automatic switch.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { desiredPower, normalizePowerSettings, switchError, switchRequest } from "./tv-power-core.mjs";

if (!process.env.DATABASE_URL || !process.env.PMS_DOCUMENT_KEY) throw Error("TV power requires DATABASE_URL and PMS_DOCUMENT_KEY");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
const athens = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", ...opts }).format(new Date());
const today = athens({ year: "numeric", month: "2-digit", day: "2-digit" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

function unseal(value) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw Error("INVALID_CIPHERTEXT");
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(process.env.PMS_DOCUMENT_KEY).digest(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

try {
  const s = (await pool.query(`SELECT settings_json,auth_key_encrypted FROM tv_power_settings WHERE owner_id=$1`, [owner])).rows[0];
  let raw = null;
  try { raw = s ? JSON.parse(s.settings_json) : null; } catch { raw = null; }
  const settings = normalizePowerSettings(raw);
  if (!settings.enabled || !settings.server || !s?.auth_key_encrypted) {
    console.log("TV power: automation off or Shelly not configured");
  } else {
    const key = unseal(s.auth_key_encrypted);
    const rooms = (await pool.query(`SELECT room_id,power_device_id,power_channel,power_auto_state FROM tv_screens WHERE owner_id=$1 AND active=1 AND power_device_id<>'' ORDER BY room_id`, [owner])).rows;
    let switched = 0;
    for (const r of rooms) {
      const stays = (await pool.query(`SELECT status,check_in,check_out FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status IN ('confirmed','checked_in') AND check_in<=$3 AND check_out>=$3`, [owner, r.room_id, today])).rows;
      const want = desiredPower(stays, today, time, settings.onTime);
      if (r.power_auto_state !== null && Number(r.power_auto_state) === (want ? 1 : 0)) continue;
      if (!(want ? settings.autoOn : settings.autoOff)) {
        await pool.query(`UPDATE tv_screens SET power_auto_state=$1 WHERE owner_id=$2 AND room_id=$3`, [want ? 1 : 0, owner, r.room_id]);
        continue;
      }
      let error = "";
      try {
        const req = switchRequest(settings.server, key, r.power_device_id, Number(r.power_channel), want);
        const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body, signal: AbortSignal.timeout(15000) });
        error = switchError(res.status, await res.json().catch(() => null), r.power_device_id);
      } catch {
        error = "SHELLY_UNREACHABLE";
      }
      // On failure power_auto_state stays as it was, so the next run tries again.
      await pool.query(
        `UPDATE tv_screens SET power_error=$1,power_state=CASE WHEN $1='' THEN $2 ELSE power_state END,power_changed_at=CASE WHEN $1='' THEN $3 ELSE power_changed_at END,
           power_auto_state=CASE WHEN $1='' THEN $2 ELSE power_auto_state END WHERE owner_id=$4 AND room_id=$5`,
        [error, want ? 1 : 0, Date.now(), owner, r.room_id],
      );
      if (!error) switched++;
      else console.error(`TV power: room ${r.room_id} → ${want ? "on" : "off"} failed: ${error}`);
      await new Promise((ok) => setTimeout(ok, 1100)); // Shelly Cloud: about 1 request per second
    }
    console.log(`TV power: ${rooms.length} rooms checked, ${switched} switched`);
  }
} finally {
  await pool.end();
}
