import { requireApiUser } from "@/lib/auth";
import { searchReservations } from "@/lib/reservations";

export async function GET(request: Request) {
  const user = await requireApiUser("reservations.read");
  if (user instanceof Response) return user;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ ok: true, results: [] });
  const results = await searchReservations(user.ownerId, q, 10);
  return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}
