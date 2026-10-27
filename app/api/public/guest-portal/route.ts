import { z } from "zod";
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { cancelDeptOrder, freeSlots, placeDeptOrder, portalData } from "@/lib/guest-portal";
import { bookingForToken } from "@/lib/guest-self-service";
import { allowAttempt } from "@/lib/request-limit";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("order"), token: z.string().min(32).max(200), lang: z.string().max(5).default("en"), itemId: z.number().int().positive(), quantity: z.number().int().min(1).max(20).default(1), date: z.string().max(10).optional(), time: z.string().max(5).optional(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("cancel"), token: z.string().min(32).max(200), lang: z.string().max(5).default("en"), id: z.number().int().positive() }),
]);
const errors: Record<string, number> = { NOT_IN_HOUSE: 409, NOT_AVAILABLE: 409, CLOSED: 409, SLOT_TAKEN: 409, TOO_LATE: 409, ALREADY_HANDLED: 409, NOT_FOUND: 404 };

/** Guest portal in "My booking": hotel departments and their services, the guest's orders and the hotel's messages. ?slots=itemId&date= returns free times. */
export async function GET(request: Request) {
  const url = new URL(request.url), token = url.searchParams.get("token") ?? "";
  if (token.length < 32) return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
  const b = await bookingForToken(db(), token);
  if (!b) return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
  const ownerId = env().PMS_OWNER_ID, slotItem = Number(url.searchParams.get("slots") ?? 0), date = url.searchParams.get("date") ?? "";
  if (slotItem > 0) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < String(b.check_in) || date > String(b.check_out)) return Response.json({ ok: true, slots: [] });
    return Response.json({ ok: true, slots: await freeSlots(ownerId, slotItem, date) }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ ok: true, ...(await portalData(ownerId, b, bookingLanguage(url.searchParams.get("lang") ?? "en"))) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const x = input.parse(await request.json());
    const b = await bookingForToken(db(), x.token);
    if (!b) return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
    if (!(await allowAttempt(`guest-portal:${b.id}`, 30, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429 });
    const ownerId = env().PMS_OWNER_ID;
    if (x.action === "order") await placeDeptOrder(ownerId, Number(b.id), bookingLanguage(x.lang), x);
    else await cancelDeptOrder(ownerId, x.id, { bookingId: Number(b.id) });
    return Response.json({ ok: true, ...(await portalData(ownerId, b, bookingLanguage(x.lang))) }, { status: x.action === "order" ? 201 : 200 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!errors[m]) console.error("Guest portal order failed", e);
    return Response.json({ ok: false, error: errors[m] ? m : "ORDER_FAILED" }, { status: errors[m] ?? 500 });
  }
}
