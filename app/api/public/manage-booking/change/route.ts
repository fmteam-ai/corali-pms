import { z } from "zod";
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { applyChange, bookingForToken, quoteChange } from "@/lib/guest-self-service";

const input = z.object({ token: z.string().min(32).max(200), checkIn: z.iso.date(), checkOut: z.iso.date(), lang: z.string().max(5).optional(), confirm: z.boolean().default(false), expectedTotalCents: z.number().int().optional() });
const known = ["NOT_ALLOWED", "INVALID_DATES", "UNAVAILABLE", "PRICE_CHANGED", "INVALID_TOKEN"];

/** Guest date change: without `confirm` returns the price for the new dates; with it applies the change at that price. */
export async function POST(request: Request) {
  try {
    const x = input.parse(await request.json());
    const lang = bookingLanguage(x.lang);
    if (!x.confirm) {
      const b = await bookingForToken(db(), x.token);
      if (!b) return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
      const quote = await quoteChange(db(), b, x.checkIn, x.checkOut, lang);
      return Response.json(quote.ok ? { ok: true, quote } : quote, { status: quote.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
    }
    if (x.expectedTotalCents === undefined) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    const r = await applyChange(x.token, x.checkIn, x.checkOut, x.expectedTotalCents, lang);
    return Response.json({ ok: true, booking: { check_in: r.booking.check_in, check_out: r.booking.check_out, total_cents: Number(r.booking.total_cents), balance_cents: Number(r.booking.balance_cents) }, refundDueCents: r.quote.refundDueCents, payUrl: r.payUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    const m = e instanceof Error ? e.message : "";
    if (known.includes(m)) return Response.json({ ok: false, error: m }, { status: m === "INVALID_TOKEN" ? 401 : 409 });
    console.error("Guest date change failed", e);
    return Response.json({ ok: false, error: "CHANGE_FAILED" }, { status: 500 });
  }
}
