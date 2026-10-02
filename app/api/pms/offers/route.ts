import { z } from "zod";
import { audited } from "@/lib/audit";
import { rulesSnapshot } from "@/lib/audit-snapshots";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

// Special prices & promotions (VikBooking "special prices"): discount or surcharge by period, weekday, room and rate
// plan, optionally shown to guests as a promotion with its own text and booking-window conditions.
const codes = z.array(z.string().trim().min(1).max(120)).max(200);
const days = z.number().int().min(1).max(730).nullable().default(null);
const input = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(120),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  operation: z.enum(["discount", "charge"]),
  adjustmentType: z.enum(["percentage", "fixed"]),
  adjustmentValue: z.number().int().min(0).max(1_000_000),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  roomCodes: codes.default([]),
  ratePlanKeys: codes.default([]),
  minimumStay: z.number().int().min(1).max(365).default(1),
  promotion: z.boolean().default(false),
  promotionText: z.partialRecord(z.enum(["el", "en", "fr", "de", "it", "es"]), z.string().trim().max(600)).default({}),
  lastMinuteDays: days,
  minAdvanceDays: days,
  checkinInSeason: z.boolean().default(false),
  roundInteger: z.boolean().default(false),
  nightsOverrides: z.array(z.object({ nights: z.number().int().min(2).max(365), value: z.number().int().min(0).max(1_000_000) })).max(10).default([]),
  combineOffers: z.boolean().default(true),
  combinePlan: z.boolean().default(true),
  combineDirect: z.boolean().default(true),
  combineCoupons: z.boolean().default(true),
  active: z.boolean().default(true),
});
const removal = z.object({ id: z.number().int().positive() });

function fail(e: unknown) {
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const m = e instanceof Error ? e.message : "";
  if (["INVALID_DATES", "INVALID_PERCENT", "INVALID_WINDOW"].includes(m)) return Response.json({ ok: false, error: m }, { status: 400 });
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
    if (x.endsOn < x.startsOn) throw Error("INVALID_DATES");
    if (x.adjustmentType === "percentage" && x.operation === "discount" && [x.adjustmentValue, ...x.nightsOverrides.map((o) => o.value)].some((v) => v > 100)) throw Error("INVALID_PERCENT");
    if (x.lastMinuteDays && x.minAdvanceDays && x.minAdvanceDays > x.lastMinuteDays) throw Error("INVALID_WINDOW");
    const text = Object.fromEntries(Object.entries(x.promotionText).filter(([, v]) => v));
    const overrides = [...new Map(x.nightsOverrides.map((o) => [o.nights, o])).values()].sort((a, b) => a.nights - b.nights);
    const now = Date.now();
    const values = [x.name, x.startsOn, x.endsOn, x.adjustmentType, x.adjustmentValue, x.operation, x.minimumStay, x.active ? 1 : 0, JSON.stringify(x.weekdays), JSON.stringify(x.roomCodes), JSON.stringify(x.ratePlanKeys), x.promotion ? 1 : 0, JSON.stringify(text), x.lastMinuteDays, x.minAdvanceDays, x.checkinInSeason ? 1 : 0, x.roundInteger ? 1 : 0, JSON.stringify(overrides), now, u.ownerId, x.combineOffers ? 1 : 0, x.combinePlan ? 1 : 0, x.combineDirect ? 1 : 0, x.combineCoupons ? 1 : 0] as const;
    const r = x.id
      ? await db().query(`UPDATE special_prices SET name=$1,starts_on=$2,ends_on=$3,adjustment_type=$4,adjustment_value=$5,operation=$6,minimum_stay=$7,active=$8,weekdays=$9,room_codes=$10,rate_plan_keys=$11,promotion=$12,promotion_text_json=$13,last_minute_days=$14,min_advance_days=$15,checkin_in_season=$16,round_integer=$17,nights_overrides_json=$18,updated_at=$19,combine_offers=$22,combine_plan=$23,combine_direct=$24,combine_coupons=$25 WHERE owner_id=$20 AND id=$21 RETURNING id`, [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10], values[11], values[12], values[13], values[14], values[15], values[16], values[17], values[18], values[19], x.id, values[20], values[21], values[22], values[23]])
      : await db().query(`INSERT INTO special_prices(name,starts_on,ends_on,adjustment_type,adjustment_value,operation,minimum_stay,active,weekdays,room_codes,rate_plan_keys,promotion,promotion_text_json,last_minute_days,min_advance_days,checkin_in_season,round_integer,nights_overrides_json,updated_at,created_at,owner_id,combine_offers,combine_plan,combine_direct,combine_coupons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$20,$21,$22,$23,$24) RETURNING id`, [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10], values[11], values[12], values[13], values[14], values[15], values[16], values[17], values[18], values[19], values[20], values[21], values[22], values[23]]);
    return r.rowCount ? Response.json({ ok: true, id: Number(r.rows[0].id) }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

async function handleDELETE(request: Request) {
  const u = await requireApiUser("pricing.delete");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = removal.parse(await request.json());
    const r = await db().query(`DELETE FROM special_prices WHERE owner_id=$1 AND id=$2`, [u.ownerId, x.id]);
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export const POST = audited("rate_rule", handlePOST, { snapshot: rulesSnapshot });
export const DELETE = audited("rate_rule", handleDELETE, { snapshot: rulesSnapshot });
