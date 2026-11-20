// v180: security rules shared by the PMS (Next.js) and the cron worker — pure functions, no database.
//
// 1. The visitor's address. Everything reaches the hotel's server through Cloudflare, which writes the real address
//    in CF-Connecting-IP (a visitor cannot set it through Cloudflare). X-Forwarded-For is NOT trusted: Cloudflare
//    appends to whatever the visitor sent, so its first entry can be forged — that let anyone dodge per-address limits.
// 2. The origin lock. Cloudflare adds a secret header to every request it forwards (a «Transform Rule» the hotel sets
//    once); when the lock is on, the PMS refuses requests without it — someone who found the server's own address
//    (it is public through the mail record) can no longer bypass Cloudflare's protection.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const EDGE_HEADER = "x-corali-edge";
/** Set by proxy.ts for the routes: the address it decided to trust (any value sent by the visitor is replaced). */
export const CLIENT_IP_HEADER = "x-corali-client-ip";
/** Locked but no request with the key for this long (the TVs ask every minute): the Cloudflare rule is gone → open. */
export const EDGE_STALE_MS = 30 * 60_000;

const ipLike = (v) => /^[0-9A-Fa-f:.]{2,45}$/.test(String(v ?? "").trim());

/** The address to trust: CF-Connecting-IP when it looks like an address, else the LAST forwarding entry (added by the
 * hotel's own web server, not by the visitor), else X-Real-IP, else "unknown". `get` reads a request header. */
export function pickClientIp(get) {
  const cf = String(get("cf-connecting-ip") ?? "").trim();
  if (ipLike(cf)) return cf;
  const chain = String(get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const last = chain[chain.length - 1];
  if (ipLike(last)) return last;
  const real = String(get("x-real-ip") ?? "").trim();
  return ipLike(real) ? real : "unknown";
}

/** A new origin-lock key (shown once to the owner, pasted into Cloudflare). */
export const newEdgeSecret = (rand = randomBytes) => `ce_${rand(24).toString("base64url")}`;
export const edgeSecretHash = (secret) => createHash("sha256").update(String(secret)).digest("hex");

/** Does a request's header carry the key? Constant-time compare of the hashes. */
export function edgeKeyMatches(headerValue, storedHash) {
  if (!storedHash || !headerValue || String(headerValue).length > 200) return false;
  const a = Buffer.from(edgeSecretHash(headerValue)), b = Buffer.from(String(storedHash));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Let a request in? `allow` — no lock, or the key is right; `block` — locked and no key; `open` — locked, but no
 * request has carried the key for EDGE_STALE_MS (the Cloudflare rule was removed): the PMS stays reachable and the
 * hourly check tells the owner.
 */
export function edgeDecision({ enforce, keyOk, lastSeenAt, now }) {
  if (!enforce || keyOk) return "allow";
  if (!lastSeenAt || now - Number(lastSeenAt) > EDGE_STALE_MS) return "open";
  return "block";
}

/** Paths never locked: the health checks used by the installer and monitoring (they reveal nothing). */
export const edgeExempt = (path) => path === "/api/health" || path.startsWith("/api/health/");

export const SECURITY_EVENT_KINDS = ["origin_blocked", "rate_limited", "bad_api_key", "bad_bridge_token", "bad_tv_token", "bad_webhook", "login_failed"];

/** The hour an event is counted in (events are kept as «kind × address × hour» counters, so a flood stays small). */
export const eventHour = (now) => Math.floor(Number(now) / 3_600_000) * 3_600_000;

// Hourly alert thresholds (per hour, all addresses together). A removed TV that still polls makes 60 a hour, so the
// TV threshold is well above that.
export const ALERT_LIMITS = { login_failed: 15, rate_limited: 200, bad_api_key: 30, bad_bridge_token: 20, bad_tv_token: 300, bad_webhook: 20, origin_blocked: 300 };

/**
 * What to tell the owner, from the last hour's counters and the state of the accounts. Each alert has a stable key,
 * so the same problem is told once (until it goes away and comes back).
 *   counts: { [kind]: number } in the last hour; admins: [{ username, role, totp }]; edge: { enforce, lastSeenAt }
 */
export function securityAlerts({ counts, admins, edge, now }) {
  const out = [];
  for (const [kind, limit] of Object.entries(ALERT_LIMITS)) {
    const n = Number(counts?.[kind] ?? 0);
    if (n >= limit) out.push({ key: `${kind}:${eventHour(now)}`, kind, n });
  }
  for (const a of admins ?? []) if (!a.totp && ["owner", "admin", "manager"].includes(String(a.role))) out.push({ key: `no2fa:${a.username}`, kind: "no_2fa", user: String(a.username) });
  if (edge?.enforce && edgeDecision({ enforce: true, keyOk: false, lastSeenAt: edge.lastSeenAt, now }) === "open") out.push({ key: "edge_stale", kind: "edge_stale" });
  return out;
}

const KIND_TEXT = {
  login_failed: ["αποτυχημένες συνδέσεις στο PMS", "failed PMS sign-ins"],
  rate_limited: ["αιτήματα κόπηκαν από το όριο προσπαθειών", "requests stopped by the attempt limit"],
  bad_api_key: ["αιτήματα API με λάθος κλειδί", "API requests with a wrong key"],
  bad_bridge_token: ["αιτήματα στη γέφυρα Wi-Fi με λάθος κλειδί", "Wi-Fi bridge requests with a wrong key"],
  bad_tv_token: ["αιτήματα τηλεόρασης με άγνωστο κλειδί", "TV requests with an unknown key"],
  bad_webhook: ["webhooks με λάθος υπογραφή", "webhooks with a wrong signature"],
  origin_blocked: ["αιτήματα που παρέκαμψαν το Cloudflare (κόπηκαν)", "requests that bypassed Cloudflare (stopped)"],
};
export const eventLabel = (kind, lang = "el") => (KIND_TEXT[kind] ?? [kind, kind])[lang === "el" ? 0 : 1];

/** Notification texts for one alert. */
export function alertText(a) {
  if (a.kind === "no_2fa") return { el: `🔐 Ο χρήστης «${a.user}» έχει δικαιώματα διαχείρισης χωρίς κωδικό δύο βημάτων (2FA)`, en: `🔐 User «${a.user}» has admin rights without two-step sign-in (2FA)` };
  if (a.kind === "edge_stale") return { el: "🛡️ Το κλείδωμα Cloudflare δεν λαμβάνει το κλειδί εδώ και 30′ — ελέγξτε τον κανόνα στο Cloudflare (το PMS έμεινε ανοιχτό)", en: "🛡️ The Cloudflare lock has not received its key for 30′ — check the Cloudflare rule (the PMS was left open)" };
  return { el: `🛡️ Ασφάλεια: ${a.n} ${eventLabel(a.kind, "el")} την τελευταία ώρα`, en: `🛡️ Security: ${a.n} ${eventLabel(a.kind, "en")} in the last hour` };
}
