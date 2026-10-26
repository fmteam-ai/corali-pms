import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { hkServiceRows, markHkService, saveHkServiceSettings } from "@/lib/hk-services";
import { hkServices, normalizeHkServiceSettings } from "@/lib/hk-services-core";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done"), bookingId: z.number().int().positive(), service: z.enum(hkServices), done: z.boolean() }),
  z.object({ action: z.literal("settings"), sheetsEvery: z.number().int().min(0).max(14), towelsEvery: z.number().int().min(0).max(14), reminderHour: z.number().int().min(0).max(23) }),
]);

export async function GET() {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await hkServiceRows(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("housekeeping.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "done") await markHkService(u.ownerId, x.bookingId, x.service, x.done, u.id);
    else await saveHkServiceSettings(u.ownerId, normalizeHkServiceSettings(x));
    return Response.json({ ok: true, ...(await hkServiceRows(u.ownerId)) });
  } catch (e) {
    const code = e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED";
    return Response.json({ ok: false, error: code }, { status: code === "SAVE_FAILED" ? 500 : 400 });
  }
}

export const POST = audited("housekeeping_services", handlePOST);
