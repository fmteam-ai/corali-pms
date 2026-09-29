// Room photo storage: uploaded photos live in room_photos and rooms.images lists their public URLs in order.
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;
export const MAX_ROOM_PHOTOS = 12;
export const publicPhotoUrl = (id: number) => `/api/public/room-photos/${id}`;
const uploaded = /^\/api\/public\/room-photos\/(\d+)$/;

/** Rewrite rooms.images: uploaded photos in their order, followed by any external image URLs already set. */
export async function syncRoomImages(c: Queryable, ownerId: string, roomId: number) {
  const photos = await c.query(`SELECT id FROM room_photos WHERE owner_id=$1 AND room_id=$2 ORDER BY sort_order,id`, [ownerId, roomId]);
  const room = (await c.query(`SELECT images FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, roomId])).rows[0];
  let current: string[] = [];
  try { current = JSON.parse(room?.images || "[]"); } catch { current = []; }
  const external = current.filter((u) => typeof u === "string" && !uploaded.test(u));
  const images = [...photos.rows.map((p) => publicPhotoUrl(Number(p.id))), ...external];
  await c.query(`UPDATE rooms SET images=$1 WHERE owner_id=$2 AND id=$3`, [JSON.stringify(images), ownerId, roomId]);
  return images;
}

export function photoResponse(row: { mime: string; data_base64: string } | undefined, cache: string) {
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(row.data_base64, "base64"), { headers: { "Content-Type": row.mime, "Cache-Control": cache, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}
