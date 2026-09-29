import { db } from "@/lib/db";
import { draftDmReply } from "@/lib/dm-reply-db";
import { env } from "@/lib/env";
import { pushNotification } from "@/lib/pms-notifications";
import { providerCredentials } from "@/lib/provider-connections";
import { tiktokMessage, validTikTokSignature } from "@/lib/social";

/** TikTok Business Messaging webhook: incoming DMs go to the PMS inbox with a drafted, availability-aware reply. */
export async function POST(request: Request) {
  const ownerId = env().PMS_OWNER_ID;
  const tiktok = await providerCredentials(ownerId, "tiktok").catch(() => null);
  const raw = await request.text();
  if (!tiktok?.active || !validTikTokSignature(raw, request.headers.get("tiktok-signature"), tiktok.secrets.clientSecret ?? "")) return new Response("Forbidden", { status: 403 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const events = Array.isArray(body) ? body : [body];
  let stored = 0;
  for (const event of events) {
    const m = tiktokMessage(event as { event?: string; content?: unknown });
    if (!m) continue;
    const r = await db().query(
      `INSERT INTO social_messages(owner_id,platform,sender_id,direction,body,external_id,status,created_at) VALUES($1,'tiktok',$2,'in',$3,$4,'new',$5) ON CONFLICT DO NOTHING RETURNING id`,
      [ownerId, m.senderId, m.text, m.id, m.at],
    );
    if (!r.rowCount) continue;
    stored++;
    const draft = await draftDmReply(ownerId, m.text, "tiktok").catch(() => null);
    if (draft) await db().query(`UPDATE social_messages SET suggested_reply=$1,stay_request_json=$2 WHERE id=$3`, [draft.reply, draft.request ? JSON.stringify(draft.request) : null, r.rows[0].id]);
    await pushNotification(db(), ownerId, { kind: "system", titleEl: `Νέο μήνυμα TikTok: ${m.text.slice(0, 80)}`, titleEn: `New TikTok message: ${m.text.slice(0, 80)}`, link: "/pms/social" });
  }
  return Response.json({ ok: true, stored });
}
