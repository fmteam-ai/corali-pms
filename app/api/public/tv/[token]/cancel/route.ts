import { z } from "zod";
import { allowAttempt } from "@/lib/request-limit";
import { cancelTvRequest } from "@/lib/tv-requests";

const input = z.object({ id: z.number().int().positive() });

/** The guest cancels one of their open requests on the TV (Requests tab → My requests). */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try {
    if (!(await allowAttempt(`tv-cancel:${token}`, 12, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429 });
    const r = await cancelTvRequest(token, parsed.data.id);
    if (r === null) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (!r) return Response.json({ ok: false, error: "NOT_OPEN" }, { status: 409 });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("TV request cancel failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
}
