import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export type SessionClaims = {
  userId: string;
  ownerId: string;
  role: "owner" | "admin" | "reception" | "housekeeping" | "readonly";
  sessionId: string;
};

const encoder = new TextEncoder();

function key(): Uint8Array {
  return encoder.encode(env().SESSION_SECRET);
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ownerId: claims.ownerId, role: claims.role, sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime("8h")
    .setJti(crypto.randomUUID())
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
  if (!payload.sub || typeof payload.ownerId !== "string" || typeof payload.sid !== "string") {
    throw new Error("INVALID_SESSION");
  }
  const role = payload.role;
  if (!['owner', 'admin', 'reception', 'housekeeping', 'readonly'].includes(String(role))) {
    throw new Error("INVALID_SESSION_ROLE");
  }
  return {
    userId: payload.sub,
    ownerId: payload.ownerId,
    role: role as SessionClaims["role"],
    sessionId: payload.sid,
  };
}
