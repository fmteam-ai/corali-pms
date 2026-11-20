// Room Shelly plugs (TV or, v174, fridge): the automatic rule — on from the switch-on time of the arrival day while a
// stay is confirmed / checked in, off after check-out — applied when that decision changed since the last automatic
// switch, so a manual change from the PMS is respected. «tv»: only rooms whose TV power method is «shelly»; «fridge»:
// every room with a plug. Shared by run-tv-power.mjs and the per-minute automation cron (every 5 minutes).
import { desiredPower, deviceState, fridgeCheck, normalizePowerSettings, plugAutomated, statusRequest, switchError, switchRequest } from "./tv-power-core.mjs";

export async function runTvPlugs({ pool, owner, unseal, now = new Date() }) {
  const s = (await pool.query(`SELECT settings_json,auth_key_encrypted FROM tv_power_settings WHERE owner_id=$1`, [owner])).rows[0];
  let raw = null;
  try { raw = s ? JSON.parse(s.settings_json) : null; } catch { raw = null; }
  const settings = normalizePowerSettings(raw);
  const label = settings.plugUse === "fridge" ? "Fridge" : "TV";
  if (!settings.enabled || !settings.server || !s?.auth_key_encrypted) return { label, off: true, rooms: 0, switched: 0, failed: 0 };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const key = unseal(s.auth_key_encrypted);
  const rooms = (await pool.query(`SELECT room_id,power_device_id,power_channel,power_auto_state,COALESCE(power_method,'shelly') AS method,active FROM tv_screens WHERE owner_id=$1 AND power_device_id<>'' ORDER BY room_id`, [owner])).rows
    .filter((r) => plugAutomated(settings.plugUse, String(r.method)) && (settings.plugUse === "fridge" || Number(r.active) === 1));
  let switched = 0, failed = 0;
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
    else { failed++; console.error(`${label} power: room ${r.room_id} → ${want ? "on" : "off"} failed: ${error}`); }
    await new Promise((ok) => setTimeout(ok, 1100)); // Shelly Cloud: about 1 request per second
  }
  const faults = settings.plugUse === "fridge" ? await fridgeFaults({ pool, owner, server: settings.server, key }) : 0;
  return { label, off: false, rooms: rooms.length, switched, failed, faults };
}

/**
 * v176: a fridge whose plug is ON but has drawn no power for 3 hours (broken, or pulled out of the socket): one PMS
 * notification and a maintenance notice, cleared when it draws again (see fridgeCheck). Plugs without a power meter
 * are never judged. Returns the number of new alerts.
 */
async function fridgeFaults({ pool, owner, server, key }) {
  const rows = (await pool.query(
    `SELECT s.room_id,s.power_device_id,s.power_channel,s.power_state,s.power_changed_at,s.fridge_draw_at,s.fridge_alert_at,r.code
       FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.power_device_id<>'' ORDER BY s.room_id`,
    [owner],
  )).rows;
  let alerts = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const part = rows.slice(i, i + 10);
    let list = [];
    try {
      const req = statusRequest(server, key, part.map((r) => String(r.power_device_id)));
      const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body, signal: AbortSignal.timeout(15000) });
      const body = res.ok ? await res.json().catch(() => null) : null;
      list = Array.isArray(body) ? body : Array.isArray(body?.devices) ? body.devices : body && typeof body === "object" ? Object.values(body) : [];
    } catch { list = []; }
    const now = Date.now();
    for (const r of part) {
      const d = list.find((x) => x && typeof x === "object" && String(x.id) === String(r.power_device_id));
      if (!d) continue;
      const num = (v) => (v === null || v === undefined ? null : Number(v));
      const prev = { drawAt: num(r.fridge_draw_at), alertAt: num(r.fridge_alert_at), onSince: Number(r.power_state) === 1 ? num(r.power_changed_at) : null };
      const next = fridgeCheck(deviceState(d, Number(r.power_channel)), prev, now);
      if (next.drawAt !== prev.drawAt || next.alertAt !== prev.alertAt) await pool.query(`UPDATE tv_screens SET fridge_draw_at=$1,fridge_alert_at=$2 WHERE owner_id=$3 AND room_id=$4`, [next.drawAt, next.alertAt, owner, r.room_id]);
      if (!next.alert) continue;
      const el = `🧊 Δωμάτιο ${r.code}: το ψυγείο δεν τραβάει ρεύμα εδώ και 3+ ώρες ενώ η πρίζα είναι αναμμένη — χάλασε ή βγήκε από την πρίζα`;
      const en = `🧊 Room ${r.code}: the fridge has drawn no power for 3+ hours while its plug is on — broken or unplugged`;
      const n = await pool.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,$2,'minor',$3,$4) RETURNING id`, [owner, r.room_id, "Ψυγείο: δεν τραβάει ρεύμα 3+ ώρες με αναμμένη πρίζα (αυτόματα από την πρίζα Shelly)", now]);
      await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'housekeeping',$2,$3,$4,$5)`, [owner, el, en, `/pms/maintenance?notice=${n.rows[0].id}`, now]);
      alerts++;
    }
    if (i + 10 < rows.length) await new Promise((ok) => setTimeout(ok, 1100)); // Shelly Cloud: about 1 request per second
  }
  return alerts;
}
