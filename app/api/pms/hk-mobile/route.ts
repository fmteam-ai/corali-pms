import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { hkDay, hkMessages, readHkMessages, sendHkMessage } from "@/lib/hk-mobile";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), body: z.string().trim().min(1).max(500), roomId: z.number().int().positive().nullable().default(null), toStaffId: z.number().int().positive().nullable().default(null) }),
  z.object({ action: z.literal("read") }),
]);

/** Housekeeping day (?day=1) and the reception ↔ housekeeping messages, polled by /hk and the PMS housekeeping page. */
export async function GET(request: Request) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  const withDay = new URL(request.url).searchParams.get("day") === "1";
  const [day, messages] = await Promise.all([withDay ? hkDay(u) : null, hkMessages(u)]);
  return Response.json({ ok: true, me: u.id, ...(day ?? {}), messages }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("housekeeping.read");
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
