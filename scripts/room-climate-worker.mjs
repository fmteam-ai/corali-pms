// Room temperature / humidity sensors (Tuya Wi-Fi) in the automation cron: read every ~10 minutes, keep the latest
// values for the PMS and the TV assistant, and raise the three alerts (PMS notification; an A/C fault also opens a
// maintenance notice for the room).
import { climateFromStatus, evaluateClimate } from "./room-climate-core.mjs";
import { normalizePowerSettings } from "./tv-power-core.mjs";
import { cachedToken, tuyaCreds } from "./room-ac-worker.mjs";
import { tuyaStatus } from "./tuya-core.mjs";

const parse = (v) => { try { return JSON.parse(String(v)); } catch { return null; } };
const READ_EVERY_MS = 10 * 60_000;

const texts = {
  humid: (room, r, s) => [`💧 Υγρασία ${r.humidity}% στο δωμάτιο ${room} για πάνω από ${s.humidityHours} ώρες — αερισμός / αφυγραντήρας`, `💧 Humidity ${r.humidity}% in room ${room} for over ${s.humidityHours} hours — air the room / dehumidifier`],
  hot: (room, r) => [`🌡️ Δωμάτιο ${room}: ${r.temp}° με πελάτη και κλιματιστικό σε λειτουργία — πιθανή βλάβη A/C`, `🌡️ Room ${room}: ${r.temp}° with a guest in and the A/C powered — possible A/C fault`],
  cold: (room, r) => [`🥶 Δωμάτιο ${room}: ${r.temp}° με πελάτη και κλιματιστικό σε λειτουργία — πιθανή βλάβη θέρμανσης`, `🥶 Room ${room}: ${r.temp}° with a guest in and the A/C powered — possible heating fault`],
  battery: (room, r) => [`🔋 Αισθητήρας θερμοκρασίας δωματίου ${room}: μπαταρία ${r.battery}% — αλλαγή μπαταρίας`, `🔋 Temperature sensor in room ${room}: battery ${r.battery}% — replace the battery`],
};

export async function runRoomClimate({ pool, owner, unseal, seal = null, force = false, now = Date.now() }) {
  const rows = (await pool.query(
    `SELECT c.*,r.code,
            (SELECT b.checked_in_at FROM bookings b WHERE b.owner_id=c.owner_id AND b.room_id=c.room_id AND b.status='checked_in' ORDER BY b.check_in DESC LIMIT 1) AS checked_in_at,
            EXISTS (SELECT 1 FROM bookings b WHERE b.owner_id=c.owner_id AND b.room_id=c.room_id AND b.status='checked_in') AS occupied,
            a.state AS ac_state, a.changed_at AS ac_changed_at, a.device_id AS ac_device
       FROM room_climate c JOIN rooms r ON r.owner_id=c.owner_id AND r.id=c.room_id LEFT JOIN room_ac_devices a ON a.owner_id=c.owner_id AND a.room_id=c.room_id
      WHERE c.owner_id=$1 ORDER BY c.room_id`,
    [owner],
  )).rows;
  if (!rows.length) return null;
  if (!force && rows.every((r) => r.checked_at && Number(r.checked_at) > now - READ_EVERY_MS)) return null;
  const tuya = await tuyaCreds(pool, owner, unseal);
  if (!tuya) return { rooms: rows.length, read: 0, alerts: 0, error: "TUYA_NOT_SET_UP" };
  const s = normalizePowerSettings(parse((await pool.query(`SELECT settings_json FROM tv_power_settings WHERE owner_id=$1`, [owner])).rows[0]?.settings_json)).climate;
  let status = {}, error = "";
  try {
    const token = await cachedToken(pool, owner, tuya, seal, unseal);
    status = await tuyaStatus(fetch, tuya.host, tuya, token, rows.map((r) => String(r.device_id)));
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "TUYA_FAILED";
    if (seal) await pool.query(`DELETE FROM provider_tokens WHERE owner_id=$1 AND provider_key='tuya'`, [owner]);
  }
  let read = 0, alerts = 0;
  for (const r of rows) {
    const reading = error ? null : climateFromStatus(status[String(r.device_id)]);
    if (!reading) { await pool.query(`UPDATE room_climate SET checked_at=$3,error=$4 WHERE owner_id=$1 AND room_id=$2`, [owner, r.room_id, now, error || "NO_READING"]); continue; }
    read++;
    const occupied = Boolean(r.occupied);
    // When did the A/C get power: its relay (if the room has one), else the check-in.
    const acOnSince = r.ac_device ? (Number(r.ac_state) === 1 && r.ac_changed_at ? Number(r.ac_changed_at) : null) : occupied ? Number(r.checked_in_at ?? 0) || null : null;
    const prev = { humid_since: r.humid_since ? Number(r.humid_since) : null, hot_since: r.hot_since ? Number(r.hot_since) : null, alerted_humid_at: r.alerted_humid_at ? Number(r.alerted_humid_at) : null, alerted_temp_at: r.alerted_temp_at ? Number(r.alerted_temp_at) : null, alerted_battery_at: r.alerted_battery_at ? Number(r.alerted_battery_at) : null };
    const { next, alerts: list } = evaluateClimate(prev, reading, { occupied, acOnSince, now }, s);
    await pool.query(
      `UPDATE room_climate SET temp=$3,humidity=$4,battery=$5,read_at=$6,checked_at=$6,error='',humid_since=$7,hot_since=$8,alerted_humid_at=$9,alerted_temp_at=$10,alerted_battery_at=$11 WHERE owner_id=$1 AND room_id=$2`,
      [owner, r.room_id, reading.temp, reading.humidity, reading.battery, now, next.humid_since, next.hot_since, next.alerted_humid_at, next.alerted_temp_at, next.alerted_battery_at],
    );
    for (const a of list) {
      const [el, en] = texts[a](String(r.code), reading, s);
      if (a === "hot" || a === "cold") {
        const n = await pool.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,$2,'minor',$3,$4) RETURNING id`, [owner, r.room_id, `${el.replace(/^\S+\s/, "")} (αυτόματα από τον αισθητήρα θερμοκρασίας)`, now]);
        await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'housekeeping',$2,$3,$4,$5)`, [owner, el, en, `/pms/maintenance?notice=${n.rows[0].id}`, now]);
      } else {
        await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/room-ac',$4)`, [owner, el, en, now]);
      }
      alerts++;
    }
  }
  if (alerts) console.log(`Room climate: ${read} sensors read, ${alerts} alert(s)`);
  return { rooms: rows.length, read, alerts, error };
}
