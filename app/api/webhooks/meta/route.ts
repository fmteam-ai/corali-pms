import { db } from "@/lib/db";
import { draftDmReply } from "@/lib/dm-reply-db";
import { env } from "@/lib/env";
import { providerCredentials } from "@/lib/provider-connections";
import { pushNotification } from "@/lib/pms-notifications";
import { validMetaSignature } from "@/lib/social";
import { parseWhatsAppWebhook } from "@/lib/whatsapp-inbox-core";
import { clientIp } from "@/lib/request-limit";
import { recordSecurityEvent } from "@/lib/security-center";

/** Meta webhook verification handshake. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const [meta, wa] = await Promise.all([providerCredentials(env().PMS_OWNER_ID, "meta").catch(() => null), providerCredentials(env().PMS_OWNER_ID, "whatsapp").catch(() => null)]);
  const given = url.searchParams.get("hub.verify_token");
  // Facebook/Instagram and WhatsApp may be set up with different Meta apps, each with its own verify token.
  if (url.searchParams.get("hub.mode") === "subscribe" && given && [meta?.secrets.verifyToken, wa?.secrets.verifyToken].some((t) => t && t === given)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  // Never cached (e.g. by Cloudflare): an old "Forbidden" must not hide a token saved since.
  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

type MessagingEvent = { sender?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean }; timestamp?: number };

/** Incoming Facebook Page / Instagram direct messages, stored for the PMS inbox (replies are sent by staff). */
export async function POST(request: Request) {
  const ownerId = env().PMS_OWNER_ID;
  const raw = await request.text();
  if (/"object"\s*:\s*"whatsapp_business_account"/.test(raw)) return whatsappWebhook(ownerId, raw, request.headers.get("x-hub-signature-256"));
  const meta = await providerCredentials(ownerId, "meta").catch(() => null);
  if (!meta?.active || !validMetaSignature(raw, request.headers.get("x-hub-signature-256"), meta.secrets.appSecret ?? "")) {
    if (meta?.active) void recordSecurityEvent("bad_webhook", clientIp(request), "meta");
    return new Response("Forbidden", { status: 403 });
  }
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
        await pushNotification(db(), ownerId, { kind: "guest_message", titleEl: `Νέο μήνυμα ${platform === "instagram" ? "Instagram" : "Facebook"}: ${text.slice(0, 80)}`, titleEn: `New ${platform === "instagram" ? "Instagram" : "Facebook"} message: ${text.slice(0, 80)}`, link: "/pms/social" });
      }
    }
  }
  return Response.json({ ok: true, stored });
}

/**
 * Guest messages to the hotel's WhatsApp number (Cloud API), signed with the WhatsApp app's secret (or the
 * Facebook/Instagram app's, when both use the same app): stored in the same PMS inbox, with a drafted reply.
 */
async function whatsappWebhook(ownerId: string, raw: string, signature: string | null) {
  const [wa, meta] = await Promise.all([providerCredentials(ownerId, "whatsapp").catch(() => null), providerCredentials(ownerId, "meta").catch(() => null)]);
  const secrets = [wa?.secrets.appSecret, meta?.secrets.appSecret].filter((x): x is string => Boolean(x));
  if (!wa?.active || !secrets.some((secret) => validMetaSignature(raw, signature, secret))) return new Response("Forbidden", { status: 403 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  let stored = 0;
  for (const m of parseWhatsAppWebhook(body)) {
    // Only the number connected in the PMS (a WhatsApp account can hold more than one).
    if (wa.settings.phoneNumberId && m.phoneNumberId && m.phoneNumberId !== wa.settings.phoneNumberId) continue;
    const r = await db().query(
      `INSERT INTO social_messages(owner_id,platform,sender_id,sender_name,direction,body,external_id,status,created_at) VALUES($1,'whatsapp',$2,$3,'in',$4,$5,'new',$6) ON CONFLICT DO NOTHING RETURNING id`,
      [ownerId, m.from, m.name || null, m.text, m.id, m.createdAt],
    );
    if (!r.rowCount) continue;
    stored++;
    const draft = await draftDmReply(ownerId, m.text, "whatsapp").catch(() => null);
    if (draft) await db().query(`UPDATE social_messages SET suggested_reply=$1,stay_request_json=$2 WHERE id=$3`, [draft.reply, draft.request ? JSON.stringify(draft.request) : null, r.rows[0].id]);
    const who = m.name || `+${m.from}`;
    await pushNotification(db(), ownerId, { kind: "guest_message", titleEl: `Νέο μήνυμα WhatsApp από ${who}: ${m.text.slice(0, 80)}`, titleEn: `New WhatsApp message from ${who}: ${m.text.slice(0, 80)}`, link: "/pms/social" });
  }
  return Response.json({ ok: true, stored });
}
