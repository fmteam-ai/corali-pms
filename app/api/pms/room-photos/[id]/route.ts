import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { photoResponse } from "@/lib/room-photos";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("rooms.read");
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response("Not found", { status: 404 });
  const row = (await db().query(`SELECT mime,data_base64 FROM room_photos WHERE owner_id=$1 AND id=$2`, [u.ownerId, id])).rows[0];
  return photoResponse(row, "private, max-age=86400");
}
