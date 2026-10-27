import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { autoPricingStatus, runAutoPricingNow, saveAutoPricing } from "@/lib/auto-pricing";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), settings: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("run") }),
]);

export async function GET() {
  const u = await requireApiUser("pricing.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await autoPricingStatus(u.ownerId)) });
}

/** Save the automatic pricing settings (prices are recomputed at once) or run it now. */
async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "save") await saveAutoPricing(u.ownerId, x.settings);
    else await runAutoPricingNow(u.ownerId);
    return Response.json({ ok: true, ...(await autoPricingStatus(u.ownerId)) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("auto_pricing", handlePOST);
