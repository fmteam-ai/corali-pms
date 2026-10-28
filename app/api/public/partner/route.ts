import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "@/lib/env";
import { checkGuestPass, partnerCookie, partnerHome, partnerLogin, partnerLogout, partnerSession, partnersEnabled, proposeOffer, recordRedemption, removeItem, saveItem, subscribePartner, updatePartnerOrder, withdrawOffer } from "@/lib/partners";
import { itemInput, offerInput } from "@/lib/partners-core";
import { allowAttempt, clientIp } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";

const id = z.number().int().positive();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), email: z.string().trim().email().max(200), password: z.string().min(1).max(200) }),
  z.object({ action: z.literal("logout") }),
  z.object({ action: z.literal("offer"), offer: offerInput }),
  z.object({ action: z.literal("offer_withdraw"), id }),
  z.object({ action: z.literal("order"), id, status: z.string().max(20).optional(), paymentLink: z.string().trim().max(500).optional(), paid: z.boolean().optional(), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("item_save"), id: id.optional(), item: itemInput }),
  z.object({ action: z.literal("item_remove"), id }),
  z.object({ action: z.literal("pass"), pass: z.string().trim().min(6).max(120) }),
  z.object({ action: z.literal("redeem"), pass: z.string().trim().min(6).max(120), offerId: id.nullable(), amountEur: z.number().min(0).max(10_000).nullable() }),
  z.object({ action: z.literal("subscribe"), subscription: z.object({ endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://")), keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }) }) }),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function session() {
  return partnerSession((await cookies()).get(partnerCookie)?.value);
}

/** Partner app data (orders, catalogue, offers) for the signed-in business. */
export async function GET() {
  const s = await session();
  if (!s) return json({ ok: false, error: "SIGN_IN" }, 401);
  return json({ ok: true, ...(await partnerHome(s)) });
}

/** Partner app: sign in / out, orders, catalogue, offers (wait for the hotel's approval), guest pass check. */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const jar = await cookies();
    if (x.action === "login") {
      if (!(await allowAttempt(`partner-login:${clientIp(request)}`, 10, 15 * 60_000, 30 * 60_000)) || !(await allowAttempt(`partner-login:${x.email.toLowerCase()}`, 8, 15 * 60_000, 30 * 60_000))) return json({ ok: false, error: "TOO_MANY" }, 429);
      if (!(await partnersEnabled(env().PMS_OWNER_ID))) return json({ ok: false, error: "DISABLED" }, 403);
      const r = await partnerLogin(x.email, x.password);
      if (!r) return json({ ok: false, error: "LOGIN_FAILED" }, 401);
      jar.set(partnerCookie, r.token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(r.expiresAt) });
      return json({ ok: true });
    }
    const token = jar.get(partnerCookie)?.value;
    if (x.action === "logout") { if (token) await partnerLogout(token); jar.delete(partnerCookie); return json({ ok: true }); }
    const s = await partnerSession(token);
    if (!s) return json({ ok: false, error: "SIGN_IN" }, 401);
    if (x.action === "pass") { const g = await checkGuestPass(s, x.pass); return json({ ok: true, guest: g }); }
    if (x.action === "redeem") await recordRedemption(s, x);
    else if (x.action === "offer") await proposeOffer(s, x.offer);
    else if (x.action === "offer_withdraw") await withdrawOffer(s, x.id);
    else if (x.action === "order") await updatePartnerOrder(s, x.id, x);
    else if (x.action === "item_save") await saveItem(s.ownerId, s.partnerId, x.item, x.id);
    else if (x.action === "item_remove") await removeItem(s.ownerId, s.partnerId, x.id);
    else await subscribePartner(s, x.subscription);
    return json({ ok: true, ...(await partnerHome(s)) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : ["NOT_FOUND", "STEP", "LINK", "PASS", "OFFER", "USED", "CODE_TAKEN", "TOO_MANY"].includes(m) ? m : "FAILED" }, m === "TOO_MANY" ? 429 : 400);
  }
}
