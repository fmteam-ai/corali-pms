import { z } from "zod";
import { normalizeArrivalSettings } from "@/lib/arrival";
import { loadArrivalSettings } from "@/lib/arrival-db";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ settings: z.record(z.string(), z.unknown()) });

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, settings: await loadArrivalSettings(db(), u.ownerId) });
}

async function handlePUT(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const settings = normalizeArrivalSettings(input.parse(await request.json()).settings);
    await db().query(
      `INSERT INTO arrival_settings(owner_id,settings_json,updated_by,updated_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_by=$3,updated_at=$4`,
      [u.ownerId, JSON.stringify(settings), u.id, Date.now()],
    );
    return Response.json({ ok: true, settings });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const PUT = audited("arrival_settings", handlePUT, { snapshot: (ownerId) => loadArrivalSettings(db(), ownerId) });
