// Simple fixed-window limiter for public endpoints (e.g. guest login), stored in public_request_limits.
import { createHash } from "node:crypto";
import { withTransaction } from "@/lib/db";
import { recordSecurityEvent } from "@/lib/security-center";
import { CLIENT_IP_HEADER, pickClientIp } from "../scripts/security-core.mjs";

/** The visitor's address as decided by proxy.ts (Cloudflare's CF-Connecting-IP; v180 — the first X-Forwarded-For
 * entry used before could be forged by the visitor to dodge the per-address limits). */
export function clientIp(request: Request | { headers: { get(name: string): string | null } }): string {
  const trusted = request.headers.get(CLIENT_IP_HEADER);
  return (trusted && trusted.length <= 45 ? trusted : pickClientIp((n) => request.headers.get(n))).slice(0, 64);
}

/** Count one attempt for `key`; false once `max` attempts were made within `windowMs` (then blocked for `blockMs`). */
export async function allowAttempt(key: string, max: number, windowMs: number, blockMs: number): Promise<boolean> {
  const hash = createHash("sha256").update(key).digest("hex");
  const now = Date.now();
  return withTransaction(async (c) => {
    const row = (await c.query(`SELECT attempts,window_started_at,blocked_until FROM public_request_limits WHERE key_hash=$1 FOR UPDATE`, [hash])).rows[0];
    if (row && Number(row.blocked_until ?? 0) > now) return false;
    const fresh = !row || now - Number(row.window_started_at) > windowMs;
    const attempts = fresh ? 1 : Number(row.attempts) + 1;
    const blockedUntil = attempts > max ? now + blockMs : null;
    await c.query(
      `INSERT INTO public_request_limits(key_hash,attempts,window_started_at,blocked_until,updated_at) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(key_hash) DO UPDATE SET attempts=$2,window_started_at=$3,blocked_until=$4,updated_at=$5`,
      [hash, attempts, fresh ? now : Number(row.window_started_at), blockedUntil, now],
    );
    return attempts <= max;
  }).then((ok) => {
    // v180: every refused request is counted in PMS → Security center (one counter per kind and hour).
    if (!ok) void recordSecurityEvent("rate_limited", "", key.split(":")[0]);
    return ok;
  });
}
