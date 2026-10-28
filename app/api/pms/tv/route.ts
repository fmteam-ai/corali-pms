import { randomInt } from "node:crypto";
import { z } from "zod";
import { beachDistances, locateHotel } from "@/lib/beach-distances";
import { nearbyPlaces, placesUsage } from "@/lib/nearby-places";
import { hideList } from "@/lib/tv-nearby-core";
import { validCoord } from "@/lib/beach-distance-core";
import { normalizeBeaches } from "@/lib/tv-beaches";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { newOpaqueToken } from "@/lib/security/tokens";
import { listScreens, loadTvSettings, setupCodeHash, SETUP_CODE_MS } from "@/lib/tv";
import { normalizeTvSettings } from "@/lib/tv-core";
import { loadPowerSettings, roomPowerStates, savePowerSettings, setRoomPower, syncRoomPower } from "@/lib/tv-power";
import { validDeviceId } from "../../../../scripts/tv-power-core.mjs";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("screen"), roomId: z.number().int().positive(), wifiSsid: z.string().trim().max(64).default(""), wifiPassword: z.string().trim().max(64).default(""), active: z.boolean() }),
  z.object({ action: z.literal("regenerate"), roomId: z.number().int().positive() }),
  z.object({ action: z.literal("setupCode"), roomId: z.number().int().positive() }),
  z.object({ action: z.literal("powerSettings"), settings: z.record(z.string(), z.unknown()), authKey: z.string().trim().max(400).default("") }),
  z.object({ action: z.literal("powerDevice"), roomId: z.number().int().positive(), deviceId: z.string().trim().max(64).refine((v) => v === "" || validDeviceId(v)), channel: z.number().int().min(0).max(3).default(0) }),
  z.object({ action: z.literal("power"), roomId: z.number().int().positive(), on: z.boolean() }),
  z.object({ action: z.literal("powerStatus") }),
  z.object({ action: z.literal("nearbyPreview"), refresh: z.boolean().default(false) }),
  z.object({ action: z.literal("locateHotel"), query: z.string().trim().max(150).default("") }),
  z.object({ action: z.literal("beachDistances"), beaches: z.array(z.record(z.string(), z.unknown())).max(60), hotelLat: z.number(), hotelLon: z.number() }),
]);

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, settings: await loadTvSettings(u.ownerId), screens: await listScreens(u.ownerId), power: await loadPowerSettings(u.ownerId) });
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
    if (x.action === "nearbyPreview") {
      const t = await loadTvSettings(u.ownerId);
      const n = await nearbyPlaces(u.ownerId, t.nearbyRadiusKm, hideList(t.nearbyHide), { lat: t.hotelLat, lon: t.hotelLon }, x.refresh);
      return Response.json({ ok: true, ...n, places: n.places.map(({ week: _w, ...p }) => p), usage: await placesUsage(u.ownerId) });
    }
    if (x.action === "locateHotel") {
      try { return Response.json({ ok: true, hotel: await locateHotel(u.ownerId, x.query) }); } catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : "FAILED" }); }
    }
    if (x.action === "beachDistances") {
      if (!validCoord(x.hotelLat, x.hotelLon)) return Response.json({ ok: false, error: "NO_HOTEL" });
      try { return Response.json({ ok: true, ...(await beachDistances(u.ownerId, normalizeBeaches(x.beaches), { lat: x.hotelLat, lon: x.hotelLon })) }); } catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : "FAILED" }); }
    }
    if (x.action === "powerSettings") {
      const power = await savePowerSettings(u.ownerId, u.id, x.settings, x.authKey);
      return Response.json({ ok: true, power });
    }
    if (x.action === "powerDevice") {
      const r = await db().query(`UPDATE tv_screens SET power_device_id=$1,power_channel=$2,power_auto_state=NULL,power_error='' WHERE owner_id=$3 AND room_id=$4`, [x.deviceId, x.channel, u.ownerId, x.roomId]);
      if (!r.rowCount) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      if (x.deviceId) await syncRoomPower(u.ownerId, x.roomId);
      return Response.json({ ok: true, screens: await listScreens(u.ownerId) });
    }
    if (x.action === "power") {
      const error = await setRoomPower(u.ownerId, x.roomId, x.on);
      return Response.json({ ok: !error, error: error || undefined, screens: await listScreens(u.ownerId) }, { status: error ? 502 : 200 });
    }
    if (x.action === "powerStatus") return Response.json({ ok: true, states: await roomPowerStates(u.ownerId) });
    if (x.action === "setupCode") {
      // One code per room at a time; a new one replaces the previous. Codes still active in other rooms are avoided.
      for (let i = 0; i < 20; i++) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0"), expiresAt = Date.now() + SETUP_CODE_MS;
        const r = await db().query(
          `UPDATE tv_screens SET setup_code_hash=$1,setup_expires_at=$2 WHERE owner_id=$3 AND room_id=$4
           AND NOT EXISTS (SELECT 1 FROM tv_screens o WHERE o.setup_code_hash=$1 AND o.setup_expires_at>$5)`,
          [setupCodeHash(code), expiresAt, u.ownerId, x.roomId, Date.now()],
        );
        if (r.rowCount) return Response.json({ ok: true, code, expiresAt });
        if (!(await db().query(`SELECT 1 FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, x.roomId])).rowCount) break;
      }
      return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
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
