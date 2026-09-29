import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { photoResponse } from "@/lib/room-photos";

/** Public room photo for the booking engine (only photos of active rooms). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response("Not found", { status: 404 });
  const row = (await db().query(`SELECT p.mime,p.data_base64 FROM room_photos p JOIN rooms r ON r.id=p.room_id AND r.owner_id=p.owner_id AND r.active=1 WHERE p.owner_id=$1 AND p.id=$2`, [env().PMS_OWNER_ID, id])).rows[0];
  return photoResponse(row, "public, max-age=604800, immutable");
}
