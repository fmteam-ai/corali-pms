// Corali TV power through Shelly Cloud smart plugs (pure; shared by the PMS and the run-tv-power worker; unit tested).
// Shelly Cloud Control API v2: POST https://<server>/v2/devices/api/set/switch?auth_key=… {id,channel,on}
// and POST …/v2/devices/api/get?auth_key=… {ids,select:["status"]}. The cloud allows about 1 request per second.

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
  };
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

/** Online flag and output of one device from a get reply (Gen2/3 "switch:N".output or Gen1 relays[N].ison). */
export function deviceState(device, channel = 0) {
  if (!device || typeof device !== "object") return { online: false, on: null };
  const st = device.status ?? {};
  const out = st[`switch:${channel}`]?.output ?? st.relays?.[channel]?.ison;
  return { online: Number(device.online) === 1 || device.online === true, on: typeof out === "boolean" ? out : null };
}
