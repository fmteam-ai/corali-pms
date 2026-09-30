import { z } from "zod";
import { audited } from "@/lib/audit";
import { minStaySnapshot } from "@/lib/audit-snapshots";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

// Minimum stay per room category (room type): all-year when no dates are given, otherwise for arrivals in the period.
const input = z.object({
  id: z.number().int().positive().optional(),
  roomType: z.string().trim().max(60).nullable().default(null),
  startsOn: z.iso.date().nullable().default(null),
  endsOn: z.iso.date().nullable().default(null),
  minNights: z.number().int().min(1).max(60),
  active: z.boolean().default(true),
});
const remove = z.object({ id: z.number().int().positive() });

function fail(e: unknown) {
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const m = e instanceof Error ? e.message : "";
  if (m === "INVALID_DATES" || m === "UNKNOWN_TYPE") return Response.json({ ok: false, error: m }, { status: 400 });
  return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const permission = x.id ? "pricing.edit" : "pricing.create";
    if (!can(u.role, permission, u.permissions)) return forbidden(u, permission);
    if (Boolean(x.startsOn) !== Boolean(x.endsOn) || (x.startsOn && x.endsOn && x.endsOn < x.startsOn)) throw Error("INVALID_DATES");
    const roomType = x.roomType || null;
    if (roomType && !(await db().query(`SELECT 1 FROM rooms WHERE owner_id=$1 AND room_type=$2 LIMIT 1`, [u.ownerId, roomType])).rowCount) throw Error("UNKNOWN_TYPE");
    const active = x.active ? 1 : 0, now = Date.now();
    const r = x.id
      ? await db().query(`UPDATE min_stay_rules SET room_type=$1,starts_on=$2,ends_on=$3,min_nights=$4,active=$5,updated_at=$6 WHERE owner_id=$7 AND id=$8 RETURNING id`, [roomType, x.startsOn, x.endsOn, x.minNights, active, now, u.ownerId, x.id])
      : await db().query(`INSERT INTO min_stay_rules(room_type,starts_on,ends_on,min_nights,active,updated_at,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [roomType, x.startsOn, x.endsOn, x.minNights, active, now, u.ownerId]);
    if (!r.rowCount) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    return Response.json({ ok: true, id: Number(r.rows[0].id) });
  } catch (e) {
    return fail(e);
  }
}

async function handleDELETE(request: Request) {
  const u = await requireApiUser("pricing.delete");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const { id } = remove.parse(await request.json());
    const r = await db().query(`DELETE FROM min_stay_rules WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export const POST = audited("min_stay", handlePOST, { snapshot: minStaySnapshot });
export const DELETE = audited("min_stay", handleDELETE, { snapshot: minStaySnapshot });
