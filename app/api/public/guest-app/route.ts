import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { subscribeGuest, unsubscribeGuest, vapidPublicKey } from "@/lib/guest-push";
import { bookingForToken, rememberGuest } from "@/lib/guest-self-service";
import { allowAttempt, clientIp } from "@/lib/request-limit";

const token = z.string().min(32).max(200);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remember"), token }),
  z.object({ action: z.literal("subscribe"), token, lang: z.enum(["el", "en", "fr", "de", "it", "es"]).default("en"), subscription: z.object({ endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://")), keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }) }) }),
  z.object({ action: z.literal("unsubscribe"), token, endpoint: z.string().url().max(1000) }),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Guest app: the hotel's public push key (signed-in guests only). */
export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("token") ?? "";
  const b = t.length >= 32 && t.length <= 200 ? await bookingForToken(db(), t) : null;
  if (!b) return json({ ok: false, error: "INVALID_TOKEN" }, 401);
  return json({ ok: true, vapidPublicKey: await vapidPublicKey(env().PMS_OWNER_ID) });
}

/** Remember the sign-in on the phone until check-out; turn notifications on / off for this booking. */
export async function POST(request: Request) {
  const x = input.safeParse(await request.json().catch(() => null));
  if (!x.success) return json({ ok: false, error: "INVALID_INPUT" }, 400);
  if (!(await allowAttempt(`guest-app:${clientIp(request)}`, 30, 15 * 60_000, 15 * 60_000))) return json({ ok: false, error: "TOO_MANY" }, 429);
  try {
    const d = x.data;
    if (d.action === "remember") {
      const r = await rememberGuest(d.token);
      return r ? json({ ok: true, ...r }) : json({ ok: false, error: "NOT_AVAILABLE" }, 400);
    }
    const b = await bookingForToken(db(), d.token);
    if (!b) return json({ ok: false, error: "INVALID_TOKEN" }, 401);
    if (d.action === "subscribe") await subscribeGuest(env().PMS_OWNER_ID, Number(b.id), d.subscription, d.lang);
    else await unsubscribeGuest(env().PMS_OWNER_ID, d.endpoint);
    return json({ ok: true });
  } catch (e) {
    console.error("Guest app route failed", e);
    return json({ ok: false, error: "FAILED" }, 503);
  }
}
