import * as OTPAuth from "otpauth";

export function verifyTotp(secret: string, token: string): boolean {
  if (!secret) return true;
  if (!/^\d{6}$/.test(token)) return false;
  const totp = new OTPAuth.TOTP({
    issuer: "Hotel Corali PMS",
    label: "PMS",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.validate({ token, window: 1 }) !== null;
}
