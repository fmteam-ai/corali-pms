import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { revokeSession } from "@/lib/login-history";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

const input = z.object({ action: z.literal("revoke"), sessionId: z.number().int().positive() });

/** PMS → Ιστορικό συνδέσεων → «Τερματισμός»: sign a session out remotely. */
async function handlePOST(request: Request) {
  const u = await requireApiUser("audit.read");
  if (u instanceof Response) return u;
  if (!can(u.role, "users.manage", u.permissions)) return forbidden(u, "users.manage");
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    return Response.json({ ok: await revokeSession(u.ownerId, x.sessionId) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "FAILED" }, { status: 400 });
  }
}

export const POST = audited("pms_sessions", handlePOST);
