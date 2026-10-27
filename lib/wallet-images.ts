// The photo on the digital key: the hotel uploads one picture in the PMS and it is cut to the sizes the wallets use
// (Apple strip 375×123 / 750×246 PNG, Google hero 1032×336 JPEG, card-shaped 1012×638 JPEG for the key page) with the same dark gradient and logo as the built-in images.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";

export type WalletImages = { strip: string; strip2x: string; hero: string; card?: string; version: string };
export const walletImageNames = ["strip", "strip2x", "hero", "card"] as const;
const MAX_INPUT = 12 * 1024 * 1024;

const stripShade = (w: number, h: number) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#0f2f37" stop-opacity=".78"/><stop offset=".45" stop-color="#0f2f37" stop-opacity=".35"/><stop offset=".7" stop-color="#0f2f37" stop-opacity="0"/></linearGradient><linearGradient id="b" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="#0f2f37" stop-opacity=".55"/><stop offset=".6" stop-color="#0f2f37" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#a)"/><rect width="100%" height="100%" fill="url(#b)"/></svg>`);
const heroShade = Buffer.from(`<svg width="1032" height="336" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="b" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="#0f2f37" stop-opacity=".75"/><stop offset=".55" stop-color="#0f2f37" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#b)"/><rect x="36" y="30" width="270" height="78" rx="16" fill="#fff"/><text x="40" y="306" font-family="Georgia, serif" font-size="34" fill="#fff">Piso Livadi · Paros</text></svg>`);

/** Cut an uploaded photo (JPEG / PNG / WebP / HEIF) to the wallet sizes. Throws BAD_IMAGE for anything else. */
export async function makeWalletImages(input: Buffer): Promise<WalletImages> {
  if (input.length > MAX_INPUT) throw Error("IMAGE_TOO_LARGE");
  const meta = await sharp(input).metadata().catch(() => null);
  if (!meta?.width || !meta.height || meta.width < 600 || meta.height < 200) throw Error("BAD_IMAGE");
  const base = sharp(input).rotate();
  const cut = (w: number, h: number) => base.clone().resize(w, h, { fit: "cover", position: "attention" });
  const logo = await sharp(await readFile(path.join(process.cwd(), "public", "hotel-corali-logo.png"))).resize(250).png().toBuffer();
  const strip = async (w: number, h: number) => (await cut(w, h).composite([{ input: stripShade(w, h) }]).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer()).toString("base64");
  const hero = (await cut(1032, 336).composite([{ input: heroShade }, { input: logo, left: 46, top: 38 }]).jpeg({ quality: 84, mozjpeg: true }).toBuffer()).toString("base64");
  const card = (await cut(1012, 638).jpeg({ quality: 84, mozjpeg: true }).toBuffer()).toString("base64");
  const out = { strip: await strip(375, 123), strip2x: await strip(750, 246), hero, card };
  return { ...out, version: createHash("sha256").update(out.hero).digest("hex").slice(0, 12) };
}

export async function saveWalletImages(ownerId: string, images: WalletImages | null): Promise<void> {
  await db().query(`INSERT INTO access_card_settings(owner_id,wallet_images_json,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET wallet_images_json=$2,updated_at=$3`, [ownerId, images ? JSON.stringify(images) : null, Date.now()]);
}

export async function loadWalletImages(ownerId: string): Promise<WalletImages | null> {
  const r = await db().query(`SELECT wallet_images_json FROM access_card_settings WHERE owner_id=$1`, [ownerId]);
  try { return r.rows[0]?.wallet_images_json ? (JSON.parse(String(r.rows[0].wallet_images_json)) as WalletImages) : null; } catch { return null; }
}

/** Public address of an image: the hotel's photo when uploaded, otherwise the built-in harbour picture. */
export function walletImageUrl(images: WalletImages | null, name: "strip2x" | "hero" | "card", origin = ""): string {
  if (images && images[name]) return `${origin}/api/public/wallet-image/${name}?v=${images.version}`;
  return `${origin}/wallet/${name === "hero" ? "hero.png" : name === "card" ? "card.jpg" : "strip@2x.png"}`;
}
