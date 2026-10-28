import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { acLiveStates, acRooms, autoAc, readClimateNow, saveClimateSettings, setAcDevice, setAcEnabled, setClimateDevice, switchAc } from "@/lib/room-ac";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { validDeviceId } from "../../../../scripts/tv-power-core.mjs";

const roomId = z.number().int().positive();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enabled"), enabled: z.boolean(), presence: z.boolean().default(false), awayMinutes: z.number().int().min(5).max(240).default(20) }),
  z.object({ action: z.literal("device"), roomId, deviceId: z.string().trim().max(64).refine((v) => v === "" || validDeviceId(v)), channel: z.number().int().min(0).max(3).default(0), presenceDeviceId: z.string().trim().max(64).refine((v) => v === "" || /^[A-Za-z0-9_-]{6,64}$/.test(v)).default("") }),
  z.object({ action: z.literal("switch"), roomId, on: z.boolean() }),
  z.object({ action: z.literal("auto"), roomId }),
  z.object({ action: z.literal("live") }),
  z.object({ action: z.literal("climate"), roomId, deviceId: z.string().trim().max(64).refine((v) => v === "" || /^[A-Za-z0-9_-]{6,64}$/.test(v)) }),
  z.object({ action: z.literal("climateSettings"), settings: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("climateRead") }),
]);

export async function GET() {
  const u = await requireApiUser("rooms.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await acRooms(u.ownerId)) });
}

/** Room A/C power: set-up (rooms.write) and on / off / automatic (housekeeping.write, also front desk). */
async function handlePOST(request: Request) {
  const raw = await request.clone().json().catch(() => null);
  const setup = ["enabled", "device", "climate", "climateSettings"].includes(String(raw?.action));
  const u = await requireApiUser(setup ? "rooms.write" : raw?.action === "live" || raw?.action === "climateRead" ? "rooms.read" : "housekeeping.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "live") return Response.json({ ok: true, live: await acLiveStates(u.ownerId) });
    let error = "";
    if (x.action === "enabled") await setAcEnabled(u.ownerId, u.id, x);
    else if (x.action === "device") await setAcDevice(u.ownerId, x.roomId, x.deviceId, x.channel, x.presenceDeviceId);
    else if (x.action === "climate") await setClimateDevice(u.ownerId, x.roomId, x.deviceId);
    else if (x.action === "climateSettings") await saveClimateSettings(u.ownerId, u.id, x.settings);
    else if (x.action === "climateRead") await readClimateNow(u.ownerId);
    else if (x.action === "switch") error = await switchAc(u.ownerId, u.id, x.roomId, x.on);
    else await autoAc(u.ownerId, x.roomId);
    return Response.json({ ok: !error, error: error || undefined, ...(await acRooms(u.ownerId)) }, { status: error ? 502 : 200 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("room_ac", handlePOST);
