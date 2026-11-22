// v184 department POS keys (server only: node:crypto).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A department POS key: cpos_<8-char id>_<secret>. Only the SHA-256 of the whole key is stored. */
export function newPosKey() {
  const prefix = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 8).padEnd(8, "0");
  const key = `cpos_${prefix}_${randomBytes(30).toString("base64url")}`;
  return { key, prefix, hash: posKeyHash(key) };
}
export const posKeyHash = (key) => createHash("sha256").update(String(key)).digest("hex");
export function parsePosKey(header) {
  const m = /^(?:Bearer\s+)?(cpos_([a-z0-9]{8})_[A-Za-z0-9_-]{32,64})$/.exec(String(header ?? "").trim());
  return m ? { key: m[1], prefix: m[2] } : null;
}
export function samePosHash(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

