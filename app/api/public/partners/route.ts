import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { guestCancelPartnerOrder, guestPartnerOrders, guestPartners, guestPass, partnersEnabled, placePartnerOrder } from "@/lib/partners";
import { orderInput } from "@/lib/partners-core";
import { allowAttempt } from "@/lib/request-limit";
import { bookingForToken } from "@/lib/guest-self-service";

const token = z.string().min(32).max(200);
const lang = z.enum(["el", "en", "fr", "de", "it", "es"]).default("en");
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("order"), token, lang, order: orderInput }),
  z.object({ action: z.literal("cancel"), token, id: z.number().int().positive() }),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const inStay = (b: Record<string, unknown>) => ["confirmed", "checked_in"].includes(String(b.status));

/** "My booking" → partner businesses: list (hotel-guest offers first), my orders and the guest pass. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams, t = q.get("token") ?? "";
  const b = t.length >= 32 && t.length <= 200 ? await bookingForToken(db(), t) : null;
  if (!b) return json({ ok: false, error: "INVALID_TOKEN" }, 401);
  const owner = env().PMS_OWNER_ID, l = lang.catch("en").parse(q.get("lang") ?? "en");
  if (!(await partnersEnabled(owner))) return json({ ok: true, enabled: false, partners: [], orders: [], pass: null, canOrder: false });
  return json({ ok: true, partners: await guestPartners(owner, l), orders: await guestPartnerOrders(owner, Number(b.id)), pass: inStay(b) ? guestPass(b) : null, canOrder: inStay(b) });
}

export async function POST(request: Request) {
  const x = input.safeParse(await request.json().catch(() => null));
  if (!x.success) return json({ ok: false, error: "INVALID_INPUT" }, 400);
  const b = await bookingForToken(db(), x.data.token);
  if (!b) return json({ ok: false, error: "INVALID_TOKEN" }, 401);
  try {
    if (!(await allowAttempt(`partner-order:${b.id}`, 20, 60 * 60_000, 30 * 60_000))) return json({ ok: false, error: "TOO_MANY" }, 429);
    if (x.data.action === "order") await placePartnerOrder(env().PMS_OWNER_ID, b, x.data.lang, x.data.order);
    else await guestCancelPartnerOrder(env().PMS_OWNER_ID, Number(b.id), x.data.id);
    return json({ ok: true, orders: await guestPartnerOrders(env().PMS_OWNER_ID, Number(b.id)) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return json({ ok: false, error: ["NOT_IN_HOUSE", "NOT_FOUND", "FULFILMENT", "PAYMENT", "ITEM", "CODE", "USED", "TOO_LATE"].includes(m) ? m : "FAILED" }, 400);
  }
}
