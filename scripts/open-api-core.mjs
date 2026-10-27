// Corali open API (pure; unit tested): key format and scopes, the booking events sent to outgoing webhooks, their
// signature and retry times. Used by the PMS (Next.js) and by the webhook worker in the automation cron.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** What a key may do. Read scopes never include card or document data. */
export const API_SCOPES = ["rooms.read", "availability.read", "bookings.read", "folio.write", "accounting.read"];

export const WEBHOOK_EVENTS = ["booking.created", "booking.updated", "booking.cancelled", "booking.checked_in", "booking.checked_out", "folio.charge", "folio.payment"];

/** Keys look like corali_<8-char id>_<secret>; the id finds the row, only the SHA-256 of the whole key is stored. */
export function parseApiKey(header) {
  const m = /^(?:Bearer\s+)?(corali_([a-z0-9]{8})_[A-Za-z0-9_-]{32,64})$/.exec(String(header ?? "").trim());
  return m ? { key: m[1], prefix: m[2] } : null;
}
export const apiKeyHash = (key) => createHash("sha256").update(key).digest("hex");
export function sameHash(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The booking fields a webhook reports; a change in any of them is a "booking.updated". */
export function bookingFingerprint(b) {
  return createHash("sha256").update(JSON.stringify([b.status, b.room_id ?? null, b.check_in, b.check_out, Number(b.total_cents), Number(b.balance_cents), b.guest_name, b.guest_email ?? null])).digest("hex").slice(0, 32);
}

/** Event for a booking compared with what was last reported (null = nothing to send). */
export function bookingEvent(previous, current) {
  if (!previous) return current.status === "cancelled" ? null : "booking.created";
  if (previous.status !== current.status) {
    if (current.status === "cancelled" || current.status === "no_show") return "booking.cancelled";
    if (current.status === "checked_in") return "booking.checked_in";
    if (current.status === "checked_out") return "booking.checked_out";
    return "booking.updated";
  }
  return previous.fingerprint !== current.fingerprint ? "booking.updated" : null;
}

/** Folio entry → event (charges and payments only; internal adjustments are not sent). */
export function folioEvent(entryType) {
  if (entryType === "charge") return "folio.charge";
  if (entryType === "payment" || entryType === "refund") return "folio.payment";
  return null;
}

/** Corali-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body"> (verify it with the webhook's secret). */
export function signWebhook(secret, body, at = Date.now()) {
  const t = Math.floor(at / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Wait before the next try: 1, 5, 15, 60 minutes, then every 3 hours; give up after 10 tries. */
export function retryDelayMs(attempts) {
  if (attempts >= 10) return null;
  return [1, 5, 15, 60][attempts - 1] * 60_000 || 3 * 3_600_000;
}

/** Webhook addresses: https only (http only to this machine, for tests), no credentials in the address. */
export function webhookUrlProblem(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return "URL"; }
  if (u.username || u.password) return "URL";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "HTTPS";
  return null;
}
