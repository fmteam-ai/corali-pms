import { requireApiUser } from "@/lib/auth";
import { hkDay } from "@/lib/hk-mobile";

/** Today's housekeeping rooms for the Corali Staff app (Housekeeping section). */
export async function GET() {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, me: u.id, ...(await hkDay(u)) }, { headers: { "Cache-Control": "no-store" } });
}
