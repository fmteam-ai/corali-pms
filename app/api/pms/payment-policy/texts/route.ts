import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const text = z.string().trim().max(8000);
const input = z.object({ texts: z.object({ el: text, en: text, fr: text, de: text, it: text, es: text }) });

async function current(ownerId: string) {
  return (await db().query(`SELECT texts_json FROM booking_policy_texts WHERE owner_id=$1`, [ownerId])).rows[0] ?? null;
}

async function handlePUT(request: Request) {
  const u = await requireApiUser("pricing.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    await db().query(
      `INSERT INTO booking_policy_texts(owner_id,texts_json,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET texts_json=$2,updated_by=$3,updated_at=$4`,
      [u.ownerId, JSON.stringify(x.texts), u.id, Date.now()],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const PUT = audited("booking_policy_texts", handlePUT, { snapshot: (ownerId) => current(ownerId) });
