import { z } from "zod";
import { audited } from "@/lib/audit";
import { couponSnapshot } from "@/lib/audit-snapshots";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeCouponCode } from "@/lib/direct-pricing";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

// Discount coupons (promo codes) the guest types in the booking engine. Birthday codes keep their own purpose.
const range = z.object({ from: z.iso.date(), to: z.iso.date() });
const input = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(3).max(40),
  name: z.string().trim().max(120).default(""),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().int().min(1).max(1_000_000),
  validFrom: z.iso.date(),
  validTo: z.iso.date(),
  stayFrom: z.iso.date().nullable().default(null),
  stayTo: z.iso.date().nullable().default(null),
  blackout: z.array(range).max(20).default([]),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  combinable: z.boolean().default(false),
  restrictedEmail: z.email().max(200).nullable().default(null),
  active: z.boolean().default(true),
});
const removal = z.object({ id: z.number().int().positive() });
const toggle = z.object({ id: z.number().int().positive(), active: z.boolean() });

function fail(e: unknown) {
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const m = e instanceof Error ? e.message : "";
  if (["INVALID_DATES", "INVALID_PERCENT", "INVALID_CODE"].includes(m)) return Response.json({ ok: false, error: m }, { status: 400 });
  if ((e as { code?: string })?.code === "23505") return Response.json({ ok: false, error: "DUPLICATE_CODE" }, { status: 409 });
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
    const code = normalizeCouponCode(x.code);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) throw Error("INVALID_CODE");
    if (x.validTo < x.validFrom || (x.stayFrom && x.stayTo && x.stayTo < x.stayFrom) || x.blackout.some((b) => b.to < b.from)) throw Error("INVALID_DATES");
    if (x.discountType === "percentage" && x.discountValue > 100) throw Error("INVALID_PERCENT");
    const email = x.restrictedEmail ? x.restrictedEmail.trim().toLowerCase() : null;
    const now = Date.now();
    const r = x.id
      ? await db().query(`UPDATE coupons SET code=$1,name=$2,discount_type=$3,discount_value=$4,valid_from=$5,valid_to=$6,stay_from=$7,stay_to=$8,blackout_json=$9,max_uses=$10,combinable=$11,restricted_email=$12,active=$13,updated_at=$14 WHERE owner_id=$15 AND id=$16 AND purpose='general' RETURNING id`, [code, x.name, x.discountType, x.discountValue, x.validFrom, x.validTo, x.stayFrom, x.stayTo, JSON.stringify(x.blackout), x.maxUses, x.combinable ? 1 : 0, email, x.active ? 1 : 0, now, u.ownerId, x.id])
      : await db().query(`INSERT INTO coupons(code,name,discount_type,discount_value,applies_to,valid_from,valid_to,stay_from,stay_to,blackout_json,max_uses,usage_count,combinable,restricted_email,active,purpose,created_at,updated_at,owner_id) VALUES($1,$2,$3,$4,'room_only',$5,$6,$7,$8,$9,$10,0,$11,$12,$13,'general',$14,$14,$15) RETURNING id`, [code, x.name, x.discountType, x.discountValue, x.validFrom, x.validTo, x.stayFrom, x.stayTo, JSON.stringify(x.blackout), x.maxUses, x.combinable ? 1 : 0, email, x.active ? 1 : 0, now, u.ownerId]);
    return r.rowCount ? Response.json({ ok: true, id: Number(r.rows[0].id), code }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

// Quick on/off from the list; also the only change offered for automatic birthday codes.
async function handlePATCH(request: Request) {
  const u = await requireApiUser("pricing.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = toggle.parse(await request.json());
    const r = await db().query(`UPDATE coupons SET active=$1,updated_at=$2 WHERE owner_id=$3 AND id=$4`, [x.active ? 1 : 0, Date.now(), u.ownerId, x.id]);
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
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
    const r = await db().query(`DELETE FROM coupons WHERE owner_id=$1 AND id=$2`, [u.ownerId, x.id]);
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export const POST = audited("coupon", handlePOST, { snapshot: couponSnapshot });
export const PATCH = audited("coupon", handlePATCH, { snapshot: couponSnapshot });
export const DELETE = audited("coupon", handleDELETE, { snapshot: couponSnapshot });
