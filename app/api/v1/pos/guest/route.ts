import { posBad, posGuest, posJson, requirePosKey } from "@/lib/department-sales";

/** GET /api/v1/pos/guest?room=112 — before «charge to room»: the guest's first name and initial, and if it can be charged. */
export async function GET(request: Request) {
  const k = await requirePosKey(request);
  if (k instanceof Response) return k;
  const room = new URL(request.url).searchParams.get("room")?.trim();
  if (!room) return posBad("Send ?room=<room number or booking reference>");
  const g = await posGuest(k, room);
  if (!g) return Response.json({ ok: false, error: "NOT_FOUND", message: "No guest in that room" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return posJson(g);
}
