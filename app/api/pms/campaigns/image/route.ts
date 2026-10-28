import { requireApiUser } from "@/lib/auth";
import { campaignImage } from "@/lib/campaigns";

/** The e-mail photo, for the PMS preview (guests load it from the booking site). */
export async function GET(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  const id = Number(new URL(request.url).searchParams.get("id"));
  const img = Number.isSafeInteger(id) && id > 0 ? await campaignImage(id) : null;
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" } });
}
