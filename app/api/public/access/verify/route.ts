import { z } from "zod";
import { verifyAccess } from "@/lib/access-cards";
import { env } from "@/lib/env";
import { allowAttempt } from "@/lib/request-limit";

const input = z.object({ credential: z.string().max(200), zone: z.string().regex(/^[a-z][a-z0-9_]{1,23}$/), room: z.string().max(20).optional(), reader: z.string().max(60).optional() });

/**
 * Door readers / the lock controller: may this card (the QR or NFC credential) open this door? `zone` is "room" (with
 * the room number in `room`) or a hotel area key such as "gym". Authorization: Bearer <reader key from PMS → Digital keys>.
 */
export async function POST(request: Request) {
  const key = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!key) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await allowAttempt(`access-verify:${ip}`, 600, 60_000, 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const r = await verifyAccess(env().PMS_OWNER_ID, key, parsed.data);
  if (!r) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
