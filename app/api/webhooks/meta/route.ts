import { db } from "@/lib/db";
import { draftDmReply } from "@/lib/dm-reply-db";
import { env } from "@/lib/env";
import { providerCredentials } from "@/lib/provider-connections";
import { pushNotification } from "@/lib/pms-notifications";
import { validMetaSignature } from "@/lib/social";

/** Meta webhook verification handshake. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const meta = await providerCredentials(env().PMS_OWNER_ID, "meta").catch(() => null);
  if (url.searchParams.get("hub.mode") === "subscribe" && meta?.secrets.verifyToken && url.searchParams.get("hub.verify_token") === meta.secrets.verifyToken) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type MessagingEvent = { sender?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean }; timestamp?: number };

/** Incoming Facebook Page / Instagram direct messages, stored for the PMS inbox (replies are sent by staff). */
export async function POST(request: Request) {
  const ownerId = env().PMS_OWNER_ID;
  const meta = await providerCredentials(ownerId, "meta").catch(() => null);
  const raw = await request.text();
  if (!meta?.active || !validMetaSignature(raw, request.headers.get("x-hub-signature-256"), meta.secrets.appSecret ?? "")) return new Response("Forbidden", { status: 403 });
  let body: { object?: string; entry?: { messaging?: MessagingEvent[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const platform = body.object === "instagram" ? "instagram" : "facebook";
  let stored = 0;
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text?.trim();
      if (!text || event.message?.is_echo || !event.sender?.id) continue;
      const r = await db().query(
        `INSERT INTO social_messages(owner_id,platform,sender_id,direction,body,external_id,status,created_at) VALUES($1,$2,$3,'in',$4,$5,'new',$6) ON CONFLICT DO NOTHING RETURNING id`,
        [ownerId, platform, event.sender.id, text.slice(0, 2000), event.message?.mid ?? null, Number(event.timestamp) || Date.now()],
      );
      if (r.rowCount) {
        stored++;
        // Draft a reply with live availability for the reception inbox (sent only after staff approval).
        const draft = await draftDmReply(ownerId, text, platform).catch(() => null);
        if (draft) await db().query(`UPDATE social_messages SET suggested_reply=$1,stay_request_json=$2 WHERE id=$3`, [draft.reply, draft.request ? JSON.stringify(draft.request) : null, r.rows[0].id]);
        await pushNotification(db(), ownerId, { kind: "system", titleEl: `Νέο μήνυμα ${platform === "instagram" ? "Instagram" : "Facebook"}: ${text.slice(0, 80)}`, titleEn: `New ${platform === "instagram" ? "Instagram" : "Facebook"} message: ${text.slice(0, 80)}`, link: "/pms/social" });
      }
    }
  }
  return Response.json({ ok: true, stored });
}
