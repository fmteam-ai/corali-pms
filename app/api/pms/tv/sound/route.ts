import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { listScreens } from "@/lib/tv";
import { latestCommands, queueCommand, saveSoundPolicy, soundPolicies } from "@/lib/tv-commands";

/** Corali TV app versionCode that runs sound commands and applies the sound policy (1.9). */
const SOUND_APP = 10;

const rooms = z.array(z.number().int().positive()).min(1).max(200);
const input = z.discriminatedUnion("action", [
  // Reception (reservations.write): volume and mute, one room or several.
  z.object({ action: z.literal("command"), roomIds: rooms, command: z.enum(["SET_VOLUME", "VOLUME_UP", "VOLUME_DOWN", "MUTE", "UNMUTE"]), value: z.number().int().min(0).max(100).optional() }),
  // Owner / admin (integrations.write): power-on volume and maximum volume per room.
  z.object({ action: z.literal("policy"), roomIds: rooms, policy: z.object({ defaultVolume: z.number().int().min(0).max(100).nullable(), maxVolume: z.number().int().min(0).max(100).nullable(), enforceMax: z.boolean() }) }),
]);

/** PMS → Corali TV → Ήχος: per room the reported sound state, capabilities, policy and last command. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, screens: await listScreens(u.ownerId), policies: await soundPolicies(u.ownerId), commands: await latestCommands(u.ownerId), soundApp: SOUND_APP }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const x = parsed.data;
  const u = await requireApiUser(x.action === "policy" ? "integrations.write" : "reservations.write");
  if (u instanceof Response) return u;
  try { assertTrustedOrigin(request); } catch { return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }); }
  if (x.action === "policy") {
    const saved = await saveSoundPolicy(u.ownerId, x.roomIds, x.policy, u.id);
    return Response.json({ ok: true, saved, policies: await soundPolicies(u.ownerId) });
  }
  if (x.command === "SET_VOLUME" && x.value === undefined) return Response.json({ ok: false, error: "VALUE_REQUIRED" }, { status: 400 });
  // Per room: queued, or why not (no app, or an app too old for sound). Queued is not success: the PMS shows the
  // TV's report (EXECUTED only with the volume / mute read back).
  const apps = new Map((await db().query(`SELECT room_id,app_version FROM tv_screens WHERE owner_id=$1 AND active=1`, [u.ownerId])).rows.map((r) => [Number(r.room_id), r.app_version === null ? null : Number(r.app_version)]));
  const results: Record<number, { queued: boolean; id?: number; error?: string }> = {};
  for (const roomId of x.roomIds) {
    const version = apps.get(roomId);
    if (version === undefined) { results[roomId] = { queued: false, error: "NO_SCREEN" }; continue; }
    if (version === null || version < SOUND_APP) { results[roomId] = { queued: false, error: "APP_TOO_OLD" }; continue; }
    const cmd = await queueCommand(u.ownerId, roomId, x.command, "manual", u.id, x.command === "SET_VOLUME" ? x.value ?? null : null);
    results[roomId] = cmd ? { queued: true, id: cmd.id } : { queued: false, error: "NO_SCREEN" };
  }
  return Response.json({ ok: true, results, commands: await latestCommands(u.ownerId) });
}

export const POST = audited("tv_sound", handlePOST);
