// Guest pass (pure; unit tested): proves at a partner business that the visitor is staying at the hotel now. The code
// is an HMAC of the booking and the current minute, so a screenshot stops working within a minute or two.
import { createHmac, timingSafeEqual } from "node:crypto";

export const PASS_WINDOW_MS = 60_000;
const windowAt = (now: number) => Math.floor(now / PASS_WINDOW_MS);
const mac = (secret: string, bookingId: number, w: number) => createHmac("sha256", `guest-pass:${secret}`).update(`${bookingId}:${w}`).digest();

/** 6 digits shown under the QR (the business may type them). */
export function passCode(secret: string, bookingId: number, now: number): string {
  const h = mac(secret, bookingId, windowAt(now));
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** QR content: booking, minute and a 12-character signature. */
export function passQr(secret: string, bookingId: number, now: number): string {
  const w = windowAt(now);
  return `CORALI-GP:${bookingId}:${w}:${mac(secret, bookingId, w).subarray(0, 9).toString("base64url")}`;
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The booking a scanned QR belongs to, if it is from this minute or the one before; else null. */
export function verifyPassQr(secret: string, qr: string, now: number): number | null {
  const m = /^CORALI-GP:(\d{1,12}):(\d{1,12}):([A-Za-z0-9_-]{12})$/.exec(qr.trim());
  if (!m) return null;
  const id = Number(m[1]), w = Number(m[2]), cur = windowAt(now);
  if (w !== cur && w !== cur - 1) return null;
  return sameText(mac(secret, id, w).subarray(0, 9).toString("base64url"), m[3]) ? id : null;
}

/** Which of the in-house bookings a typed 6-digit code belongs to (this minute or the one before). */
export function matchPassCode(secret: string, code: string, bookingIds: number[], now: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const id of bookingIds) for (const t of [now, now - PASS_WINDOW_MS]) if (sameText(passCode(secret, id, t), code)) return id;
  return null;
}
