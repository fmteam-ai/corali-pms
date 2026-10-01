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

/** Booking-engine assistant: answers guest questions (AI when configured, otherwise built-in answers). */
export async function POST(request: Request) {
  try {
    const x = input.parse(await request.json());
    if (x.messages.at(-1)?.role !== "user") return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!(await allowAttempt(`assistant:ip:${clientIp(request)}`, 40, 10 * 60_000, 10 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_REQUESTS" }, { status: 429 });
    // Keep the conversation short: the last 12 turns, starting with a guest message.
    let turns = x.messages.slice(-12);
    while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
    const result = await assistantReply(env().PMS_OWNER_ID, bookingLanguage(x.lang), turns, x.context);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("Assistant route failed", e);
    return Response.json({ ok: false, error: "ASSISTANT_FAILED" }, { status: 500 });
  }
}
