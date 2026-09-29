import { z } from "zod";
import { audited } from "@/lib/audit";
import { seasonRateSnapshot } from "@/lib/audit-snapshots";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

// Season prices (nightly price per period) for every room, one room type or specific rooms.
const input = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().max(120).default(""),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  roomType: z.string().trim().max(60).nullable().default(null),
  roomCodes: z.array(z.string().trim().min(1).max(20)).max(200).default([]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  priceCents: z.number().int().min(0).max(100_000_00),
  active: z.boolean().default(true),
});
const remove = z.object({ id: z.number().int().positive() });

function fail(e: unknown) {
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const m = e instanceof Error ? e.message : "";
  if (m === "INVALID_DATES" || m === "UNKNOWN_ROOM") return Response.json({ ok: false, error: m }, { status: 400 });
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
    if (x.endsOn < x.startsOn || x.endsOn > "2100-01-01") throw Error("INVALID_DATES");
    const codes = [...new Set(x.roomCodes)];
    if (codes.length) {
      const known = await db().query(`SELECT count(*)::int n FROM rooms WHERE owner_id=$1 AND code = ANY($2::text[])`, [u.ownerId, codes]);
      if (Number(known.rows[0].n) !== codes.length) throw Error("UNKNOWN_ROOM");
    }
    const roomType = codes.length ? null : x.roomType || null;
    const weekdays = JSON.stringify([...new Set(x.weekdays)].sort());
    const active = x.active ? 1 : 0, now = Date.now();
    const r = x.id
      ? await db().query(`UPDATE rate_rules SET name=$1,starts_on=$2,ends_on=$3,room_type=$4,room_codes=$5,weekdays=$6,price_cents=$7,active=$8,updated_at=$9 WHERE owner_id=$10 AND id=$11 RETURNING id`, [x.name, x.startsOn, x.endsOn, roomType, JSON.stringify(codes), weekdays, x.priceCents, active, now, u.ownerId, x.id])
      : await db().query(`INSERT INTO rate_rules(name,starts_on,ends_on,room_type,room_codes,weekdays,price_cents,active,updated_at,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [x.name, x.startsOn, x.endsOn, roomType, JSON.stringify(codes), weekdays, x.priceCents, active, now, u.ownerId]);
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
    const r = await db().query(`DELETE FROM rate_rules WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export const POST = audited("season_rate", handlePOST, { snapshot: seasonRateSnapshot });
export const DELETE = audited("season_rate", handleDELETE, { snapshot: seasonRateSnapshot });
