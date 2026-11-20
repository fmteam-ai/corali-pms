import { z } from "zod";
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { guestRoomRequest, guestRoomState } from "@/lib/guest-room";
import { bookingForToken } from "@/lib/guest-self-service";
import { allowAttempt } from "@/lib/request-limit";

const input = z.object({ token: z.string().min(32).max(200), lang: z.string().max(5).default("en"), kind: z.enum(["cleaning", "dnd"]), on: z.boolean().optional() });
const noStore = { "Cache-Control": "no-store" };

/** v176: My booking → «Your room»: do not disturb and «please clean my room» (same records as the room TV). */
export async function GET(request: Request) {
  const url = new URL(request.url), token = url.searchParams.get("token") ?? "";
  if (token.length < 32) return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
  const b = await bookingForToken(db(), token);
  if (!b) return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
  return Response.json({ ok: true, ...(await guestRoomState(env().PMS_OWNER_ID, b, bookingLanguage(url.searchParams.get("lang") ?? "en"))) }, { headers: noStore });
}

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID" }, { status: 400 });
  const x = parsed.data, b = await bookingForToken(db(), x.token);
  if (!b) return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
  if (!(await allowAttempt(`guest-room:${b.id}`, 20, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429 });
  const ownerId = env().PMS_OWNER_ID, lang = bookingLanguage(x.lang);
  try {
    await guestRoomRequest(ownerId, b, x.kind, x.on ?? false);
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (["NOT_IN_HOUSE", "DND_ON", "NO_SCREEN"].includes(code)) return Response.json({ ok: false, error: code, ...(await guestRoomState(ownerId, b, lang)) }, { status: 409, headers: noStore });
    console.error("Guest room request failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
  return Response.json({ ok: true, ...(await guestRoomState(ownerId, b, lang)) }, { headers: noStore });
}
