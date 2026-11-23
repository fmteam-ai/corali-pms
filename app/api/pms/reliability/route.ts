import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { recover, reliabilityState } from "@/lib/reliability";
import { assertTrustedOrigin } from "@/lib/security/origin";

/** PMS → Κέντρο αξιοπιστίας: every service's unfinished or failed work, checked now. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await reliabilityState(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

const input = z.object({ type: z.enum(["retry_outbox", "retry_delivery", "retry_fiscal", "retry_webhook", "sync_now"]), id: z.number().int().positive().nullable().default(null) });

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const queued = await recover(u.ownerId, x.type, x.id);
    return Response.json({ ok: true, queued, ...(await reliabilityState(u.ownerId)) });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("Reliability recovery failed", e);
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("reliability", handlePOST);
