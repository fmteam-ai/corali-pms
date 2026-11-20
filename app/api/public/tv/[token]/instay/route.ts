import { z } from "zod";
import { db } from "@/lib/db";
import { recordInstay } from "@/lib/instay";
import { instayTopics } from "@/lib/instay-core";
import { allowAttempt } from "@/lib/request-limit";
import { hotelToday } from "@/lib/tape-chart";

const input = z.object({ good: z.boolean(), topics: z.array(z.enum(instayTopics)).max(7).default([]) });
const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** v176: the room TV answers «Is everything all right?» for the guest staying in the room now (once per stay). */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: noStore });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID" }, { status: 400, headers: noStore });
  const today = hotelToday();
  const s = (await db().query(
    `SELECT s.owner_id,(SELECT b.id FROM bookings b WHERE b.owner_id=s.owner_id AND b.room_id=s.room_id AND b.status='checked_in' AND b.check_in<=$2 AND b.check_out>=$2 ORDER BY b.check_in DESC LIMIT 1) AS booking_id
       FROM tv_screens s WHERE s.token=$1 AND s.active=1`,
    [token, today],
  )).rows[0];
  if (!s?.booking_id) return Response.json({ ok: false, error: "NO_GUEST" }, { status: 404, headers: noStore });
  if (!(await allowAttempt(`tv-instay:${s.booking_id}`, 10, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429, headers: noStore });
  const recorded = await recordInstay(String(s.owner_id), Number(s.booking_id), parsed.data.good, parsed.data.topics, "tv");
  return Response.json({ ok: true, recorded }, { headers: noStore });
}
