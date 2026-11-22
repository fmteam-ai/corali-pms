import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ rooms: z.array(z.object({ roomId: z.number().int().positive(), staffId: z.number().int().positive().nullable() })).max(500) });

/**
 * v185: PMS → Housekeeping → Αναθέσεις: the second person who approves each room after cleaning. No one set = the
 * manager (anyone with the «housekeeping.inspect» permission) approves.
 */
async function handlePOST(request: Request) {
  const u = await requireApiUser("users.manage");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await withTransaction(async (c) => {
      const staff = new Set((await c.query(`SELECT id FROM pms_staff_users WHERE owner_id=$1 AND active=1`, [u.ownerId])).rows.map((r) => Number(r.id)));
      const rooms = new Set((await c.query(`SELECT id FROM rooms WHERE owner_id=$1`, [u.ownerId])).rows.map((r) => Number(r.id)));
      for (const r of x.rooms) {
        if (!rooms.has(r.roomId) || (r.staffId !== null && !staff.has(r.staffId))) throw Error("NOT_FOUND");
        if (r.staffId === null) await c.query(`DELETE FROM housekeeping_room_inspectors WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, r.roomId]);
        else await c.query(`INSERT INTO housekeeping_room_inspectors(owner_id,room_id,staff_user_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,room_id) DO UPDATE SET staff_user_id=$3,created_at=$4`, [u.ownerId, r.roomId, r.staffId, Date.now()]);
      }
    });
    return Response.json({ ok: true });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m !== "NOT_FOUND") console.error("Inspector settings failed", e);
    return Response.json({ ok: false, error: m === "NOT_FOUND" ? m : "SAVE_FAILED" }, { status: m === "NOT_FOUND" ? 404 : 500 });
  }
}

export const POST = audited("housekeeping_inspectors", handlePOST);
