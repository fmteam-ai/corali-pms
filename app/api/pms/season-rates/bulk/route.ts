import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { bulkPricePlan, type SeasonRule } from "@/lib/season-rates";

// Bulk price update: one nightly price for a date range (optionally some weekdays) for categories and/or rooms.
const input = z.object({
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  roomTypes: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  roomCodes: z.array(z.string().trim().min(1).max(20)).max(300).default([]),
  priceCents: z.number().int().min(100).max(100_000_00),
});

async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.edit");
  if (u instanceof Response) return u;
  if (!can(u.role, "pricing.create", u.permissions)) return forbidden(u, "pricing.create");
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.endsOn < x.startsOn || x.endsOn > "2100-01-01") return Response.json({ ok: false, error: "INVALID_DATES" }, { status: 400 });
    if (!x.roomTypes.length && !x.roomCodes.length) return Response.json({ ok: false, error: "NOTHING_SELECTED" }, { status: 400 });
    const result = await withTransaction(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('rate_rules:' || $1))`, [u.ownerId]);
      const rooms = (await c.query(`SELECT code,room_type FROM rooms WHERE owner_id=$1`, [u.ownerId])).rows;
      const typeOf = new Map(rooms.map((r) => [String(r.code), String(r.room_type)]));
      const types = [...new Set(x.roomTypes)], wanted = [...new Set(x.roomCodes)];
      if (types.some((t) => !rooms.some((r) => r.room_type === t)) || wanted.some((code) => !typeOf.has(code))) throw Error("UNKNOWN_ROOM");
      // Rooms of a selected category are already covered by the category's price.
      const codes = wanted.filter((code) => !types.includes(typeOf.get(code)!));
      const existing = (await c.query(`SELECT id,name,room_type,room_codes,weekdays,starts_on,ends_on,price_cents,active,updated_at FROM rate_rules WHERE owner_id=$1 AND price_cents IS NOT NULL AND active=1 AND source<>'auto' AND starts_on<=$3 AND ends_on>=$2 FOR UPDATE`, [u.ownerId, x.startsOn, x.endsOn])).rows as SeasonRule[];
      const label = `${x.startsOn.split("-").reverse().join("/")}–${x.endsOn.split("-").reverse().join("/")}`;
      const plan = bulkPricePlan(existing, { roomTypes: types, roomCodes: codes, codesOfTypes: rooms.filter((r) => types.includes(String(r.room_type))).map((r) => String(r.code)) }, x.startsOn, x.endsOn, x.weekdays, x.priceCents, `Μαζική ενημέρωση ${label}`);
      if (plan.deleteIds.length) await c.query(`DELETE FROM rate_rules WHERE owner_id=$1 AND id=ANY($2::bigint[])`, [u.ownerId, plan.deleteIds]);
      const now = Date.now();
      for (const [i, r] of plan.inserts.entries()) {
        // Remnants keep their age; the new prices are the latest edit.
        const isNew = i >= plan.inserts.length - types.length - (codes.length ? 1 : 0);
        await c.query(`INSERT INTO rate_rules(name,starts_on,ends_on,room_type,room_codes,weekdays,price_cents,active,updated_at,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`, [r.name, r.starts_on, r.ends_on, r.room_type, JSON.stringify(r.room_codes), JSON.stringify(r.weekdays), r.price_cents, isNew ? now : now - 1, u.ownerId]);
      }
      return { replaced: plan.deleteIds.length, created: types.length + (codes.length ? 1 : 0) };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (e instanceof Error && e.message === "UNKNOWN_ROOM") return Response.json({ ok: false, error: "UNKNOWN_ROOM" }, { status: 400 });
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("season_rate_bulk", handlePOST);
