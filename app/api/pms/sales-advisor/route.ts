import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { advisorState, applySuggestion, dismissSuggestion, runAdvisorNow } from "@/lib/department-sales";
import { allowAttempt } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";
import { MAX_DISCOUNT } from "../../../../scripts/department-sales-core.mjs";

/** PMS → Τμήματα → Βοηθός πωλήσεων: the last analyses, open suggestions, the playbook per department. */
export async function GET() {
  const u = await requireApiUser("reports.financial");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await advisorState(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

const text = (max: number) => z.string().trim().max(max).default("");
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), ai: z.boolean().default(true) }),
  z.object({ action: z.literal("dismiss"), id: z.number().int().positive() }),
  z.object({ action: z.literal("apply"), id: z.number().int().positive(), titleEl: text(120), titleEn: text(120), bodyEl: text(1500), bodyEn: text(1500), discountPercent: z.number().int().min(0).max(MAX_DISCOUNT).default(0), durationHours: z.number().int().min(1).max(14 * 24).default(24) })
    .refine((x) => x.titleEl || x.bodyEl || x.titleEn || x.bodyEn),
]);
const errors: Record<string, number> = { NOT_FOUND: 404, ALREADY_HANDLED: 409, NO_AUDIENCE: 409 };

async function handlePOST(request: Request) {
  const u = await requireApiUser("reports.financial");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    let run: Awaited<ReturnType<typeof runAdvisorNow>> | null = null;
    if (x.action === "run") {
      // An AI analysis costs: at most 6 an hour per hotel.
      if (x.ai && !(await allowAttempt(`sales-advisor:${u.ownerId}`, 6, 3_600_000, 3_600_000))) return Response.json({ ok: false, error: "TOO_MANY_REQUESTS" }, { status: 429 });
      run = await runAdvisorNow(u.ownerId, u.id, x.ai);
    } else if (x.action === "dismiss") await dismissSuggestion(u.ownerId, x.id, u.id);
    else {
      // Sending an offer to guests: the same right as the guest messages page.
      if (!can(u.role, "reservations.write", u.permissions)) return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      await applySuggestion(u.ownerId, x.id, u.id, x);
    }
    return Response.json({ ok: true, run, ...(await advisorState(u.ownerId)) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!errors[m]) console.error("Sales advisor failed", e);
    return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
  }
}

export const POST = audited("sales_advisor", handlePOST);
