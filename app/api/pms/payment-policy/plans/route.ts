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
  })).max(30),
});

async function snapshot(ownerId: string) {
  return (await db().query(`SELECT plan_key,deposit_percent,balance_mode,balance_days_before,full_prepayment,cancellation_days FROM rate_plans WHERE owner_id=$1 ORDER BY plan_key`, [ownerId])).rows;
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
          `UPDATE rate_plans SET deposit_percent=$3,balance_mode=$4,balance_days_before=$5,full_prepayment=$6,updated_at=$7,cancellation_days=$8 WHERE owner_id=$1 AND plan_key=$2`,
          [u.ownerId, p.planKey, p.fullPrepayment ? null : p.depositPercent, p.balanceMode, p.balanceMode === "days_before" ? (p.balanceDaysBefore ?? 7) : null, p.fullPrepayment ? 1 : 0, Date.now(), p.fullPrepayment ? null : p.cancellationDays],
        );
      }
    });
    return Response.json({ ok: true, plans: await snapshot(u.ownerId) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const PUT = audited("rate_plan_payment_terms", handlePUT, { snapshot: (ownerId) => snapshot(ownerId) });
