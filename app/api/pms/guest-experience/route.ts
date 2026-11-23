import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { equipmentChecked, findingAction, guestExperience, turnoverVerified } from "@/lib/guest-experience";
import { assertTrustedOrigin } from "@/lib/security/origin";

/** v193 PMS → Εμπειρία πελάτη: comfort of occupied rooms, turnover after check-out, root causes. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await guestExperience(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("equipment"), bookingId: z.number().int().positive(), roomId: z.number().int().positive(), note: z.string().trim().max(300).default("") }),
  z.object({ action: z.literal("verify"), bookingId: z.number().int().positive() }),
  z.object({ action: z.literal("finding"), key: z.string().min(3).max(200), kind: z.enum(["maintenance", "dismiss"]), reason: z.string().trim().max(300).default("") }),
]);

async function handlePOST(request: Request) {
  const u = await requireApiUser("housekeeping.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    let info: unknown = null;
    if (x.action === "equipment") await equipmentChecked(u.ownerId, x.bookingId, x.roomId, u.displayName || u.username, x.note);
    else if (x.action === "verify") info = await turnoverVerified(u.ownerId, x.bookingId, u.displayName || u.username);
    else {
      if (x.kind === "dismiss" && !x.reason) return Response.json({ ok: false, error: "REASON_REQUIRED" }, { status: 400 });
      info = await findingAction(u.ownerId, x.key, x.kind, u.id, x.reason);
    }
    return Response.json({ ok: true, info, ...(await guestExperience(u.ownerId)) });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("Guest experience action failed", e);
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("guest_experience", handlePOST);
