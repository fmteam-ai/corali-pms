import { cookies } from "next/headers";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { documentKey, env } from "@/lib/env";
import { sessionCookieName } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { verifyPassword } from "@/lib/security/password";
import { verifyTotp } from "@/lib/security/totp";
import { hashNetworkValue, hashToken, newOpaqueToken } from "@/lib/security/tokens";
import { decryptField } from "@/lib/security/encryption";

const inputSchema = z.object({
  username: z.string().trim().min(1).max(100).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(256),
  totp: z.string().trim().max(64).default(""),
});

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const input = inputSchema.parse(await request.json());
    const ownerId = env().PMS_OWNER_ID;
    const attemptKey = hashNetworkValue(`${ownerId}:${input.username}:${clientIp(request)}`);
    const now = Date.now();
    const attempt = await db().query("SELECT attempts, window_started_at, blocked_until FROM pms_login_attempts WHERE key_hash = $1", [attemptKey]);
    if (Number(attempt.rows[0]?.blocked_until ?? 0) > now) {
      return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: { "Retry-After": "900" } });
    }

    const userResult = await db().query({
      text: `SELECT id, password_hash, totp_secret, totp_confirmed_at, recovery_codes_json, active FROM pms_staff_users
              WHERE owner_id = $1 AND lower(username) = $2 LIMIT 1`,
      values: [ownerId, input.username],
    });
    const user = userResult.rows[0];
    const passwordOk = user?.active === 1 && await verifyPassword(user.password_hash, input.password).catch(() => false);
    let totpOk = passwordOk && !user?.totp_confirmed_at;
    if (passwordOk && user?.totp_confirmed_at) {
      const storedSecret = String(user.totp_secret || "");
      const totpSecret = storedSecret.startsWith("v1.") ? decryptField(storedSecret, documentKey()) : storedSecret;
      totpOk = verifyTotp(totpSecret, input.totp);
      if (!totpOk && input.totp) {
        const hashes = JSON.parse(user.recovery_codes_json || "[]") as string[];
        const recoveryHash = hashToken(input.totp.toUpperCase());
        const match = hashes.indexOf(recoveryHash);
        if (match >= 0) {
          const remaining = hashes.filter((_, index) => index !== match);
          const consumed = await db().query(
            `UPDATE pms_staff_users SET recovery_codes_json=$1, updated_at=$2
             WHERE owner_id=$3 AND id=$4 AND recovery_codes_json=$5`,
            [JSON.stringify(remaining), now, ownerId, user.id, user.recovery_codes_json],
          );
          totpOk = consumed.rowCount === 1;
        }
      }
    }
    if (!passwordOk || !totpOk) {
      await withTransaction(async (client) => {
        const existing = await client.query("SELECT attempts, window_started_at FROM pms_login_attempts WHERE key_hash = $1 FOR UPDATE", [attemptKey]);
        const withinWindow = now - Number(existing.rows[0]?.window_started_at ?? 0) < 15 * 60_000;
        const attempts = withinWindow ? Number(existing.rows[0]?.attempts ?? 0) + 1 : 1;
        const blockedUntil = attempts >= 5 ? now + 15 * 60_000 : null;
        await client.query(
          `INSERT INTO pms_login_attempts (key_hash, attempts, window_started_at, blocked_until, updated_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (key_hash) DO UPDATE SET attempts=$2, window_started_at=$3, blocked_until=$4, updated_at=$5`,
          [attemptKey, attempts, withinWindow ? existing.rows[0]?.window_started_at : now, blockedUntil, now],
        );
      });
      return Response.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const token = newOpaqueToken();
    const expiresAt = now + 8 * 60 * 60_000;
    await withTransaction(async (client) => {
      await client.query("DELETE FROM pms_login_attempts WHERE key_hash = $1", [attemptKey]);
      await client.query(
        `INSERT INTO pms_sessions (owner_id, staff_user_id, token_hash, expires_at, created_at, last_seen_at, user_agent, ip_hash)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`,
        [ownerId, user.id, hashToken(token), expiresAt, now, request.headers.get("user-agent")?.slice(0, 500) ?? "", hashNetworkValue(clientIp(request))],
      );
    });
    (await cookies()).set(sessionCookieName, token, {
      httpOnly: true,
      secure: env().NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: new Date(expiresAt),
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (error instanceof Error && error.message === "UNTRUSTED_ORIGIN") return Response.json({ ok: false, error: "UNTRUSTED_ORIGIN" }, { status: 403 });
    console.error("PMS login failed", error);
    return Response.json({ ok: false, error: "LOGIN_FAILED" }, { status: 500 });
  }
}
