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

async function call(fetchFn, host, creds, method, path, token, payload = undefined) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = tuyaHeaders({ ...creds, token, method, path, body });
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetchFn(`${host}${path}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(15_000) });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.success) throw Error(`TUYA_${out?.code ?? res.status}${out?.msg ? ` ${String(out.msg).slice(0, 120)}` : ""}`);
  return out.result;
}

/** Access token (valid ~2 hours). */
export async function tuyaToken(fetchFn, host, creds) {
  const r = await call(fetchFn, host, creds, "GET", "/v1.0/token?grant_type=1", "");
  return { token: String(r.access_token), expiresAt: Date.now() + (Number(r.expire_time) || 7200) * 1000 - 120_000 };
}

/** Raw data points per device id, 20 devices per request. */
export async function tuyaStatus(fetchFn, host, creds, token, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    const r = await call(fetchFn, host, creds, "GET", `/v1.0/iot-03/devices/status?device_ids=${part.join(",")}`, token);
    for (const d of Array.isArray(r) ? r : []) out[String(d.id)] = d.status;
  }
  return out;
}

/** Presence per device id (true / false / null when unknown). */
export async function tuyaPresence(fetchFn, host, creds, token, ids) {
  const raw = await tuyaStatus(fetchFn, host, creds, token, ids);
  return Object.fromEntries(Object.entries(raw).map(([id, st]) => [id, presenceFromStatus(st)]));
}

// ---- v170: Tuya IR hubs (e.g. Avatto S16) — IR Control Hub Open Service. An IR command is one-way: Tuya «success»
// means the hub sent it, not that the appliance received it (the room's temperature sensor tells that).

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** A/C state to send: power 1/0, mode 0 cool · 1 heat · 2 auto · 3 fan · 4 dry, temp 16–30 °C, wind 0 auto · 1 low · 2 mid · 3 high. */
export function acScene(x) {
  return { power: x && x.power === false ? 0 : 1, mode: clampInt(x?.mode, 0, 4, 0), temp: clampInt(x?.temp, 16, 30, 25), wind: clampInt(x?.wind, 0, 3, 0) };
}

/** The Power key of a remote, from GET …/remotes/{id}/keys ({category_id, key_list:[{key,key_id,key_name,standard_key}]}). */
export function pickPowerKey(result) {
  const list = Array.isArray(result?.key_list) ? result.key_list : [];
  const k = list.find((x) => /^power$/i.test(String(x?.key ?? ""))) ?? list.find((x) => /power/i.test(`${x?.key ?? ""} ${x?.key_name ?? ""} ${x?.standard_key ?? ""}`));
  if (!k || result?.category_id === undefined) return null;
  return { category_id: Number(result.category_id), key: String(k.key), key_id: Number(k.key_id) };
}

const irPath = (hub, rest) => { if (!ID.test(String(hub))) throw Error("BAD_ID"); return `/v2.0/infrareds/${hub}${rest}`; };
const remotePart = (id) => { if (!ID.test(String(id))) throw Error("BAD_ID"); return String(id); };

/** Remotes stored under an IR hub: [{remote_id, remote_name, category_id, brand_id, …}]. */
export async function irRemotes(fetchFn, host, creds, token, hub) {
  const r = await call(fetchFn, host, creds, "GET", irPath(hub, "/remotes"), token);
  return Array.isArray(r) ? r : [];
}

/** Full A/C state in one IR frame (what the A/C remote sends). */
export async function irAcScene(fetchFn, host, creds, token, hub, remote, scene) {
  return call(fetchFn, host, creds, "POST", irPath(hub, `/air-conditioners/${remotePart(remote)}/scenes/command`), token, acScene(scene));
}

/** A/C power only (on keeps the remote's last mode / temperature). */
export async function irAcPower(fetchFn, host, creds, token, hub, remote, on) {
  return call(fetchFn, host, creds, "POST", irPath(hub, `/air-conditioners/${remotePart(remote)}/command`), token, { code: "power", value: on ? 1 : 0 });
}

/** The Power key of a TV / other remote ({category_id, key, key_id}) or null. */
export async function irPowerKey(fetchFn, host, creds, token, hub, remote) {
  return pickPowerKey(await call(fetchFn, host, creds, "GET", irPath(hub, `/remotes/${remotePart(remote)}/keys`), token));
}

export async function irSendKey(fetchFn, host, creds, token, hub, remote, key) {
  return call(fetchFn, host, creds, "POST", irPath(hub, `/remotes/${remotePart(remote)}/command`), token, { category_id: key.category_id, key: key.key, key_id: key.key_id });
}
