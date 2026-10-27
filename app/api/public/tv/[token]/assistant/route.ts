import { z } from "zod";
import { allowAttempt } from "@/lib/request-limit";
import { askTvAssistant, clearTvAssistant, decideTvAction, tvAssistantState } from "@/lib/tv-assistant";
import { MAX_QUESTION } from "@/lib/tv-assistant-core";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), question: z.string().trim().min(1).max(MAX_QUESTION), lang: z.string().max(5).optional() }),
  z.object({ action: z.literal("decide"), id: z.number().int().positive(), confirm: z.boolean() }),
  z.object({ action: z.literal("clear") }),
]);
const valid = (token: string) => /^[A-Za-z0-9_-]{20,80}$/.test(token);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The room's conversation with the TV assistant (current stay only). */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!valid(token)) return json({ ok: false, error: "NOT_FOUND" }, 404);
  const state = await tvAssistantState(token, new URL(request.url).searchParams.get("lang"));
  return state ? json({ ok: true, ...state }) : json({ ok: false, error: "NOT_FOUND" }, 404);
}

/** Ask (voice text or a ready question), confirm / decline a proposal, or start a new conversation. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!valid(token)) return json({ ok: false, error: "NOT_FOUND" }, 404);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "INVALID_INPUT" }, 400);
  try {
    const x = parsed.data;
    if (!(await allowAttempt(`tv-assistant:${token}`, x.action === "ask" ? 15 : 30, 10 * 60_000, 10 * 60_000))) return json({ ok: false, error: "TOO_MANY" }, 429);
    if (x.action === "clear") return json({ ok: await clearTvAssistant(token) });
    if (x.action === "decide") { const r = await decideTvAction(token, x.id, x.confirm); return json(r, r.ok ? 200 : 400); }
    const r = await askTvAssistant(token, x.question, x.lang);
    return json(r, r.ok ? 200 : r.error === "NOT_FOUND" ? 404 : r.error === "FAILED" ? 503 : 400);
  } catch (e) {
    console.error("TV assistant route failed", e);
    return json({ ok: false, error: "FAILED" }, 503);
  }
}
