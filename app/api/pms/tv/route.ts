import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { newOpaqueToken } from "@/lib/security/tokens";
import { listScreens, loadTvSettings } from "@/lib/tv";
import { normalizeTvSettings } from "@/lib/tv-core";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("screen"), roomId: z.number().int().positive(), wifiSsid: z.string().trim().max(64).default(""), wifiPassword: z.string().trim().max(64).default(""), active: z.boolean() }),
  z.object({ action: z.literal("regenerate"), roomId: z.number().int().positive() }),
]);

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, settings: await loadTvSettings(u.ownerId), screens: await listScreens(u.ownerId) });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "settings") {
      const settings = normalizeTvSettings(x.settings);
      await db().query(`INSERT INTO tv_settings(owner_id,settings_json,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_by=$3,updated_at=$4`, [u.ownerId, JSON.stringify(settings), u.id, Date.now()]);
      return Response.json({ ok: true, settings });
    }
    const r = x.action === "screen"
      ? await db().query(`UPDATE tv_screens SET wifi_ssid=$1,wifi_password=$2,active=$3 WHERE owner_id=$4 AND room_id=$5`, [x.wifiSsid, x.wifiSsid ? x.wifiPassword : "", x.active ? 1 : 0, u.ownerId, x.roomId])
      // A new link stops the old one at once (e.g. a QR card was taken away or a stick is moved to another room).
      : await db().query(`UPDATE tv_screens SET token=$1,last_seen_at=NULL WHERE owner_id=$2 AND room_id=$3`, [newOpaqueToken(), u.ownerId, x.roomId]);
    if (!r.rowCount) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    return Response.json({ ok: true, screens: await listScreens(u.ownerId) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("tv_screens", handlePOST);
