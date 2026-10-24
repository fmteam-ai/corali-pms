import { z } from "zod";
import { markTvMessageSeen } from "@/lib/tv-messages";

const input = z.object({ id: z.number().int().positive() });

/** The guest closed a reception message on the TV (OK button). */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try {
    return Response.json({ ok: await markTvMessageSeen(token, parsed.data.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("TV message seen failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
}
