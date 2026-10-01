import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { staffAssistantReply } from "@/lib/pms-assistant";
import { allowAttempt } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

const input = z.object({ lang: z.enum(["el", "en"]).default("el"), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) })).min(1).max(30) });

/** Dashboard AI assistant for staff (read-only snapshot; financial data only with folio permission). */
export async function POST(request: Request) {
  const u = await requireApiUser("dashboard.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.messages.at(-1)?.role !== "user") return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!(await allowAttempt(`pms-assistant:${u.ownerId}:${u.id}`, 60, 10 * 60_000, 5 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_REQUESTS" }, { status: 429 });
    let turns = x.messages.slice(-16);
    while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
    const result = await staffAssistantReply(u.ownerId, can(u.role, "folios.read", u.permissions), x.lang, turns);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("PMS assistant route failed", e);
    return Response.json({ ok: false, error: "ASSISTANT_FAILED" }, { status: 500 });
  }
}
