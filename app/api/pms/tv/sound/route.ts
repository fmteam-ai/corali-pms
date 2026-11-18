import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { listScreens } from "@/lib/tv";
import { latestCommands, queueCommand, resetResults, runReset, saveSoundPolicy, soundPolicies, SOUND_APP } from "@/lib/tv-commands";
import { allowAttempt } from "@/lib/request-limit";
import { loadPowerSettings, savePowerSettings } from "@/lib/tv-power";

const rooms = z.array(z.number().int().positive()).min(1).max(200);
/** Corali TV 1.14 (versionCode 15): reads the menu lock and opens the Factory Menu. */
const FACTORY_MENU_APP = 15;

const input = z.discriminatedUnion("action", [
  // Reception (reservations.write): volume and mute, one room or several.
  z.object({ action: z.literal("command"), roomIds: rooms, command: z.enum(["SET_VOLUME", "VOLUME_UP", "VOLUME_DOWN", "MUTE", "UNMUTE"]), value: z.number().int().min(0).max(100).optional() }),
  // Owner / admin (integrations.write): power-on volume and maximum volume per room.
  z.object({ action: z.literal("policy"), roomIds: rooms, policy: z.object({ defaultVolume: z.number().int().min(0).max(100).nullable(), maxVolume: z.number().int().min(0).max(100).nullable(), enforceMax: z.boolean() }) }),
  // v160 resets: selected rooms only; owner / admin, except «restore_sound» (reception too). Idempotent by key.
  z.object({ action: z.literal("reset_policy"), roomIds: rooms, preset: z.enum(["hotel_default", "no_max_enforcement", "hotel_mode"]), idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }),
  z.object({ action: z.literal("restore_sound"), roomIds: rooms, idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }),
  z.object({ action: z.literal("reset_status"), requestId: z.number().int().positive() }),
  // v163: open the Factory Menu on ONE room's TV for a technician there (owner only, confirmed in the browser).
  z.object({ action: z.literal("factory_menu"), roomId: z.number().int().positive(), confirm: z.literal(true) }),
  // The hotel's preset (owner / admin): what «Επαναφορά προεπιλογών ξενοδοχείου» applies.
  z.object({ action: z.literal("preset"), preset: z.object({ defaultVolume: z.number().int().min(0).max(100), maxVolume: z.number().int().min(0).max(100), enforceMax: z.boolean() }) }),
]);

/** PMS → Corali TV → Ήχος: per room the reported sound state, capabilities, policy and last command. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const { settings } = await loadPowerSettings(u.ownerId);
  return Response.json({ ok: true, screens: await listScreens(u.ownerId), policies: await soundPolicies(u.ownerId), commands: await latestCommands(u.ownerId), soundApp: SOUND_APP, preset: settings.soundPreset, factoryMenuApp: FACTORY_MENU_APP, isOwner: u.role === "owner" }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const x = parsed.data;
  const u = await requireApiUser(x.action === "command" || x.action === "restore_sound" || x.action === "reset_status" ? "reservations.write" : "integrations.write");
  if (u instanceof Response) return u;
  try { assertTrustedOrigin(request); } catch { return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }); }
  if (x.action === "factory_menu") {
    // Owner only. The command opens the TV maker's menu and changes nothing by itself; the technician sets
    // Engineer Mode Option → Lock Menu Key there. Never Hotel Status / other factory settings from the PMS.
    if (u.role !== "owner") return Response.json({ ok: false, error: "OWNER_ONLY" }, { status: 403 });
    const app = (await db().query(`SELECT app_version FROM tv_screens WHERE owner_id=$1 AND room_id=$2 AND active=1`, [u.ownerId, x.roomId])).rows[0];
    if (!app) return Response.json({ ok: false, error: "NO_SCREEN" }, { status: 404 });
    if (app.app_version === null || Number(app.app_version) < FACTORY_MENU_APP) return Response.json({ ok: false, error: "APP_TOO_OLD" }, { status: 409 });
    const cmd = await queueCommand(u.ownerId, x.roomId, "OPEN_FACTORY_MENU", "manual", u.id, null, { ttlMs: 2 * 60_000 });
    return Response.json({ ok: Boolean(cmd), id: cmd?.id, commands: await latestCommands(u.ownerId) });
  }
  if (x.action === "reset_status") {
    const r = await resetResults(u.ownerId, x.requestId);
    return r ? Response.json({ ok: true, requestId: x.requestId, ...r }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (x.action === "preset") {
    const { settings } = await loadPowerSettings(u.ownerId);
    const saved = await savePowerSettings(u.ownerId, u.id, { ...settings, soundPreset: x.preset }, "");
    return Response.json({ ok: true, preset: saved.settings.soundPreset });
  }
  if (x.action === "reset_policy" || x.action === "restore_sound") {
    // A handful of resets per quarter hour per person: enough for real use, no reset loops.
    if (!(await allowAttempt(`tv-reset:${u.ownerId}:${u.id}`, 20, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
    const { settings } = await loadPowerSettings(u.ownerId);
    const action = x.action === "restore_sound" ? "restore_sound" : x.preset;
    const { requestId, repeated } = await runReset(u.ownerId, u.id, action, x.roomIds, x.idempotencyKey, settings.soundPreset);
    // HTTP 200 = accepted and saved, not executed: per room status follows the TVs' reports (reset_status).
    return Response.json({ ok: true, requestId, repeated, ...(await resetResults(u.ownerId, requestId)) });
  }
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
