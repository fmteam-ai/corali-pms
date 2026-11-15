import { screenControl } from "@/lib/tv-power";
import { pendingUrgent, screenRoom } from "@/lib/tv-messages";

/**
 * Light check for the Corali TV app (every 20 seconds in the background): an unseen urgent message, and the screen
 * on / off control (automatic decision + last manual command from PMS → Corali TV).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const pending = await pendingUrgent(token);
    if (pending === undefined) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const room = await screenRoom(token);
    const screen = room ? await screenControl(room.ownerId, room.roomId) : null;
    return Response.json({ ok: true, urgent: pending?.id ?? null, wake: pending?.wake ?? false, screen }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    console.error("TV urgent check failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
}
