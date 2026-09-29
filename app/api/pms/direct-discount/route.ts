import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ percent: z.number().int().min(0).max(50), active: z.boolean() });

async function current(ownerId: string) {
  const r = await db().query(`SELECT direct_discount_percent,direct_discount_active FROM revenue_settings WHERE owner_id=$1`, [ownerId]);
  return r.rows[0] ?? null;
}

export async function GET() {
  const u = await requireApiUser("pricing.read");
  if (u instanceof Response) return u;
  const row = await current(u.ownerId);
  return Response.json({ ok: true, percent: Number(row?.direct_discount_percent ?? 5), active: row ? Number(row.direct_discount_active) === 1 : true });
}

async function handlePUT(request: Request) {
  const u = await requireApiUser("pricing.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await db().query(
      `INSERT INTO revenue_settings(owner_id,direct_discount_percent,direct_discount_active,updated_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(owner_id) DO UPDATE SET direct_discount_percent=$2,direct_discount_active=$3,updated_at=$4`,
      [u.ownerId, x.percent, x.active ? 1 : 0, Date.now()],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const PUT = audited("direct_discount", handlePUT, { snapshot: (ownerId) => current(ownerId) });
