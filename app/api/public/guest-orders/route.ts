import { z } from "zod";
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { orderKinds } from "@/lib/guest-orders-core";
import { bookingOrders, guestOffers, placeOrder } from "@/lib/guest-orders";
import { bookingForToken } from "@/lib/guest-self-service";

const input = z.object({
  token: z.string().min(32).max(200),
  lang: z.string().max(5).default("en"),
  kind: z.enum(orderKinds),
  extraId: z.number().int().positive().optional(),
  roomType: z.string().max(60).optional(),
  date: z.string().max(10).optional(),
  time: z.string().max(5).optional(),
  note: z.string().max(300).optional(),
  source: z.enum(["manage", "checkin"]).default("manage"),
});

/** Offers (services, late check-out, upgrades) and this booking's requests, for "My booking" and after online check-in. */
export async function GET(request: Request) {
  const url = new URL(request.url), token = url.searchParams.get("token") ?? "";
  if (token.length < 32) return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
  const b = await bookingForToken(db(), token);
  if (!b) return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
  const lang = bookingLanguage(url.searchParams.get("lang") ?? "en"), ownerId = env().PMS_OWNER_ID;
  const [offers, orders] = await Promise.all([guestOffers(ownerId, b, lang), bookingOrders(ownerId, Number(b.id))]);
  return Response.json({ ok: true, stay: { checkIn: String(b.check_in), checkOut: String(b.check_out) }, offers, orders }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const x = input.parse(await request.json());
    const b = await bookingForToken(db(), x.token);
    if (!b) return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
    const lang = bookingLanguage(x.lang), ownerId = env().PMS_OWNER_ID;
    await placeOrder(ownerId, b, lang, x);
    return Response.json({ ok: true, orders: await bookingOrders(ownerId, Number(b.id)) }, { status: 201 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m === "NOT_AVAILABLE" || m === "ALREADY_REQUESTED") return Response.json({ ok: false, error: m }, { status: 409 });
    return Response.json({ ok: false, error: "ORDER_FAILED" }, { status: 500 });
  }
}
