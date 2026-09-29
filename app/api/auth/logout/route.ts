import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sessionCookieName } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { hashToken } from "@/lib/security/tokens";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const store = await cookies();
    const token = store.get(sessionCookieName)?.value;
    if (token) {
      await db().query("UPDATE pms_sessions SET revoked_at = $1 WHERE owner_id = $2 AND token_hash = $3", [Date.now(), env().PMS_OWNER_ID, hashToken(token)]);
    }
    store.set(sessionCookieName, "", { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 403 });
  }
}
