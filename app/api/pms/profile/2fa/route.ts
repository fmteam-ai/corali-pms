import { audited } from "@/lib/audit";
import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { encryptField, decryptField } from "@/lib/security/encryption";
import { hashToken } from "@/lib/security/tokens";
import { verifyPassword } from "@/lib/security/password";
import { verifyTotp } from "@/lib/security/totp";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin") }),
  z.object({ action: z.literal("confirm"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("disable"), password: z.string().min(8), code: z.string().regex(/^\d{6}$/) }),
]);

export async function GET() {
  const user = await requireApiUser("dashboard.read");
  if (user instanceof Response) return user;
  const result = await db().query(
    "SELECT totp_confirmed_at FROM pms_staff_users WHERE owner_id=$1 AND id=$2",
    [user.ownerId, user.id],
  );
  return Response.json({ ok: true, enabled: Boolean(result.rows[0]?.totp_confirmed_at) });
}

async function handlePOST(request: Request) {
  const user = await requireApiUser("dashboard.read");
  if (user instanceof Response) return user;
  try {
    assertTrustedOrigin(request);
    const body = input.parse(await request.json());
    const current = await db().query(
      "SELECT username,password_hash,totp_secret,totp_confirmed_at FROM pms_staff_users WHERE owner_id=$1 AND id=$2",
      [user.ownerId, user.id],
    );
    if (!current.rowCount) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    const row = current.rows[0];
    if (body.action === "begin") {
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      const totp = new OTPAuth.TOTP({ issuer: "Hotel Corali PMS", label: row.username, secret: OTPAuth.Secret.fromBase32(secret) });
      await db().query(
        "UPDATE pms_staff_users SET totp_secret=$1,totp_confirmed_at=NULL,recovery_codes_json='[]',updated_at=$2 WHERE owner_id=$3 AND id=$4",
        [encryptField(secret, documentKey()), Date.now(), user.ownerId, user.id],
      );
      const uri = totp.toString();
      const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
      return Response.json({ ok: true, secret, uri, qrDataUrl });
    }
    const stored = String(row.totp_secret || "");
    const secret = stored.startsWith("v1.") ? decryptField(stored, documentKey()) : stored;
    if (!secret || !verifyTotp(secret, body.code)) return Response.json({ ok: false, error: "INVALID_CODE" }, { status: 400 });
    if (body.action === "confirm") {
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(6).toString("hex").toUpperCase());
      await db().query(
        "UPDATE pms_staff_users SET totp_confirmed_at=$1,recovery_codes_json=$2,updated_at=$1 WHERE owner_id=$3 AND id=$4",
        [Date.now(), JSON.stringify(recoveryCodes.map(hashToken)), user.ownerId, user.id],
      );
      return Response.json({ ok: true, recoveryCodes });
    }
    if (!(await verifyPassword(row.password_hash, body.password))) return Response.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 400 });
    await db().query(
      "UPDATE pms_staff_users SET totp_secret='',totp_confirmed_at=NULL,recovery_codes_json='[]',updated_at=$1 WHERE owner_id=$2 AND id=$3",
      [Date.now(), user.ownerId, user.id],
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof z.ZodError ? "INVALID_INPUT" : "TWO_FACTOR_FAILED" }, { status: 400 });
  }
}

export const POST = audited("two_factor", handlePOST);
