import type { PoolClient } from "pg";
import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { enqueueAvailability } from "@/lib/channel-sync";
import { db, withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";
import { addDays, hotelToday } from "@/lib/tape-chart";

const fields = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[\p{L}\p{N} ._-]+$/u),
  roomType: z.string().trim().min(2).max(60),
  capacity: z.number().int().min(1).max(20),
  baseRateCents: z.number().int().min(0).max(10_000_00),
  categoryId: z.number().int().positive().nullable().default(null),
  description: z.string().trim().max(3000).default(""),
  active: z.boolean().default(true),
});

async function snapshot(ownerId: string, body: Record<string, unknown>) {
  const id = Number(body?.id);
  return id ? (await db().query(`SELECT id,code,room_type,capacity,base_rate_cents,category_id,active FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0] ?? null : null;
}

function failure(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  if (m.includes("idx_rooms_owner_code")) return Response.json({ ok: false, error: "ROOM_CODE_EXISTS" }, { status: 409 });
  if (["INVALID_CATEGORY", "NOT_FOUND", "HAS_BOOKINGS"].includes(m)) return Response.json({ ok: false, error: m }, { status: m === "NOT_FOUND" ? 404 : 409 });
  return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
}

async function checkCategory(c: Pick<PoolClient, "query">, ownerId: string, categoryId: number | null) {
  if (categoryId && !(await c.query(`SELECT 1 FROM room_categories WHERE owner_id=$1 AND id=$2`, [ownerId, categoryId])).rowCount) throw Error("INVALID_CATEGORY");
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("rooms.create");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = fields.parse(await request.json());
    const room = await withTransaction(async (c) => {
      await checkCategory(c, u.ownerId, x.categoryId);
      const r = await c.query(
        `INSERT INTO rooms(owner_id,code,room_type,capacity,base_rate_cents,category_id,description,active,operational_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'dirty') RETURNING *`,
        [u.ownerId, x.code, x.roomType, x.capacity, x.baseRateCents, x.categoryId, x.description, x.active ? 1 : 0],
      );
      const today = hotelToday();
      await enqueueAvailability(c, u.ownerId, today, addDays(today, 365), "room_added");
      return r.rows[0];
    });
    return Response.json({ ok: true, room }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

async function handlePATCH(request: Request) {
  const u = await requireApiUser("rooms.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const body = await request.json();
    const id = z.number().int().positive().parse(body?.id);
    const x = fields.parse(body);
    const room = await withTransaction(async (c) => {
      await checkCategory(c, u.ownerId, x.categoryId);
      const r = await c.query(
        `UPDATE rooms SET code=$3,room_type=$4,capacity=$5,base_rate_cents=$6,category_id=$7,description=$8,active=$9 WHERE owner_id=$1 AND id=$2 RETURNING *`,
        [u.ownerId, id, x.code, x.roomType, x.capacity, x.baseRateCents, x.categoryId, x.description, x.active ? 1 : 0],
      );
      if (!r.rowCount) throw Error("NOT_FOUND");
      const today = hotelToday();
      await enqueueAvailability(c, u.ownerId, today, addDays(today, 365), "room_changed");
      return r.rows[0];
    });
    return Response.json({ ok: true, room });
  } catch (e) {
    return failure(e);
  }
}

/** Rooms with reservation history cannot be deleted (reports and folios refer to them); deactivate them instead. */
async function handleDELETE(request: Request) {
  const u = await requireApiUser("rooms.read");
  if (u instanceof Response) return u;
  if (!can(u.role, "rooms.delete", u.permissions)) return forbidden(u, "rooms.delete");
  try {
    assertTrustedOrigin(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    await withTransaction(async (c) => {
      const used = await c.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 LIMIT 1`, [u.ownerId, id]);
      const notices = await c.query(`SELECT 1 FROM maintenance_notices WHERE owner_id=$1 AND room_id=$2 LIMIT 1`, [u.ownerId, id]);
      if (used.rowCount || notices.rowCount) throw Error("HAS_BOOKINGS");
      await c.query(`DELETE FROM room_amenity_assignments WHERE room_id=$1 AND room_id IN (SELECT id FROM rooms WHERE owner_id=$2)`, [id, u.ownerId]);
      await c.query(`DELETE FROM housekeeping_staff_room_defaults WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, id]);
      await c.query(`DELETE FROM housekeeping_tasks WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, id]);
      const r = await c.query(`DELETE FROM rooms WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
      if (!r.rowCount) throw Error("NOT_FOUND");
      const today = hotelToday();
      await enqueueAvailability(c, u.ownerId, today, addDays(today, 365), "room_removed");
    });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export const POST = audited("room", handlePOST);
export const PATCH = audited("room", handlePATCH, { snapshot: (ownerId, body) => snapshot(ownerId, body) });
export const DELETE = audited("room", handleDELETE);
