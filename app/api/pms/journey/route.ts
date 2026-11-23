import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { automationHealth, confirmJourney, journeyOverview, retryFailedMessages, retryJourney, runJourneyNow } from "@/lib/journey";
import { assertTrustedOrigin } from "@/lib/security/origin";

/** PMS → Ταξίδι πελάτη: stays with their steps, history and the automations' health. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const [stays, health] = await Promise.all([journeyOverview(u.ownerId), automationHealth(u.ownerId)]);
  return Response.json({ ok: true, stays, health }, { headers: { "Cache-Control": "no-store" } });
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("retry"), id: z.number().int().positive() }),
  z.object({ action: z.literal("confirm"), id: z.number().int().positive(), note: z.string().trim().max(300).default("") }),
  z.object({ action: z.literal("retry_messages"), id: z.number().int().positive().optional() }),
]);

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    let info: unknown = null;
    if (x.action === "run") info = await runJourneyNow(u.ownerId, u.id);
    else if (x.action === "retry") info = await retryJourney(u.ownerId, x.id, u.id);
    else if (x.action === "confirm") await confirmJourney(u.ownerId, x.id, { id: u.id, name: u.displayName }, x.note);
    else info = { requeued: await retryFailedMessages(u.ownerId, x.id) };
    const [stays, health] = await Promise.all([journeyOverview(u.ownerId), automationHealth(u.ownerId)]);
    return Response.json({ ok: true, info, stays, health });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m !== "NOT_FOUND") console.error("Journey action failed", e);
    return Response.json({ ok: false, error: m === "NOT_FOUND" ? m : "SAVE_FAILED" }, { status: m === "NOT_FOUND" ? 404 : 500 });
  }
}

export const POST = audited("guest_journey", handlePOST);
