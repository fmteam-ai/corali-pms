// Corali TV power through Shelly Cloud smart plugs (pure; shared by the PMS and the run-tv-power worker; unit tested).
// Shelly Cloud Control API v2: POST https://<server>/v2/devices/api/set/switch?auth_key=… {id,channel,on}
// and POST …/v2/devices/api/get?auth_key=… {ids,select:["status"]}. The cloud allows about 1 request per second.

import { normalizeClimateSettings } from "./room-climate-core.mjs";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Should the room's TV have power now? On while a guest is checked in, and for a confirmed stay from the switch-on
 * time of the arrival day until the check-out day. Off otherwise (after check-out, empty room).
 * stays: [{status, check_in, check_out}] for the room; today: YYYY-MM-DD; time: HH:MM (hotel time).
 */
export function desiredPower(stays, today, time, onTime) {
  return stays.some((s) => {
    if (s.status === "checked_in") return true;
    if (s.status !== "confirmed" || !(s.check_in <= today && today < s.check_out)) return false;
    return s.check_in < today || time >= (HHMM.test(onTime) ? onTime : "13:00");
  });
}

/** "shelly-103-eu.shelly.cloud" or its https URL → "https://shelly-103-eu.shelly.cloud"; anything else → "". */
export function shellyServer(input) {
  const host = String(input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+\.shelly\.cloud$/.test(host) ? `https://${host}` : "";
}

/** Shelly device id as shown in the app (Device information → Device ID). */
export const validDeviceId = (id) => /^[A-Za-z0-9_-]{4,64}$/.test(String(id ?? ""));

export function normalizePowerSettings(raw) {
  const x = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: x.enabled === true || x.enabled === 1,
    server: shellyServer(x.server),
    onTime: HHMM.test(String(x.onTime ?? "")) ? String(x.onTime) : "13:00",
    autoOn: x.autoOn !== false && x.autoOn !== 0,
    autoOff: x.autoOff !== false && x.autoOff !== 0,
    // Room air conditioners on their own Shelly relay (e.g. 1PM Gen4): power only while a guest is checked in.
    acEnabled: x.acEnabled === true || x.acEnabled === 1,
    // With a presence sensor (Tuya mmWave): cut the A/C when nobody has been in the room for this many minutes.
    acPresence: x.acPresence === true || x.acPresence === 1,
    acAwayMinutes: Number.isFinite(Number(x.acAwayMinutes)) && x.acAwayMinutes !== "" && x.acAwayMinutes !== null ? Math.min(240, Math.max(5, Math.round(Number(x.acAwayMinutes)))) : 20,
    // Room temperature / humidity sensors: alert thresholds.
    climate: normalizeClimateSettings(x.climate),
  };
}

/** Manual on/off from the PMS for an empty room lasts this long; for an occupied room, until check-in / check-out. */
export const AC_MANUAL_EMPTY_MS = 3 * 3_600_000;

/**
 * Should the room's A/C have power? Only while a guest is checked in, unless staff switched it by hand from the PMS:
 * that choice holds while the occupancy is the same as when it was made and the override has not expired.
 * override: { on, occupied, until } or null; presence: { seenAt, checkedAt, awayMs } from the room's sensor, or null.
 */
export function acTarget(occupied, override, now, presence = null) {
  if (override && override.until > now && override.occupied === occupied) return override.on;
  if (!occupied) return false;
  // Presence sensor: off when nobody was seen for awayMs. Old or missing readings never cut the guest's A/C.
  if (presence && presence.checkedAt > now - PRESENCE_STALE_MS) return presence.seenAt >= now - presence.awayMs;
  return true;
}

/** Sensor readings older than this are ignored (the A/C stays on). */
export const PRESENCE_STALE_MS = 10 * 60_000;

/** The manual override to store when staff switch a room's A/C from the PMS. */
export function acOverride(on, occupied, now) {
  return { on, occupied, until: now + (occupied ? 30 * 86_400_000 : AC_MANUAL_EMPTY_MS) };
}

export function switchRequest(server, authKey, id, channel, on) {
  return {
    url: `${server}/v2/devices/api/set/switch?auth_key=${encodeURIComponent(authKey)}`,
    body: JSON.stringify({ id: String(id), channel: Number(channel) || 0, on: Boolean(on) }),
  };
}

export function statusRequest(server, authKey, ids) {
  return {
    url: `${server}/v2/devices/api/get?auth_key=${encodeURIComponent(authKey)}`,
    body: JSON.stringify({ ids: ids.map(String).slice(0, 10), select: ["status"] }),
  };
}

/** Error text from a set/switch reply (HTTP 200 can still carry per-device errors), or "" when it worked. */
export function switchError(status, body, id) {
  if (status === 401 || status === 403) return "SHELLY_AUTH";
  if (status === 429) return "SHELLY_RATE_LIMIT";
  if (status < 200 || status >= 300) return `SHELLY_HTTP_${status}`;
  if (body && typeof body === "object") {
    if (body.isok === false) return String(body.errors ? JSON.stringify(body.errors) : "SHELLY_FAILED").slice(0, 200);
    const perDevice = body[String(id)] ?? body.errors?.[String(id)];
    if (typeof perDevice === "string") return perDevice.slice(0, 200);
  }
  return "";
}

/** Online flag, output and power draw (W) of one device from a get reply (Gen2/3 "switch:N", Gen1 relays/meters). */
export function deviceState(device, channel = 0) {
  if (!device || typeof device !== "object") return { online: false, on: null, power: null };
  const st = device.status ?? {};
  const out = st[`switch:${channel}`]?.output ?? st.relays?.[channel]?.ison;
  const watts = st[`switch:${channel}`]?.apower ?? st.meters?.[channel]?.power;
  return { online: Number(device.online) === 1 || device.online === true, on: typeof out === "boolean" ? out : null, power: typeof watts === "number" ? watts : null };
}

/** Below this draw a TV with power is in standby (sets use ~0.5 W in standby and 40–150 W when on). */
export const STANDBY_WATTS = 8;

/**
 * How to turn a room's TV on through its plug for an urgent message: "on" when the plug is off, "cycle" (off, wait,
 * on: TVs set to power on with the mains start up) when it is on but the TV is in standby, "none" when the TV is
 * already on or the state is unknown.
 */
export function wakeAction(state) {
  if (!state.online || state.on === null) return "none";
  if (!state.on) return "on";
  return state.power !== null && state.power < STANDBY_WATTS ? "cycle" : "none";
}
