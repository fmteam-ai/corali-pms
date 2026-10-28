import { campaignImage } from "@/lib/campaigns";

/** Photo of a bulk e-mail (loaded by the guest's mail app). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const img = Number.isSafeInteger(id) && id > 0 ? await campaignImage(id) : null;
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
}
