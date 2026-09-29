import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { normalizeLayout, widgetIds } from "@/lib/dashboard-widgets";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ layout: z.array(z.object({ id: z.enum(widgetIds), size: z.union([z.literal(1), z.literal(2), z.literal(3)]), hidden: z.boolean() })).max(40) });

/** Each staff member arranges their own dashboard. */
export async function PUT(request: Request) {
  const u = await requireApiUser("dashboard.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const layout = normalizeLayout(input.parse(await request.json()).layout);
    await db().query(
      `INSERT INTO pms_dashboard_layouts(owner_id,staff_user_id,layout_json,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,staff_user_id) DO UPDATE SET layout_json=$3,updated_at=$4`,
      [u.ownerId, u.id, JSON.stringify(layout), Date.now()],
    );
    return Response.json({ ok: true, layout });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const u = await requireApiUser("dashboard.read");
  if (u instanceof Response) return u;
  assertTrustedOrigin(request);
  await db().query(`DELETE FROM pms_dashboard_layouts WHERE owner_id=$1 AND staff_user_id=$2`, [u.ownerId, u.id]);
  return Response.json({ ok: true, layout: normalizeLayout(null) });
}
