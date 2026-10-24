import { photoResponse } from "@/lib/room-photos";
import { screenMessageImage } from "@/lib/tv-messages";

/** Photo of a reception message, only for the screens it was sent to. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const messageId = Number(id);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return new Response("Not found", { status: 404 });
  return photoResponse(await screenMessageImage(token, messageId), "private, max-age=3600");
}
