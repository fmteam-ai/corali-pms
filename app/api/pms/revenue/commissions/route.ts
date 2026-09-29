import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ rows: z.array(z.object({ channel: z.string().trim().min(1).max(40).regex(/^[a-z0-9._-]+$/), commissionPercent: z.number().min(0).max(60), paymentFeePercent: z.number().min(0).max(20) })).max(30) });

async function handlePUT(request: Request) {
  const u = await requireApiUser("pricing.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await withTransaction(async (c) => {
      for (const r of x.rows) {
        await c.query(
          `INSERT INTO channel_commissions(owner_id,channel,commission_percent,payment_fee_percent,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(owner_id,channel) DO UPDATE SET commission_percent=$3,payment_fee_percent=$4,updated_by=$5,updated_at=$6`,
          [u.ownerId, r.channel, r.commissionPercent, r.paymentFeePercent, u.id, Date.now()],
        );
      }
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const PUT = audited("channel_commissions", handlePUT);
