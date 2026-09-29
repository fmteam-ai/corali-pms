// Room photo storage: uploaded photos live in room_photos and rooms.images lists their public URLs in order.
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;
export const MAX_ROOM_PHOTOS = 12;
export const publicPhotoUrl = (id: number) => `/api/public/room-photos/${id}`;
const uploaded = /^\/api\/public\/room-photos\/(\d+)$/;

export const uploadedPhotoId = (url: string) => Number(url.match(uploaded)?.[1]) || null;

/**
 * Pure: the room's image list after a change. Keeps the current order (uploaded photos and existing image links,
 * e.g. from the old website), drops deleted uploads and appends new uploads. `order` (a permutation of the current
 * list) reorders it; `remove` drops one image link.
 */
export function nextImages(current: unknown[], photoIds: number[], opts: { order?: string[]; remove?: string } = {}): string[] {
  const valid = (u: unknown): u is string => typeof u === "string" && u.trim() !== "" && (uploadedPhotoId(u) === null || photoIds.includes(uploadedPhotoId(u)!));
  let list = [...new Set(current.filter(valid))];
  if (opts.order) {
    const wanted = [...new Set(opts.order)].filter((u) => list.includes(u));
    list = [...wanted, ...list.filter((u) => !wanted.includes(u))];
  }
  if (opts.remove) list = list.filter((u) => u !== opts.remove);
  for (const id of photoIds) if (!list.includes(publicPhotoUrl(id))) list.push(publicPhotoUrl(id));
  return list;
}

/** Rewrite rooms.images from room_photos, keeping the order staff set and any existing image links. */
export async function syncRoomImages(c: Queryable, ownerId: string, roomId: number, opts: { order?: string[]; remove?: string } = {}) {
  const photos = await c.query(`SELECT id FROM room_photos WHERE owner_id=$1 AND room_id=$2 ORDER BY sort_order,id`, [ownerId, roomId]);
  const room = (await c.query(`SELECT images FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, roomId])).rows[0];
  let current: unknown[] = [];
  try { const v = JSON.parse(room?.images || "[]"); current = Array.isArray(v) ? v : []; } catch { current = []; }
  const images = nextImages(current, photos.rows.map((p) => Number(p.id)), opts);
  await c.query(`UPDATE rooms SET images=$1 WHERE owner_id=$2 AND id=$3`, [JSON.stringify(images), ownerId, roomId]);
  return images;
}

export function photoResponse(row: { mime: string; data_base64: string } | undefined, cache: string) {
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(row.data_base64, "base64"), { headers: { "Content-Type": row.mime, "Cache-Control": cache, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}
