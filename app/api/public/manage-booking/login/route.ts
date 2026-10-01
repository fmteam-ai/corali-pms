import { z } from "zod";
import { loginWithReference } from "@/lib/guest-self-service";
import { allowAttempt, clientIp } from "@/lib/request-limit";

const input = z.object({ reference: z.string().trim().min(3).max(40), email: z.string().trim().email().max(200) });

/** Guest sign-in with booking number + email. Limited per IP and per booking number; one generic error for any mismatch. */
export async function POST(request: Request) {
  try {
    const x = input.parse(await request.json());
    const ip = clientIp(request);
    const allowed = (await allowAttempt(`guest-login:ip:${ip}`, 20, 15 * 60_000, 15 * 60_000)) && (await allowAttempt(`guest-login:ref:${x.reference.toUpperCase()}`, 8, 15 * 60_000, 30 * 60_000));
    if (!allowed) return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: { "Cache-Control": "no-store" } });
    const token = await loginWithReference(x.reference, x.email);
    if (!token) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("Guest login failed", e);
    return Response.json({ ok: false, error: "LOGIN_FAILED" }, { status: 500 });
  }
}
