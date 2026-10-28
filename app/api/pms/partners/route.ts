import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { commissionReport, createPartnerUser, decideOffer, listOffers, listPartnerOrders, listPartners, partnersEnabled, removeItem, removePartner, resetPartnerPassword, saveItem, savePartner, setPartnerLogo, setPartnerUserActive, setPartnersEnabled } from "@/lib/partners";
import { itemInput, partnerInput } from "@/lib/partners-core";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { hotelToday } from "@/lib/tape-chart";

const id = z.number().int().positive();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enabled"), enabled: z.boolean() }),
  z.object({ action: z.literal("save"), id: id.optional(), partner: partnerInput }),
  z.object({ action: z.literal("remove"), id }),
  z.object({ action: z.literal("logo"), id, image: z.string().max(8_000_000).nullable() }),
  z.object({ action: z.literal("item_save"), partnerId: id, id: id.optional(), item: itemInput }),
  z.object({ action: z.literal("item_remove"), partnerId: id, id }),
  z.object({ action: z.literal("user_create"), partnerId: id, email: z.string().trim().email().max(200), name: z.string().trim().max(80).default("") }),
  z.object({ action: z.literal("user_reset"), id }),
  z.object({ action: z.literal("user_active"), id, active: z.boolean() }),
  z.object({ action: z.literal("offer_decide"), id, approve: z.boolean(), reason: z.string().trim().max(300).default("") }),
]);

async function state(ownerId: string, month: string) {
  return { enabled: await partnersEnabled(ownerId), partners: await listPartners(ownerId), offers: await listOffers(ownerId), orders: await listPartnerOrders(ownerId), report: await commissionReport(ownerId, month), month };
}

export async function GET(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  const m = new URL(request.url).searchParams.get("month");
  return Response.json({ ok: true, ...(await state(u.ownerId, m && /^\d{4}-\d{2}$/.test(m) ? m : hotelToday().slice(0, 7))) });
}

/** PMS → Partners: businesses, catalogue, logins for their app, offer approval. Passwords are in this reply only. */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const extra: Record<string, unknown> = {};
    if (x.action === "enabled") await setPartnersEnabled(u.ownerId, x.enabled);
    else if (x.action === "save") extra.id = await savePartner(u.ownerId, x.partner, x.id);
    else if (x.action === "remove") await removePartner(u.ownerId, x.id);
    else if (x.action === "logo") await setPartnerLogo(u.ownerId, x.id, x.image);
    else if (x.action === "item_save") await saveItem(u.ownerId, x.partnerId, x.item, x.id);
    else if (x.action === "item_remove") await removeItem(u.ownerId, x.partnerId, x.id);
    else if (x.action === "user_create") extra.password = await createPartnerUser(u.ownerId, x.partnerId, x.email, x.name);
    else if (x.action === "user_reset") extra.password = await resetPartnerPassword(u.ownerId, x.id);
    else if (x.action === "user_active") await setPartnerUserActive(u.ownerId, x.id, x.active);
    else await decideOffer(u.ownerId, x.id, x.approve, x.reason, u.id);
    return Response.json({ ok: true, ...extra, ...(await state(u.ownerId, hotelToday().slice(0, 7))) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : ["NOT_FOUND", "EMAIL_TAKEN"].includes(m) ? m : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("partners", handlePOST);
