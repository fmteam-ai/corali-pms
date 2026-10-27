import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { decideAction, listActions } from "@/lib/assistant-actions";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ id: z.number().int().positive(), approve: z.boolean(), lang: z.enum(["el", "en"]).default("el") });
const errors: Record<string, number> = { NOT_PENDING: 409, FORBIDDEN: 403 };

/** Proposals of the PMS AI assistant: pending ones and the last two days' decisions. */
export async function GET(request: Request) {
  const u = await requireApiUser("dashboard.read");
  if (u instanceof Response) return u;
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "el";
  return Response.json({ ok: true, actions: await listActions(u, lang) }, { headers: { "Cache-Control": "no-store" } });
}

/** Approve (run) or reject one proposal. Running checks the action's own permission. */
async function handlePOST(request: Request) {
  const u = await requireApiUser("dashboard.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const r = await decideAction(u, x.id, x.approve);
    return Response.json({ ok: true, ...r, actions: await listActions(u, x.lang, [x.id]) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!errors[m]) console.error("Assistant action failed", e);
    return Response.json({ ok: false, error: errors[m] ? m : "FAILED" }, { status: errors[m] ?? 500 });
  }
}

export const POST = audited("assistant_action", handlePOST);
