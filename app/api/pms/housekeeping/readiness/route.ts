import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { enqueueAvailability } from "@/lib/channel-sync";
import { withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { hotelToday } from "@/lib/tape-chart";

const input = z.object({ blockSameDay: z.boolean(), blockCheckin: z.boolean() });

/** v186: a room not ready is not sold for arrival today / nobody is checked into it (both on by default). */
async function handlePOST(request: Request) {
  const u = await requireApiUser("users.manage");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await withTransaction(async (c) => {
      await c.query(`INSERT INTO room_readiness_settings(owner_id,block_same_day,block_checkin,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET block_same_day=$2,block_checkin=$3,updated_at=$4`, [u.ownerId, x.blockSameDay ? 1 : 0, x.blockCheckin ? 1 : 0, Date.now()]);
      const today = hotelToday();
      await enqueueAvailability(c, u.ownerId, today, today, "room_ready");
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("Room readiness settings failed", e);
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("room_readiness", handlePOST);
