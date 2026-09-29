import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { openSuggestions } from "@/lib/pricing-suggestions-db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ action: z.enum(["approve", "dismiss"]), key: z.string().max(200) });

async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.create");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    // Re-derive the suggestion on the server: the client only names it.
    const suggestion = (await openSuggestions(u.ownerId)).find((s) => s.key === x.key);
    if (!suggestion) return Response.json({ ok: false, error: "SUGGESTION_EXPIRED" }, { status: 409 });
    await withTransaction(async (c) => {
      let specialId: number | null = null;
      if (x.action === "approve") {
        const codes = (await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND room_type=$2 AND active=1 ORDER BY code`, [u.ownerId, suggestion.roomType])).rows.map((r) => String(r.code));
        const now = Date.now();
        const inserted = await c.query(
          `INSERT INTO special_prices(owner_id,name,starts_on,ends_on,adjustment_type,adjustment_value,operation,weekdays,room_codes,rate_plan_keys,minimum_stay,tied_to_year,promotion,priority,active,created_at,updated_at)
           VALUES($1,$2,$3,$4,'percentage',$5,$6,'[]',$7,'[]',1,1,$8,0,1,$9,$9) RETURNING id`,
          [u.ownerId, `Δυναμική τιμή ${suggestion.percent > 0 ? "+" : ""}${suggestion.percent}% · ${suggestion.roomType}`, suggestion.startsOn, suggestion.endsOn, Math.abs(suggestion.percent), suggestion.percent > 0 ? "charge" : "discount", JSON.stringify(codes), suggestion.percent < 0 ? 1 : 0, now],
        );
        specialId = Number(inserted.rows[0].id);
      }
      await c.query(`INSERT INTO pricing_suggestion_decisions(owner_id,suggestion_key,decision,special_price_id,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [u.ownerId, x.key, x.action, specialId, String(u.id), Date.now()]);
    });
    return Response.json({ ok: true, suggestions: await openSuggestions(u.ownerId) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("pricing_suggestion", handlePOST);
