import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({
  plans: z.array(z.object({
    planKey: z.string().min(1).max(60),
    depositPercent: z.number().int().min(0).max(100).nullable(),
    balanceMode: z.enum(["general", "cancellation_deadline", "days_before", "at_hotel"]),
    balanceDaysBefore: z.number().int().min(0).max(365).nullable(),
    fullPrepayment: z.boolean(),
    cancellationDays: z.number().int().min(0).max(365).nullable().default(null),
    refundPercent: z.number().int().min(0).max(100).nullable().default(null),
    active: z.boolean().optional(),
  })).max(30),
});

async function snapshot(ownerId: string) {
  return (await db().query(`SELECT plan_key,deposit_percent,balance_mode,balance_days_before,full_prepayment,cancellation_days,refund_percent,active FROM rate_plans WHERE owner_id=$1 ORDER BY plan_key`, [ownerId])).rows;
}

async function handlePUT(request: Request) {
  const u = await requireApiUser("pricing.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await withTransaction(async (c) => {
      for (const p of x.plans) {
        await c.query(
          `UPDATE rate_plans SET deposit_percent=$3,balance_mode=$4,balance_days_before=$5,full_prepayment=$6,updated_at=$7,cancellation_days=$8,refund_percent=$9,active=COALESCE($10,active) WHERE owner_id=$1 AND plan_key=$2`,
          [u.ownerId, p.planKey, p.fullPrepayment ? null : p.depositPercent, p.balanceMode, p.balanceMode === "days_before" ? (p.balanceDaysBefore ?? 7) : null, p.fullPrepayment ? 1 : 0, Date.now(), p.fullPrepayment ? null : p.cancellationDays, p.planKey === "non_refundable" || p.fullPrepayment ? null : p.refundPercent, p.active === undefined ? null : p.active ? 1 : 0],
        );
      }
    });
    return Response.json({ ok: true, plans: await snapshot(u.ownerId) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

// Adds the "Partly refundable" rate plan (50% back until 30 days before arrival by default; both editable).
async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const r = await db().query(`INSERT INTO rate_plans(owner_id,plan_key,name,adjustment_percent,payment_policy,active,deposit_percent,balance_mode,full_prepayment,cancellation_days,refund_percent,updated_at) VALUES($1,'partly_refundable','Partly refundable',-5,'flexible',1,50,'general',0,30,50,$2) ON CONFLICT(owner_id,plan_key) DO NOTHING RETURNING id`, [u.ownerId, Date.now()]);
    return r.rowCount ? Response.json({ ok: true, plans: await snapshot(u.ownerId) }) : Response.json({ ok: false, error: "EXISTS" }, { status: 409 });
  } catch {
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("rate_plan_payment_terms", handlePOST, { snapshot: (ownerId) => snapshot(ownerId) });
export const PUT = audited("rate_plan_payment_terms", handlePUT, { snapshot: (ownerId) => snapshot(ownerId) });
