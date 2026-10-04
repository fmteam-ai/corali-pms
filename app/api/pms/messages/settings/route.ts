import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { anthropicApiKey } from "@/lib/provider-connections";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const row = (await db().query(`SELECT ai_auto_reply FROM message_automation_settings WHERE owner_id=$1`, [u.ownerId])).rows[0];
  return Response.json({ ok: true, aiAutoReply: Number(row?.ai_auto_reply ?? 0) === 1, aiConfigured: Boolean(await anthropicApiKey(u.ownerId)) });
}

const input = z.object({ aiAutoReply: z.boolean() });
async function handlePUT(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  if (!can(u.role, "integrations.write", u.permissions)) return forbidden(u, "integrations.write");
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await db().query(`INSERT INTO message_automation_settings(owner_id,ai_auto_reply,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET ai_auto_reply=$2`, [u.ownerId, x.aiAutoReply ? 1 : 0, Date.now()]);
    return Response.json({ ok: true, aiAutoReply: x.aiAutoReply });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}
export const PUT = audited("message_settings", handlePUT);
