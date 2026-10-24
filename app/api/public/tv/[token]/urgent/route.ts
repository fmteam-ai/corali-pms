import { pendingUrgent } from "@/lib/tv-messages";

/** Light check for the Corali TV app (every minute in the background): is there an unseen urgent message? */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const id = await pendingUrgent(token);
    if (id === undefined) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ok: true, urgent: id }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    console.error("TV urgent check failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
}
