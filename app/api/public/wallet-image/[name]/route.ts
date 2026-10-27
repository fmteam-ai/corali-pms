import { env } from "@/lib/env";
import { loadWalletImages, walletImageNames } from "@/lib/wallet-images";

/** The hotel's digital-key photo (Google Wallet fetches the hero image from here; the card page shows it). */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(walletImageNames as readonly string[]).includes(name)) return new Response("Not found", { status: 404 });
  const images = await loadWalletImages(env().PMS_OWNER_ID);
  if (!images) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(images[name as (typeof walletImageNames)[number]], "base64")), { headers: { "Content-Type": name === "hero" ? "image/jpeg" : "image/png", "Cache-Control": "public, max-age=86400" } });
}
