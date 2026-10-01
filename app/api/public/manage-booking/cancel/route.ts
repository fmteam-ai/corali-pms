import { z } from "zod";
import { cancelBooking } from "@/lib/guest-self-service";

const input = z.object({ token: z.string().min(32).max(200), confirm: z.literal(true) });

/** Guest cancellation within the policy (refund of what was paid only when free cancellation applies). */
export async function POST(request: Request) {
  try {
    const x = input.parse(await request.json());
    const r = await cancelBooking(x.token);
    return Response.json({ ok: true, refundCents: r.refundCents }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    const m = e instanceof Error ? e.message : "";
    if (m === "INVALID_TOKEN") return Response.json({ ok: false, error: m }, { status: 401 });
    if (m === "NOT_ALLOWED") return Response.json({ ok: false, error: m }, { status: 409 });
    console.error("Guest cancellation failed", e);
    return Response.json({ ok: false, error: "CANCEL_FAILED" }, { status: 500 });
  }
}
