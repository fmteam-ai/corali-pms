import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { providerCredentials } from "@/lib/provider-connections";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { canApprove, postTransition, socialChannels } from "@/lib/social";
import { socialState } from "@/lib/social-state";

const post = z.object({ caption: z.string().trim().min(1).max(2200), imageUrl: z.union([z.literal(""), z.url()]), linkUrl: z.union([z.literal(""), z.url()]), channels: z.array(z.enum(socialChannels)).min(1), scheduledAt: z.number().int().positive() });
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...post.shape }),
  z.object({ action: z.literal("edit"), id: z.number().int().positive(), ...post.shape }),
  z.object({ action: z.enum(["submit", "approve", "reject", "withdraw"]), id: z.number().int().positive() }),
  z.object({ action: z.literal("reply"), platform: z.enum(["facebook", "instagram"]), senderId: z.string().min(1).max(100), text: z.string().trim().min(1).max(1000) }),
]);

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await socialState(u.ownerId)) });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const now = Date.now();
    if (x.action === "reply") {
      // Staff-approved reply within Meta's 24-hour messaging window; never sent automatically.
      if (!can(u.role, "reservations.write", u.permissions)) return forbidden(u, "reservations.write", "social.reply");
      const meta = await providerCredentials(u.ownerId, "meta");
      if (!meta?.active || !meta.secrets.pageAccessToken) return Response.json({ ok: false, error: "META_NOT_CONFIGURED" }, { status: 409 });
      const version = meta.settings.graphVersion || "v21.0";
      const target = x.platform === "instagram" ? meta.settings.instagramAccountId : meta.settings.pageId;
      const r = await fetch(`https://graph.facebook.com/${version}/${target}/messages`, { method: "POST", headers: { Authorization: `Bearer ${meta.secrets.pageAccessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: x.senderId }, message: { text: x.text }, messaging_type: "RESPONSE" }), signal: AbortSignal.timeout(15_000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return Response.json({ ok: false, error: "SEND_FAILED", detail: String(d.error?.message ?? r.status).slice(0, 200) }, { status: 502 });
      await db().query(`INSERT INTO social_messages(owner_id,platform,sender_id,direction,body,external_id,status,sent_by,created_at) VALUES($1,$2,$3,'out',$4,$5,'sent',$6,$7)`, [u.ownerId, x.platform, x.senderId, x.text, d.message_id ?? null, u.id, now]);
      await db().query(`UPDATE social_messages SET status='answered' WHERE owner_id=$1 AND platform=$2 AND sender_id=$3 AND direction='in' AND status='new'`, [u.ownerId, x.platform, x.senderId]);
    } else {
      if (!can(u.role, "integrations.write", u.permissions)) return forbidden(u, "integrations.write", "social.post");
      if (x.action === "create") {
        await db().query(`INSERT INTO social_posts(owner_id,channels,caption,image_url,link_url,scheduled_at,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$8)`, [u.ownerId, JSON.stringify(x.channels), x.caption, x.imageUrl, x.linkUrl, x.scheduledAt, u.id, now]);
      } else {
        const row = (await db().query(`SELECT * FROM social_posts WHERE owner_id=$1 AND id=$2`, [u.ownerId, x.id])).rows[0];
        if (!row) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
        const next = postTransition(row.status, x.action);
        if (!next) return Response.json({ ok: false, error: "INVALID_TRANSITION" }, { status: 409 });
        if (x.action === "approve" && !canApprove(Number(row.created_by), u.id, u.role)) return Response.json({ ok: false, error: "SECOND_APPROVER_REQUIRED" }, { status: 409 });
        if (x.action === "approve" && JSON.parse(row.channels).includes("instagram") && !row.image_url) return Response.json({ ok: false, error: "INSTAGRAM_NEEDS_IMAGE" }, { status: 409 });
        if (x.action === "edit") await db().query(`UPDATE social_posts SET channels=$1,caption=$2,image_url=$3,link_url=$4,scheduled_at=$5,status='draft',approved_by=NULL,approved_at=NULL,updated_at=$6 WHERE id=$7`, [JSON.stringify(x.channels), x.caption, x.imageUrl, x.linkUrl, x.scheduledAt, now, x.id]);
        else await db().query(`UPDATE social_posts SET status=$1,approved_by=CASE WHEN $1='approved' THEN $2::bigint ELSE NULL END,approved_at=CASE WHEN $1='approved' THEN $3::bigint ELSE NULL END,updated_at=$3 WHERE id=$4`, [next, u.id, now, x.id]);
      }
    }
    return Response.json({ ok: true, ...(await socialState(u.ownerId)) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("social", handlePOST);
