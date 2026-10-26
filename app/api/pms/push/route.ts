import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { allAlertKinds, normalizeAlertKinds } from "@/lib/staff-core";
import { sendStaffPush, vapidPublicKey } from "@/lib/staff-push";

const endpoint = z.string().url().max(1000).refine((v) => v.startsWith("https://"), "https");
const kinds = z.array(z.enum(allAlertKinds as [string, ...string[]])).max(20);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), subscription: z.object({ endpoint, keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) }), kinds, lang: z.enum(["el", "en"]) }),
  z.object({ action: z.literal("kinds"), endpoint, kinds, lang: z.enum(["el", "en"]) }),
  z.object({ action: z.literal("unsubscribe"), endpoint }),
  z.object({ action: z.literal("test") }),
]);

/** Public key for the browser, and this phone's alert choices (?endpoint=…). */
export async function GET(request: Request) {
  const u = await requireApiUser("staff.app");
  if (u instanceof Response) return u;
  const ep = new URL(request.url).searchParams.get("endpoint");
  const sub = ep ? (await db().query(`SELECT kinds_json FROM push_subscriptions WHERE owner_id=$1 AND staff_user_id=$2 AND endpoint=$3`, [u.ownerId, u.id, ep])).rows[0] : null;
  return Response.json({ ok: true, publicKey: await vapidPublicKey(u.ownerId), subscribed: Boolean(sub), kinds: sub ? normalizeAlertKinds(JSON.parse(sub.kinds_json)) : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const u = await requireApiUser("staff.app");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "subscribe") {
      // One phone = one subscription; if someone else signs in on that phone, it becomes theirs.
      await db().query(
        `INSERT INTO push_subscriptions(owner_id,staff_user_id,endpoint,p256dh,auth,kinds_json,lang,user_agent,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(endpoint) DO UPDATE SET owner_id=$1,staff_user_id=$2,p256dh=$4,auth=$5,kinds_json=$6,lang=$7,user_agent=$8,failures=0`,
        [u.ownerId, u.id, x.subscription.endpoint, x.subscription.keys.p256dh, x.subscription.keys.auth, JSON.stringify(normalizeAlertKinds(x.kinds)), x.lang, (request.headers.get("user-agent") ?? "").slice(0, 300), Date.now()],
      );
    } else if (x.action === "kinds") {
      await db().query(`UPDATE push_subscriptions SET kinds_json=$4,lang=$5 WHERE owner_id=$1 AND staff_user_id=$2 AND endpoint=$3`, [u.ownerId, u.id, x.endpoint, JSON.stringify(normalizeAlertKinds(x.kinds)), x.lang]);
    } else if (x.action === "unsubscribe") {
      await db().query(`DELETE FROM push_subscriptions WHERE owner_id=$1 AND staff_user_id=$2 AND endpoint=$3`, [u.ownerId, u.id, x.endpoint]);
    } else {
      const sent = await sendStaffPush(u.ownerId, { userIds: [u.id] }, { kind: "message", tag: "test", url: "/staff", title: { el: "Hotel Corali", en: "Hotel Corali" }, body: { el: "Οι ειδοποιήσεις λειτουργούν ✓", en: "Alerts are working ✓" } });
      return Response.json({ ok: sent > 0, sent });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: e instanceof z.ZodError ? 400 : 500 });
  }
}
