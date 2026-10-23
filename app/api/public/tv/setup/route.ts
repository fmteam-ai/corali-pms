import { z } from "zod";
import { allowAttempt, clientIp } from "@/lib/request-limit";
import { redeemSetupCode } from "@/lib/tv";

const input = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** Corali TV app: exchange the 6-digit code from PMS → Corali TV for the room's screen link (one use). */
export async function POST(request: Request) {
  // 10 tries per 15 minutes per address, then 30 minutes blocked: guessing a 6-digit code is not practical.
  if (!(await allowAttempt(`tv-setup:${clientIp(request)}`, 10, 15 * 60_000, 30 * 60_000))) {
    return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: noStore });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_CODE" }, { status: 400, headers: noStore });
  try {
    const screen = await redeemSetupCode(parsed.data.code);
    if (!screen) return Response.json({ ok: false, error: "INVALID_CODE" }, { status: 404, headers: noStore });
    return Response.json({ ok: true, ...screen }, { headers: noStore });
  } catch (e) {
    console.error("TV app setup failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503, headers: noStore });
  }
}
