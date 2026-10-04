import { z } from "zod";
import { bookingLanguage } from "@/lib/booking-i18n";
import { env } from "@/lib/env";
import { assistantReply } from "@/lib/guest-assistant";
import { allowAttempt, clientIp } from "@/lib/request-limit";

const input = z.object({
  lang: z.string().max(5).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1500) })).min(1).max(20),
  context: z.string().max(4000).default(""),
});

// The hotel website embeds the assistant (public/assistant-widget.js), so its origins may call this endpoint.
const websiteOrigins = ["https://hotelcorali.gr", "https://www.hotelcorali.gr"];
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  let booking = "";
  try { booking = new URL(env().BOOKING_ORIGIN).origin; } catch { booking = ""; }
  return origin && (websiteOrigins.includes(origin) || origin === booking) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {};
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request) });
}

/** Booking-engine and website assistant: answers guest questions (AI when configured, otherwise built-in answers). */
export async function POST(request: Request) {
  const headers = cors(request);
  try {
    const x = input.parse(await request.json());
    if (x.messages.at(-1)?.role !== "user") return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400, headers });
    if (!(await allowAttempt(`assistant:ip:${clientIp(request)}`, 40, 10 * 60_000, 10 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_REQUESTS" }, { status: 429, headers });
    // Keep the conversation short: the last 12 turns, starting with a guest message.
    let turns = x.messages.slice(-12);
    while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
    const result = await assistantReply(env().PMS_OWNER_ID, bookingLanguage(x.lang), turns, x.context);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store", ...headers } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400, headers });
    console.error("Assistant route failed", e);
    return Response.json({ ok: false, error: "ASSISTANT_FAILED" }, { status: 500, headers });
  }
}
