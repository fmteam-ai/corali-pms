// The hotel's look for guest messages: loaded for every e-mail the PMS sends (see scripts/email-brand-core.mjs).
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { providerCredentials } from "@/lib/provider-connections";
import { normalizeBrand, renderBrandedEmail, withFallbacks } from "../scripts/email-brand-core.mjs";

export type MessageBrand = ReturnType<typeof normalizeBrand>;

export async function loadBrandSettings(ownerId: string): Promise<MessageBrand> {
  const r = await db().query(`SELECT settings_json FROM message_brand WHERE owner_id=$1`, [ownerId]).catch(() => ({ rows: [] as { settings_json: string }[] }));
  let raw: unknown = null;
  try { raw = r.rows[0] ? JSON.parse(String(r.rows[0].settings_json)) : null; } catch { raw = null; }
  return normalizeBrand(raw);
}

/** With the phone from Corali TV and the sender address from SMTP when the hotel left them empty. */
export async function loadBrand(ownerId: string): Promise<MessageBrand> {
  const brand = await loadBrandSettings(ownerId);
  if (brand.phone && brand.email) return brand;
  const [tv, smtp] = await Promise.all([
    db().query(`SELECT settings_json FROM tv_settings WHERE owner_id=$1`, [ownerId]).catch(() => ({ rows: [] as { settings_json: string }[] })),
    providerCredentials(ownerId, "smtp").catch(() => null),
  ]);
  let phone = "";
  try { phone = String(JSON.parse(String(tv.rows[0]?.settings_json ?? "{}")).receptionPhone ?? ""); } catch { phone = ""; }
  return withFallbacks(brand, { phone, email: String(smtp?.settings.from ?? env().SMTP_FROM ?? "") });
}

export async function saveBrand(ownerId: string, raw: unknown, userId: number): Promise<MessageBrand> {
  const brand = normalizeBrand(raw);
  await db().query(`INSERT INTO message_brand(owner_id,settings_json,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_by=$3,updated_at=$4`, [ownerId, JSON.stringify(brand), userId, Date.now()]);
  return brand;
}

export const logoUrl = () => `${env().BOOKING_ORIGIN.replace(/\/$/, "")}/hotel-corali-logo.png`;

/** Language of a message when the caller did not say: Greek letters → Greek. */
export const guessLang = (text: string) => (/[Ͱ-Ͽ]/.test(text) ? "el" : "en");

export async function brandedHtml(ownerId: string, subject: string, text: string, lang?: string): Promise<string> {
  return renderBrandedEmail({ subject, text, lang: lang ?? guessLang(`${subject}\n${text}`), brand: await loadBrand(ownerId), logoUrl: logoUrl() });
}
