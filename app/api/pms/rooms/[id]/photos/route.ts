import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { parsePhoto } from "@/lib/maintenance";
import { MAX_ROOM_PHOTOS, syncRoomImages, uploadedPhotoId } from "@/lib/room-photos";
import { assertTrustedOrigin } from "@/lib/security/origin";

const add = z.object({ photos: z.array(z.string().max(3_500_000)).min(1).max(MAX_ROOM_PHOTOS), applyToType: z.boolean().default(false) });
const order = z.object({ images: z.array(z.string().max(2000)).max(100) });

async function roomId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function fail(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  if (m === "INVALID_PHOTO" || m === "TOO_MANY_PHOTOS") return Response.json({ ok: false, error: m }, { status: 400 });
  if (m === "NOT_FOUND") return Response.json({ ok: false, error: m }, { status: 404 });
  return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
}

/** Upload photos (already resized in the browser); optionally to every room of the same type. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("rooms.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = await roomId(params);
    const x = add.parse(await request.json());
    const photos = x.photos.map(parsePhoto);
    if (photos.some((p) => !p)) throw Error("INVALID_PHOTO");
    const images = await withTransaction(async (c) => {
      const room = (await c.query(`SELECT id,room_type FROM rooms WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, id])).rows[0];
      if (!room) throw Error("NOT_FOUND");
      const targets = x.applyToType ? (await c.query(`SELECT id FROM rooms WHERE owner_id=$1 AND room_type=$2 ORDER BY id`, [u.ownerId, room.room_type])).rows.map((r) => Number(r.id)) : [Number(room.id)];
      for (const target of targets) {
        const existing = (await c.query(`SELECT count(*)::int n, COALESCE(max(sort_order),0)::int last FROM room_photos WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, target])).rows[0];
        if (Number(existing.n) + photos.length > MAX_ROOM_PHOTOS) throw Error("TOO_MANY_PHOTOS");
        let sort = Number(existing.last);
        for (const p of photos) await c.query(`INSERT INTO room_photos(owner_id,room_id,mime,data_base64,byte_size,sort_order,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [u.ownerId, target, p!.mime, p!.base64, p!.bytes, ++sort, u.id, Date.now()]);
        await syncRoomImages(c, u.ownerId, target);
      }
      return syncRoomImages(c, u.ownerId, Number(room.id));
    });
    return Response.json({ ok: true, images });
  } catch (e) {
    return fail(e);
  }
}

/** Reorder (uploaded photos and existing image links): the first image is the cover shown in the booking engine. */
async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("rooms.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = await roomId(params);
    const x = order.parse(await request.json());
    const images = await withTransaction(async (c) => {
      if (!(await c.query(`SELECT 1 FROM rooms WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, id])).rowCount) throw Error("NOT_FOUND");
      const photoIds = x.images.map(uploadedPhotoId).filter((p): p is number => p !== null);
      for (const [i, photoId] of photoIds.entries()) await c.query(`UPDATE room_photos SET sort_order=$4 WHERE owner_id=$1 AND room_id=$2 AND id=$3`, [u.ownerId, id, photoId, i + 1]);
      return syncRoomImages(c, u.ownerId, id!, { order: x.images });
    });
    return Response.json({ ok: true, images });
  } catch (e) {
    return fail(e);
  }
}

async function handleDELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("rooms.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = await roomId(params);
    const query = new URL(request.url).searchParams;
    const photoId = Number(query.get("photoId"));
    // An image link (not an uploaded photo), e.g. one carried over from the old website.
    const link = query.get("url") ?? "";
    const images = await withTransaction(async (c) => {
      if (link) {
        const room = (await c.query(`SELECT images FROM rooms WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, id])).rows[0];
        let current: unknown = [];
        try { current = JSON.parse(room?.images || "[]"); } catch { current = []; }
        if (!room || !Array.isArray(current) || !current.includes(link)) throw Error("NOT_FOUND");
        return syncRoomImages(c, u.ownerId, id!, { remove: link });
      }
      const r = await c.query(`DELETE FROM room_photos WHERE owner_id=$1 AND room_id=$2 AND id=$3`, [u.ownerId, id, photoId]);
      if (!r.rowCount) throw Error("NOT_FOUND");
      return syncRoomImages(c, u.ownerId, id!);
    });
    return Response.json({ ok: true, images });
  } catch (e) {
    return fail(e);
  }
}

export const POST = audited("room_photos", handlePOST);
export const PATCH = audited("room_photos", handlePATCH);
export const DELETE = audited("room_photos", handleDELETE);
