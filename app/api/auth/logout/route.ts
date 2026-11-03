import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sessionCookieName } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { hashToken } from "@/lib/security/tokens";
import { recordAudit } from "@/lib/audit";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const store = await cookies();
    const token = store.get(sessionCookieName)?.value;
    if (token) {
      // "idle": the PMS signed itself out after 2 hours without activity (shown in the sign-in history).
      const reason = (await request.json().catch(() => null))?.reason === "idle" ? "idle" : "logout";
      const r = await db().query("UPDATE pms_sessions SET revoked_at = $1, ended_reason = COALESCE(ended_reason, $4) WHERE owner_id = $2 AND token_hash = $3 AND revoked_at IS NULL RETURNING staff_user_id", [Date.now(), env().PMS_OWNER_ID, hashToken(token), reason]);
      if (r.rows[0]) await recordAudit({ ownerId: env().PMS_OWNER_ID, userId: Number(r.rows[0].staff_user_id) || null, action: reason === "idle" ? "security.logout_idle" : "security.logout", entity: "session" });
    }
    store.set(sessionCookieName, "", { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 403 });
  }
}
