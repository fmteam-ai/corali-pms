import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { irAc, irRooms, irSettings, irTvPower, listIrRemotes, saveIrSettings, setIrRoom } from "@/lib/room-ir";
import { assertTrustedOrigin } from "@/lib/security/origin";

const roomId = z.number().int().positive();
const tuyaId = z.string().trim().max(64).refine((v) => v === "" || /^[A-Za-z0-9_-]{6,64}$/.test(v));
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("room"), roomId, hubId: tuyaId, acRemoteId: tuyaId, tvRemoteId: tuyaId }),
  z.object({ action: z.literal("settings"), auto: z.boolean(), mode: z.number().int().min(0).max(4), temp: z.number().int().min(16).max(30), wind: z.number().int().min(0).max(3) }),
  z.object({ action: z.literal("remotes"), hubId: tuyaId.refine((v) => v !== "") }),
  z.object({ action: z.literal("ac"), roomId, on: z.boolean() }),
  z.object({ action: z.literal("tv"), roomId }),
]);

async function state(ownerId: string) {
  return { settings: await irSettings(ownerId), rooms: await irRooms(ownerId) };
}

export async function GET() {
  const u = await requireApiUser("rooms.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await state(u.ownerId)) });
}

/** v170: IR hubs — set-up (rooms.write), finding the remotes (rooms.read), A/C on / off and TV power (housekeeping.write). */
async function handlePOST(request: Request) {
  const raw = await request.clone().json().catch(() => null);
  const action = String(raw?.action);
  const u = await requireApiUser(action === "room" || action === "settings" ? "rooms.write" : action === "remotes" ? "rooms.read" : "housekeeping.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "remotes") {
      const r = await listIrRemotes(u.ownerId, x.hubId);
      return Response.json({ ok: !r.error, error: r.error || undefined, remotes: r.remotes }, { status: r.error ? 502 : 200 });
    }
    let error = "";
    if (x.action === "room") await setIrRoom(u.ownerId, x.roomId, x);
    else if (x.action === "settings") await saveIrSettings(u.ownerId, u.id, x);
    else if (x.action === "ac") error = await irAc(u.ownerId, x.roomId, x.on, `PMS ${u.id}`);
    else error = await irTvPower(u.ownerId, x.roomId);
    return Response.json({ ok: !error, error: error || undefined, ...(await state(u.ownerId)) }, { status: error ? 502 : 200 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("room_ir", handlePOST);
