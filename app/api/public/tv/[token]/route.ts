import { tvScreenData } from "@/lib/tv";

/** Data for a room's welcome screen (polled by the TV). Unknown or disabled links get 404. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const data = await tvScreenData(token, new URL(request.url).searchParams.get("lang"));
    if (!data) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    console.error("TV screen failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
