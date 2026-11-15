import { z } from "zod";
import { agentReport } from "@/lib/tv-commands";
import { screenRoom } from "@/lib/tv-messages";

const input = z.object({
  id: z.number().int().positive(),
  status: z.enum(["EXECUTED", "FAILED"]),
  interactive: z.boolean().optional(),
  error: z.string().max(120).optional(),
  volume: z.number().int().min(0).max(100).optional(),
  muted: z.boolean().optional(),
  fixed: z.boolean().optional(),
});
const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** Corali TV app ≥ 1.8: result of a command, with the screen / sound state it read back afterwards (applied once). */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID" }, { status: 400, headers: noStore });
  try {
    const room = await screenRoom(token);
    if (!room) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: noStore });
    const status = await agentReport(room.ownerId, room.roomId, parsed.data.id, parsed.data);
    if (!status) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: noStore });
    return Response.json({ ok: true, status }, { headers: noStore });
  } catch (e) {
    console.error("TV command report failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503, headers: noStore });
  }
}
