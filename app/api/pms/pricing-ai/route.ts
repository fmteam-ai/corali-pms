import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { analysePricing } from "@/lib/pricing-ai";
import { anthropicApiKey } from "@/lib/provider-connections";
import { allowAttempt } from "@/lib/request-limit";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("analyze"), startsOn: z.iso.date().optional(), weeks: z.number().int().min(1).max(13).optional(), webSearch: z.boolean().default(false) }),
  z.object({ action: z.literal("apply"), items: z.array(z.object({ roomType: z.string().trim().min(1).max(60), startsOn: z.iso.date(), endsOn: z.iso.date(), priceCents: z.number().int().min(1000).max(5_000_00), note: z.string().max(300).default("") })).min(1).max(40) }),
]);

async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "analyze") {
      if (!(await anthropicApiKey(u.ownerId))) return Response.json({ ok: false, error: "AI_NOT_CONFIGURED" }, { status: 409 });
      if (!(await allowAttempt(`pricing-ai:${u.ownerId}`, 10, 60 * 60_000, 30 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_REQUESTS" }, { status: 429 });
      const analysis = await analysePricing(u.ownerId, { startsOn: x.startsOn, weeks: x.weeks, webSearch: x.webSearch });
      if (!analysis || "failure" in analysis) return Response.json({ ok: false, error: "AI_UNAVAILABLE", detail: analysis?.failure ?? "" }, { status: 409 });
      return Response.json({ ok: true, ...analysis });
    }
    if (!can(u.role, "pricing.create", u.permissions)) return forbidden(u, "pricing.create");
    // Applying a recommendation creates a season price (per night, for the category) that can be edited or deleted later.
    const now = Date.now();
    await withTransaction(async (c) => {
      for (const i of x.items) {
        if (i.endsOn < i.startsOn) throw Error("INVALID_DATES");
        await c.query(`INSERT INTO rate_rules(name,starts_on,ends_on,room_type,room_codes,weekdays,price_cents,active,updated_at,owner_id) VALUES($1,$2,$3,$4,'[]','[]',$5,1,$6,$7)`, [`AI · ${i.roomType} · ${i.startsOn}`.slice(0, 120), i.startsOn, i.endsOn, i.roomType, i.priceCents, now, u.ownerId]);
      }
    });
    return Response.json({ ok: true, applied: x.items.length });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : m === "INVALID_DATES" ? m : "FAILED" }, { status: e instanceof z.ZodError || m === "INVALID_DATES" ? 400 : 409 });
  }
}

export const POST = audited("pricing_ai", handlePOST);
