// Tuya Cloud (Smart Life devices, e.g. mmWave presence sensors) — request signing and reading presence (pure parts are
// unit tested). Tuya IoT Platform → Cloud project → Access ID / Secret, with the Smart Life app account linked.
import { createHash, createHmac } from "node:crypto";

export const TUYA_HOSTS = { eu: "https://openapi.tuyaeu.com", weu: "https://openapi-weaz.tuyaeu.com", us: "https://openapi.tuyaus.com", cn: "https://openapi.tuyacn.com", in: "https://openapi.tuyain.com" };

/** Tuya signature (HMAC-SHA256, upper-case hex) over client id [+ token] + t + nonce + method\nsha256(body)\n\npath?query. */
export function tuyaSign({ accessId, secret, token = "", t, nonce = "", method, path, body = "" }) {
  const stringToSign = [method.toUpperCase(), createHash("sha256").update(body).digest("hex"), "", path].join("\n");
  return createHmac("sha256", secret).update(accessId + token + t + nonce + stringToSign).digest("hex").toUpperCase();
}

export function tuyaHeaders({ accessId, secret, token = "", method, path, body = "", t = String(Date.now()) }) {
  const h = { client_id: accessId, t, sign_method: "HMAC-SHA256", nonce: "", sign: tuyaSign({ accessId, secret, token, t, method, path, body }) };
  if (token) h.access_token = token;
  return h;
}

/**
 * Is someone in the room, from a device's data points? mmWave sensors report presence_state ("presence" / "none"),
 * others human_motion_state, presence, occupancy or pir. null when the device reports none of them.
 */
export function presenceFromStatus(status) {
  if (!Array.isArray(status)) return null;
  const codes = ["presence_state", "human_motion_state", "presence", "occupancy", "pir_state", "pir"];
  for (const code of codes) {
    const dp = status.find((x) => x && x.code === code);
    if (!dp) continue;
    const v = dp.value;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    return !["none", "no", "unoccupied", "no_presence", "false", "0", "peaceful"].includes(s);
  }
  return null;
}

async function call(fetchFn, host, creds, method, path, token) {
  const res = await fetchFn(`${host}${path}`, { method, headers: tuyaHeaders({ ...creds, token, method, path }), signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw Error(`TUYA_${body?.code ?? res.status}${body?.msg ? ` ${String(body.msg).slice(0, 120)}` : ""}`);
  return body.result;
}

/** Access token (valid ~2 hours). */
export async function tuyaToken(fetchFn, host, creds) {
  const r = await call(fetchFn, host, creds, "GET", "/v1.0/token?grant_type=1", "");
  return { token: String(r.access_token), expiresAt: Date.now() + (Number(r.expire_time) || 7200) * 1000 - 120_000 };
}

/** Presence per device id (true / false / null when unknown), 20 devices per request. */
export async function tuyaPresence(fetchFn, host, creds, token, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    const r = await call(fetchFn, host, creds, "GET", `/v1.0/iot-03/devices/status?device_ids=${part.join(",")}`, token);
    for (const d of Array.isArray(r) ? r : []) out[String(d.id)] = presenceFromStatus(d.status);
  }
  return out;
}
