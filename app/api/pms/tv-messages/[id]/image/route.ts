import { requireApiUser } from "@/lib/auth";
import { photoResponse } from "@/lib/room-photos";
import { messageImage } from "@/lib/tv-messages";

/** Photo preview of a sent TV message (PMS list). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  return photoResponse(await messageImage(u.ownerId, id), "private, max-age=3600");
}
