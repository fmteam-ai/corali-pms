import { createHash, randomBytes } from "node:crypto";

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashNetworkValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
