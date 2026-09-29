import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueAvailability } from "@/lib/channel-sync";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { addDays, hotelToday } from "@/lib/tape-chart";
import { channelStatus } from "@/lib/channel-sync";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), roomType: z.string().min(1).max(120), externalId: z.string().trim().max(120) }),
  z.object({ action: z.literal("full_sync") }),
]);

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await channelStatus(u.ownerId)) });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "map") {
      if (x.externalId) await db().query(`INSERT INTO channel_room_mappings(owner_id,room_type,external_room_type_id,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,room_type) DO UPDATE SET external_room_type_id=$3,updated_at=$4`, [u.ownerId, x.roomType, x.externalId, Date.now()]);
      else await db().query(`DELETE FROM channel_room_mappings WHERE owner_id=$1 AND room_type=$2`, [u.ownerId, x.roomType]);
    } else {
      const today = hotelToday();
      await enqueueAvailability(db(), u.ownerId, today, addDays(today, 500), "full_sync");
    }
    return Response.json({ ok: true, ...(await channelStatus(u.ownerId)) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("channel_sync", handlePOST);
