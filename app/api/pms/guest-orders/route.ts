import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { confirmOrder, declineOrder, listOrders } from "@/lib/guest-orders";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), id: z.number().int().positive() }),
  z.object({ action: z.literal("decline"), id: z.number().int().positive(), reason: z.string().trim().max(300).default("") }),
]);
const errors: Record<string, number> = { NOT_FOUND: 404, ALREADY_HANDLED: 409, BOOKING_CLOSED: 409, NO_ROOM: 409 };

/** Guest requests from "My booking" / online check-in (PMS → Guest orders, Corali Staff → Reception). */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, orders: await listOrders(u.ownerId) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("folios.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "confirm") await confirmOrder(u.ownerId, x.id, u.id);
    else await declineOrder(u.ownerId, x.id, u.id, x.reason);
    return Response.json({ ok: true, orders: await listOrders(u.ownerId) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
  }
}

export const POST = audited("guest_order", handlePOST);
