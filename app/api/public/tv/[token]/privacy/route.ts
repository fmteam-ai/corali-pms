import { screenRoom } from "@/lib/tv-messages";
import { agentPrivacyReport } from "@/lib/tv-privacy";

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * v162: the Corali TV app (≥ 1.13) reports one check-out clearing run of its own TV: per-app results, guest apps,
 * cache, and the COUNTS of guest Google accounts / profiles / Bluetooth pairings it found (never names). The lease
 * from the urgent check proves it is the run the PMS handed out; the screen token limits it to its own room.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (Number(request.headers.get("content-length") || 0) > 16384) return Response.json({ ok: false, error: "TOO_LARGE" }, { status: 413, headers: noStore });
  const room = await screenRoom(token);
  if (!room) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: noStore });
  const data = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return Response.json({ ok: false, error: "BAD_REQUEST" }, { status: 400, headers: noStore });
  try {
    const r = await agentPrivacyReport(room.ownerId, room.roomId, data);
    return Response.json(r, { status: r.ok ? 200 : 409, headers: noStore });
  } catch (e) {
    console.error("TV privacy report failed", String((e as Error)?.message ?? e).slice(0, 120));
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503, headers: noStore });
  }
}
