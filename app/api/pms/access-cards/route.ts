import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { cardUrl, issueForBooking, newAppleCsr, issueManual, listCards, newReaderKey, publicCardConfig, recentEvents, revokeCard, saveCardSettings, saveWallet, sendCard, upcomingWithoutCard, updateCard } from "@/lib/access-cards";
import { db } from "@/lib/db";
import { makeWalletImages, saveWalletImages } from "@/lib/wallet-images";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

const id = z.number().int().positive(), ms = z.number().int().positive();
const zoneKeys = z.array(z.string().regex(/^[a-z][a-z0-9_]{1,23}$/)).max(12);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_settings"), settings: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("save_wallet"), config: z.record(z.string(), z.unknown()), secrets: z.object({ appleCert: z.string().max(20_000).optional(), appleWwdr: z.string().max(20_000).optional(), googleServiceAccount: z.string().max(20_000).optional() }) }),
  z.object({ action: z.literal("apple_csr"), email: z.union([z.literal(""), z.email().max(200)]).default("") }),
  z.object({ action: z.literal("reader_key") }),
  z.object({ action: z.literal("wallet_photo"), image: z.string().max(17_000_000) }),
  z.object({ action: z.literal("issue_booking"), bookingId: id, send: z.boolean().default(true) }),
  z.object({ action: z.literal("issue_manual"), holder: z.string().trim().min(1).max(120), email: z.union([z.literal(""), z.email().max(200)]).default(""), lang: z.string().max(5).default("en"), roomId: id.nullable().default(null), zones: zoneKeys.default([]), from: ms, until: ms, send: z.boolean().default(false) }),
  z.object({ action: z.literal("update"), id, validFrom: ms.optional(), validUntil: ms.optional(), zones: zoneKeys.optional(), roomId: id.nullable().optional(), holder: z.string().trim().min(1).max(120).optional(), followBooking: z.boolean().optional() }),
  z.object({ action: z.literal("revoke"), id, reason: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("resend"), id }),
  z.object({ action: z.literal("link"), id }),
]);
const errors: Record<string, number> = { NOT_FOUND: 404, ALREADY_ISSUED: 409, DISABLED: 409, BAD_DATES: 400, REVOKED: 409, NO_EMAIL: 400, SEND_FAILED: 502, GOOGLE_SERVICE_ACCOUNT_INVALID: 400, APPLE_CERTIFICATE_INVALID: 400, APPLE_CERTIFICATE_MISMATCH: 400, APPLE_NO_KEY: 400, BAD_IMAGE: 400, IMAGE_TOO_LARGE: 400 };

async function state(ownerId: string) {
  const [config, cards, upcoming, rooms, events] = await Promise.all([publicCardConfig(ownerId), listCards(ownerId), upcomingWithoutCard(ownerId), db().query(`SELECT id,code FROM rooms WHERE owner_id=$1 AND active=1 ORDER BY code`, [ownerId]), recentEvents(ownerId)]);
  return { ok: true, config, cards, upcoming, rooms: rooms.rows.map((r) => ({ id: Number(r.id), code: String(r.code) })), events };
}

/** PMS → Digital keys: settings, wallet set-up, cards (issue, extend, cancel, resend) and the door readers' log. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json(await state(u.ownerId), { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const setup = x.action === "save_settings" || x.action === "save_wallet" || x.action === "reader_key" || x.action === "apple_csr" || x.action === "wallet_photo";
    if (!can(u.role, setup ? "integrations.write" : "reservations.write", u.permissions)) return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    let extra: Record<string, unknown> = {};
    if (x.action === "save_settings") await saveCardSettings(u.ownerId, x.settings);
    else if (x.action === "save_wallet") await saveWallet(u.ownerId, x.config, x.secrets);
    else if (x.action === "wallet_photo") await saveWalletImages(u.ownerId, x.image ? await makeWalletImages(Buffer.from(x.image, "base64")) : null);
    else if (x.action === "reader_key") extra = { readerKey: await newReaderKey(u.ownerId) };
    else if (x.action === "apple_csr") extra = { csr: await newAppleCsr(u.ownerId, x.email) };
    else if (x.action === "issue_booking") extra = { cardId: await issueForBooking(u.ownerId, x.bookingId, String(u.id), x.send) };
    else if (x.action === "issue_manual") { const cardId = await issueManual(u.ownerId, x, String(u.id)); extra = { cardId, url: await cardUrl(u.ownerId, cardId) }; }
    else if (x.action === "update") await updateCard(u.ownerId, x.id, x);
    else if (x.action === "revoke") await revokeCard(u.ownerId, x.id, x.reason);
    else if (x.action === "resend") await sendCard(u.ownerId, x.id);
    else extra = { url: await cardUrl(u.ownerId, x.id) };
    return Response.json({ ...(await state(u.ownerId)), ...extra });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!errors[m]) console.error("Access card action failed", e);
    return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
  }
}

export const POST = audited("access_cards", handlePOST);
