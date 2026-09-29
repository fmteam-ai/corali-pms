import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRangeBound } from "@/lib/direct-pricing";
import { assertTrustedOrigin } from "@/lib/security/origin";

const bound = z.string().refine(isRangeBound);
const input = z.object({
  percent: z.number().int().min(1).max(50),
  validDays: z.number().int().min(7).max(365),
  stayFrom: bound.nullable(),
  stayTo: bound.nullable(),
  blackout: z.array(z.object({ from: bound, to: bound }).refine((r) => r.from.length === r.to.length)).max(20),
}).refine((x) => (x.stayFrom === null) === (x.stayTo === null) && (!x.stayFrom || x.stayFrom.length === x.stayTo!.length));

async function current(ownerId: string) {
  const r = await db().query(`SELECT discount_percent,valid_days,stay_from,stay_to,blackout_json FROM birthday_settings WHERE owner_id=$1`, [ownerId]);
  return r.rows[0] ?? null;
}

export async function GET() {
  const u = await requireApiUser("pricing.read");
  if (u instanceof Response) return u;
  const row = await current(u.ownerId);
  let blackout: unknown = [];
  try { blackout = JSON.parse(row?.blackout_json || "[]"); } catch { blackout = []; }
  return Response.json({ ok: true, percent: Number(row?.discount_percent ?? 10), validDays: Number(row?.valid_days ?? 60), stayFrom: row?.stay_from ?? null, stayTo: row?.stay_to ?? null, blackout });
}

async function handlePUT(request: Request) {
  const u = await requireApiUser("pricing.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await db().query(
      `INSERT INTO birthday_settings(owner_id,discount_percent,valid_days,stay_from,stay_to,blackout_json,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(owner_id) DO UPDATE SET discount_percent=$2,valid_days=$3,stay_from=$4,stay_to=$5,blackout_json=$6,updated_by=$7,updated_at=$8`,
      [u.ownerId, x.percent, x.validDays, x.stayFrom, x.stayTo, JSON.stringify(x.blackout), u.id, Date.now()],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const PUT = audited("birthday_settings", handlePUT, { snapshot: (ownerId) => current(ownerId) });
