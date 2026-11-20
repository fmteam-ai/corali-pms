// v177: per-booking Wi-Fi password on TP-Link Omada (OC200 6.x) — PPSK («Private Pre-Shared Key»): one guest SSID,
// a different password per booking, added at check-in and removed after check-out. Omada Open API, client mode:
//   POST {url}/openapi/authorize/token?grant_type=client_credentials {omadacId, client_id, client_secret}
//   Authorization: AccessToken=<token>
//   GET  /openapi/v1/{omadacId}/sites?page=1&pageSize=100                         → result.data[{siteId,name}]
//   GET  /openapi/v1/{omadacId}/sites/{siteId}/ppsk-profiles                       → result[{id,profileName,ssid[]}]
//   GET  /openapi/v1/{omadacId}/sites/{siteId}/ppsk-profile/{profileId}            → result.ppsk[{name,psk}]
//   POST /openapi/v1/{omadacId}/sites/{siteId}/ppsk-profile/{profileId}/add-psk    {ppskList:[{name,psk}]}
//   POST /openapi/v1/{omadacId}/sites/{siteId}/ppsk-profile/{profileId}/delete-psk {ppskNameList:[name]}
// The hotel creates the guest SSID with «PPSK without RADIUS» and its PPSK profile once in the controller.
import { randomInt } from "node:crypto";

/** «https://euw1-omada-northbound.tplinkcloud.com/», «192.168.10.2:443» → https origin; "" when not an https URL. */
export function omadaUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "https:" ? u.origin : "";
  } catch { return ""; }
}

export const validOmadacId = (v) => /^[A-Za-z0-9]{16,64}$/.test(String(v ?? ""));

/** The PSK entry of a booking in the profile (names are unique per profile; at most 64 characters). */
export const pskName = (reference) => `PMS-${String(reference).replace(/[^A-Za-z0-9-]/g, "").slice(0, 40)}`;

/** A password guests can type on a phone: 10 characters, lower case and digits without look-alikes (0/o, 1/l/i). */
export function guestPassword(rand = randomInt) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[rand(chars.length)];
  return out;
}

/** The Wi-Fi QR code text phones understand (WPA2; PPSK works like a normal WPA2-Personal network for the guest). */
export const wifiQr = (ssid, psk) => `WIFI:T:WPA;S:${String(ssid).replace(/([\\;,:"])/g, "\\$1")};P:${String(psk).replace(/([\\;,:"])/g, "\\$1")};;`;

/** Which PSK entries to add (checked-in stays without one) and remove (stays that ended), from the PMS records. */
export function wifiPlan(stays, entries, today) {
  const live = new Map(stays.filter((s) => s.status === "checked_in" && s.check_out >= today).map((s) => [Number(s.id), s]));
  // «pending» (v179, bridge mode): password chosen, the hotel's bridge has not added it yet — it counts as existing.
  const held = (e) => e.status === "active" || e.status === "pending";
  const add = [...live.values()].filter((s) => !entries.some((e) => Number(e.booking_id) === Number(s.id) && held(e)));
  const remove = entries.filter((e) => held(e) && !live.has(Number(e.booking_id)));
  return { add, remove };
}

/** A small Open API client. Throws Error(code) with OMADA_* codes the PMS shows. */
export function omadaClient({ url, omadacId, clientId, clientSecret }, request = fetch) {
  const base = omadaUrl(url);
  if (!base || !validOmadacId(omadacId) || !clientId || !clientSecret) throw Error("OMADA_NOT_CONFIGURED");
  let token = null;
  async function call(method, path, body, auth = true) {
    let res;
    try {
      res = await request(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `AccessToken=${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch { throw Error("OMADA_UNREACHABLE"); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Error(res.status === 401 || res.status === 403 ? "OMADA_AUTH" : `OMADA_HTTP_${res.status}`);
    if (!data || data.errorCode !== 0) throw Error(`OMADA_ERROR_${data?.errorCode ?? "?"}`);
    return data.result;
  }
  async function login() {
    if (token) return;
    const r = await call("POST", "/openapi/authorize/token?grant_type=client_credentials", { omadacId, client_id: clientId, client_secret: clientSecret }, false).catch((e) => { throw Error(e.message.startsWith("OMADA_ERROR") || e.message === "OMADA_HTTP_400" ? "OMADA_AUTH" : e.message); });
    if (!r?.accessToken) throw Error("OMADA_AUTH");
    token = r.accessToken;
  }
  const api = async (method, path, body) => { await login(); return call(method, `/openapi/v1/${omadacId}${path}`, body); };
  return {
    async siteId(name) {
      const r = await api("GET", "/sites?page=1&pageSize=100");
      const sites = Array.isArray(r?.data) ? r.data : [];
      const site = name ? sites.find((s) => String(s.name).trim().toLowerCase() === String(name).trim().toLowerCase()) : sites.length === 1 ? sites[0] : null;
      if (!site) throw Error(sites.length > 1 && !name ? "OMADA_SITE_NAME_NEEDED" : "OMADA_SITE_NOT_FOUND");
      return String(site.siteId);
    },
    async profile(siteId, name) {
      const list = await api("GET", `/sites/${siteId}/ppsk-profiles`);
      const p = (Array.isArray(list) ? list : []).find((x) => String(x.profileName).trim().toLowerCase() === String(name).trim().toLowerCase());
      if (!p) throw Error("OMADA_PROFILE_NOT_FOUND");
      return { id: String(p.id), ssids: Array.isArray(p.ssid) ? p.ssid.map(String) : [] };
    },
    async psks(siteId, profileId) {
      const r = await api("GET", `/sites/${siteId}/ppsk-profile/${profileId}`);
      return (Array.isArray(r?.ppsk) ? r.ppsk : []).map((x) => String(x.name));
    },
    addPsk: (siteId, profileId, name, psk) => api("POST", `/sites/${siteId}/ppsk-profile/${profileId}/add-psk`, { ppskList: [{ name, psk }] }),
    deletePsks: (siteId, profileId, names) => api("POST", `/sites/${siteId}/ppsk-profile/${profileId}/delete-psk`, { ppskNameList: names }),
  };
}

/** Settings check for the PMS «Έλεγχος» button: sign in, site, PPSK profile; returns what was found. */
export async function omadaCheck(conn, request = fetch) {
  const c = omadaClient(conn, request);
  const siteId = await c.siteId(conn.siteName);
  const p = await c.profile(siteId, conn.profile);
  const count = (await c.psks(siteId, p.id)).length;
  return { siteId, profileId: p.id, ssids: p.ssids, count };
}

/** v179: a controller address only reachable inside the hotel (192.168.x, 10.x, 172.16–31.x, .local): bridge mode. */
export function privateController(url) {
  const base = omadaUrl(url);
  if (!base) return false;
  const host = new URL(base).hostname;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(host) || host.endsWith(".local") || host === "localhost";
}

/**
 * v179: bridge plan (the Raspberry Pi in the hotel does the Omada calls): entries waiting to be added (status
 * «pending», password already chosen by the PMS) and entries to remove («removing»). From the PMS records only.
 */
export function bridgeWork(entries) {
  return {
    add: entries.filter((e) => e.status === "pending").map((e) => ({ bookingId: Number(e.booking_id), name: String(e.psk_name) })),
    remove: entries.filter((e) => e.status === "removing").map((e) => ({ bookingId: Number(e.booking_id), name: String(e.psk_name) })),
  };
}
