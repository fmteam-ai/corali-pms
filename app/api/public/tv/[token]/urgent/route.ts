import { agentCheck } from "@/lib/tv-commands";
import { pendingUrgent, screenRoom } from "@/lib/tv-messages";

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * Light check for the Corali TV app (every 20 seconds in the background): an unseen urgent message and, for apps ≥ 1.8
 * (they send ?s=<screen on 1/0>&v=<versionCode>&a=<screen-off permission 1/0>), the next screen command (once).
 * `screen: null` keeps a 1.7 app from acting on the v157 fields.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const pending = await pendingUrgent(token);
    if (pending === undefined) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: noStore });
    const q = new URL(request.url).searchParams;
    const flag = (k: string) => (q.get(k) === "1" ? true : q.get(k) === "0" ? false : null);
    const v = Number(q.get("v"));
    const room = await screenRoom(token);
    const command = room ? await agentCheck(room.ownerId, room.roomId, { interactive: flag("s"), version: Number.isInteger(v) && v > 0 && v < 100000 ? v : null, admin: flag("a") }) : null;
    return Response.json({ ok: true, urgent: pending?.id ?? null, wake: pending?.wake ?? false, screen: null, command }, { headers: noStore });
  } catch (e) {
    console.error("TV urgent check failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503, headers: noStore });
  }
}
