import { z } from "zod";
import { allowAttempt } from "@/lib/request-limit";
import { createTvRequest } from "@/lib/tv-requests";
import { transferDestinations, tvProblems, tvRequestKinds } from "@/lib/tv-requests-core";

const input = z.union([
  z.object({ kind: z.literal("dnd"), on: z.boolean() }),
  z.object({ kind: z.literal("taxi"), transfer: z.object({ destination: z.enum(transferDestinations), date: z.iso.date(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), people: z.number().int().min(1).max(12) }).optional() }),
  z.object({ kind: z.literal("problem"), problem: z.enum(tvProblems).optional() }),
  z.object({ kind: z.enum(tvRequestKinds) }),
]);

/** The guest chose a request on the TV (Requests tab): reception gets a PMS notification. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try {
    // A screen link is per room: a few requests per quarter of an hour is plenty for a guest.
    if (!(await allowAttempt(`tv-request:${token}`, 12, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429 });
    const x = parsed.data;
    const r = await createTvRequest(token, x.kind, x.kind === "dnd" ? x.on : undefined, "transfer" in x ? x.transfer : undefined, "problem" in x && x.problem ? { problem: x.problem } : undefined);
    if (!r) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (r.error) return Response.json({ ok: false, error: r.error }, { status: 400 });
    return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("TV request failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
}
