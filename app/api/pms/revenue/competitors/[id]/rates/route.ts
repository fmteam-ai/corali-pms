import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { parseManualRates } from "@/lib/rate-shopper";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("pricing.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = Number((await params).id), { text } = z.object({ text: z.string().max(20000) }).parse(await request.json());
    const rows = parseManualRates(text);
    if (!rows.length) return Response.json({ ok: false, error: "NO_RATES" }, { status: 400 });
    const saved = await withTransaction(async (c) => {
      const found = await c.query(`SELECT id FROM competitors WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
      if (!found.rowCount) throw Error("NOT_FOUND");
      const now = Date.now();
      for (const r of rows) {
        await c.query(
          `INSERT INTO competitor_rates(owner_id,competitor_id,stay_date,rate_cents,sold_out,source,captured_at) VALUES($1,$2,$3,$4,$5,'manual',$6)
           ON CONFLICT(owner_id,competitor_id,stay_date) DO UPDATE SET previous_rate_cents=CASE WHEN competitor_rates.rate_cents IS DISTINCT FROM EXCLUDED.rate_cents THEN competitor_rates.rate_cents ELSE competitor_rates.previous_rate_cents END,
             rate_cents=EXCLUDED.rate_cents,sold_out=EXCLUDED.sold_out,source='manual',captured_at=EXCLUDED.captured_at`,
          [u.ownerId, id, r.date, r.rateCents, r.soldOut ? 1 : 0, now],
        );
      }
      return rows.length;
    });
    return Response.json({ ok: true, saved });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (e instanceof Error && e.message === "NOT_FOUND") return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("competitor_rates", handlePOST);
