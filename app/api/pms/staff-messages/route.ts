import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { hkMessages, readHkMessages, sendHkMessage } from "@/lib/hk-mobile";
import { assertTrustedOrigin } from "@/lib/security/origin";

const id = z.number().int().positive().nullable().default(null);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), body: z.string().trim().min(1).max(500), roomId: id, toStaffId: id, toSpecialtyId: id }),
  z.object({ action: z.literal("read") }),
]);

/** Messages between the front desk and the staff (Corali Staff app and PMS → Housekeeping). */
export async function GET() {
  const u = await requireApiUser("staff.app");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, me: u.id, messages: await hkMessages(u) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("staff.app");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "message") await sendHkMessage(u, x);
    else await readHkMessages(u);
    return Response.json({ ok: true, messages: await hkMessages(u) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m === "INVALID_ROOM" || m === "INVALID_STAFF") return Response.json({ ok: false, error: m }, { status: 400 });
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("hk_message", handlePOST);
