// Bulk messages to past guests in the database (PMS → Bulk messages): drafts, audience preview, test send,
// scheduling, cancel, report and the unsubscribe list. Sending itself is done by the cron worker
// (scripts/campaign-worker.mjs) a few messages per minute.
import sharp from "sharp";
import { db } from "@/lib/db";
import { documentKey, env } from "@/lib/env";
import { sendEmail } from "@/lib/notifications/email";
import { hotelToday } from "@/lib/tape-chart";
import { audienceQuery, batchSize, normalizeAudience, normalizeContent, normalizeEmail, normalizePhone, renderCampaignEmail, unsubscribeToken, validUnsubscribeToken, type CampaignAudience, type CampaignContent } from "../scripts/campaign-core.mjs";

export type CampaignInput = { name: string; sendEmail: boolean; sendWhatsapp: boolean; audience: unknown; content: unknown; whatsappTemplate: string; whatsappLanguages: string; ratePerMinute: number };
export type CampaignStats = { email: Record<string, number>; whatsapp: Record<string, number>; unsubscribed: number };
export type CampaignView = { id: number; name: string; sendEmail: boolean; sendWhatsapp: boolean; audience: CampaignAudience; content: CampaignContent; hasImage: boolean; whatsappTemplate: string; whatsappLanguages: string; ratePerMinute: number; status: string; scheduledAt: number | null; startedAt: number | null; finishedAt: number | null; createdAt: number; updatedAt: number; stats: CampaignStats };

type Row = Record<string, unknown>;
const parse = (v: unknown) => { try { return JSON.parse(String(v ?? "{}")); } catch { return {}; } };

function view(c: Row, stats: CampaignStats): CampaignView {
  return {
    id: Number(c.id), name: String(c.name), sendEmail: Number(c.send_email) === 1, sendWhatsapp: Number(c.send_whatsapp) === 1,
    audience: normalizeAudience(parse(c.audience_json)), content: normalizeContent(parse(c.content_json)), hasImage: Boolean(c.image_data),
    whatsappTemplate: String(c.whatsapp_template), whatsappLanguages: String(c.whatsapp_languages), ratePerMinute: batchSize(c.rate_per_minute),
    status: String(c.status), scheduledAt: c.scheduled_at === null ? null : Number(c.scheduled_at), startedAt: c.started_at === null ? null : Number(c.started_at),
    finishedAt: c.finished_at === null ? null : Number(c.finished_at), createdAt: Number(c.created_at), updatedAt: Number(c.updated_at), stats,
  };
}

export async function listCampaigns(ownerId: string): Promise<CampaignView[]> {
  const [cs, counts, unsub] = await Promise.all([
    db().query(`SELECT id,name,send_email,send_whatsapp,audience_json,content_json,(image_data IS NOT NULL) AS image_data,whatsapp_template,whatsapp_languages,rate_per_minute,status,scheduled_at,started_at,finished_at,created_at,updated_at FROM campaigns WHERE owner_id=$1 ORDER BY id DESC LIMIT 100`, [ownerId]),
    db().query(`SELECT campaign_id,channel,status,count(*)::int n FROM campaign_recipients WHERE owner_id=$1 GROUP BY campaign_id,channel,status`, [ownerId]),
    db().query(`SELECT campaign_id,count(*)::int n FROM marketing_unsubscribes WHERE owner_id=$1 AND campaign_id IS NOT NULL GROUP BY campaign_id`, [ownerId]),
  ]);
  return cs.rows.map((c) => {
    const stats: CampaignStats = { email: {}, whatsapp: {}, unsubscribed: Number(unsub.rows.find((u) => Number(u.campaign_id) === Number(c.id))?.n ?? 0) };
    for (const r of counts.rows) if (Number(r.campaign_id) === Number(c.id)) stats[String(r.channel) as "email" | "whatsapp"][String(r.status)] = Number(r.n);
    return view(c, stats);
  });
}

export async function saveCampaign(ownerId: string, userId: number, x: CampaignInput, id?: number): Promise<number> {
  const v = [x.name.trim().slice(0, 120) || "—", x.sendEmail ? 1 : 0, x.sendWhatsapp ? 1 : 0, JSON.stringify(normalizeAudience(x.audience)), JSON.stringify(normalizeContent(x.content)), x.whatsappTemplate.trim().slice(0, 120), x.whatsappLanguages.trim().slice(0, 60), batchSize(x.ratePerMinute), Date.now(), ownerId];
  if (id) {
    const r = await db().query(`UPDATE campaigns SET name=$1,send_email=$2,send_whatsapp=$3,audience_json=$4,content_json=$5,whatsapp_template=$6,whatsapp_languages=$7,rate_per_minute=$8,updated_at=$9 WHERE owner_id=$10 AND id=$11 AND status='draft'`, v.concat(id));
    if (!r.rowCount) throw Error("NOT_DRAFT");
    return id;
  }
  return Number((await db().query(`INSERT INTO campaigns(name,send_email,send_whatsapp,audience_json,content_json,whatsapp_template,whatsapp_languages,rate_per_minute,updated_at,owner_id,created_at,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11,'draft') RETURNING id`, v.concat(userId))).rows[0].id);
}

export async function duplicateCampaign(ownerId: string, userId: number, id: number): Promise<number> {
  const r = await db().query(`INSERT INTO campaigns(owner_id,name,send_email,send_whatsapp,audience_json,content_json,image_data,whatsapp_template,whatsapp_languages,rate_per_minute,status,created_by,created_at,updated_at) SELECT owner_id,name||' (2)',send_email,send_whatsapp,audience_json,content_json,image_data,whatsapp_template,whatsapp_languages,rate_per_minute,'draft',$3,$4,$4 FROM campaigns WHERE owner_id=$1 AND id=$2 RETURNING id`, [ownerId, id, userId, Date.now()]);
  if (!r.rowCount) throw Error("NOT_FOUND");
  return Number(r.rows[0].id);
}

export async function removeCampaign(ownerId: string, id: number): Promise<void> {
  const r = await db().query(`DELETE FROM campaigns WHERE owner_id=$1 AND id=$2 AND status IN ('draft','cancelled')`, [ownerId, id]);
  if (!r.rowCount) throw Error("NOT_DRAFT");
  await db().query(`DELETE FROM campaign_recipients WHERE owner_id=$1 AND campaign_id=$2`, [ownerId, id]);
}

/** Photo at the top of the e-mail: any image → 1200 px wide JPEG. */
export async function setCampaignImage(ownerId: string, id: number, base64: string | null): Promise<void> {
  const data = base64 ? (await sharp(Buffer.from(base64, "base64"), { limitInputPixels: 60_000_000 }).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()).toString("base64") : null;
  const r = await db().query(`UPDATE campaigns SET image_data=$3,updated_at=$4 WHERE owner_id=$1 AND id=$2 AND status='draft'`, [ownerId, id, data, Date.now()]);
  if (!r.rowCount) throw Error("NOT_DRAFT");
}

export async function campaignImage(id: number): Promise<{ data: Buffer; version: number } | null> {
  const r = (await db().query(`SELECT image_data,updated_at FROM campaigns WHERE id=$1 AND owner_id=$2 AND image_data IS NOT NULL`, [id, env().PMS_OWNER_ID])).rows[0];
  return r ? { data: Buffer.from(String(r.image_data), "base64"), version: Number(r.updated_at) } : null;
}

/** How many guests each channel would reach now, by language (nothing is sent). */
export async function previewAudience(ownerId: string, audience: unknown) {
  const today = hotelToday();
  const out: Record<"email" | "whatsapp", { total: number; byLang: Record<string, number> }> = { email: { total: 0, byLang: {} }, whatsapp: { total: 0, byLang: {} } };
  for (const channel of ["email", "whatsapp"] as const) {
    const q = audienceQuery(ownerId, audience, channel, today);
    for (const r of (await db().query(q.sql, q.params)).rows) { out[channel].total++; out[channel].byLang[String(r.lang)] = (out[channel].byLang[String(r.lang)] ?? 0) + 1; }
  }
  return out;
}

/** Test e-mail to the hotel in one language, exactly as guests will get it (the unsubscribe link is a sample). */
export async function testCampaignEmail(ownerId: string, id: number, to: string, lang: string): Promise<void> {
  const c = (await db().query(`SELECT content_json,image_data IS NOT NULL AS has_image,updated_at FROM campaigns WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0];
  if (!c) throw Error("NOT_FOUND");
  const origin = env().BOOKING_ORIGIN;
  const m = renderCampaignEmail({ content: normalizeContent(parse(c.content_json)), lang, name: "Maria Papadopoulou", imageUrl: c.has_image ? `${origin}/api/public/campaigns/image/${id}?v=${c.updated_at}` : "", unsubscribeUrl: `${origin}/unsubscribe?test=1&lang=${lang}`, logoUrl: `${origin}/hotel-corali-logo.png` });
  if (!m) throw Error("NO_CONTENT");
  await sendEmail(to, `[TEST] ${m.subject}`, m.text, { html: m.html });
}

/** Send now (at = now) or later; the worker takes the audience snapshot at that time. */
export async function scheduleCampaign(ownerId: string, id: number, at: number): Promise<void> {
  const c = (await db().query(`SELECT send_email,send_whatsapp,content_json,whatsapp_template,whatsapp_languages FROM campaigns WHERE owner_id=$1 AND id=$2 AND status='draft'`, [ownerId, id])).rows[0];
  if (!c) throw Error("NOT_DRAFT");
  if (!Number(c.send_email) && !Number(c.send_whatsapp)) throw Error("NO_CHANNEL");
  if (Number(c.send_email) && !Object.values(normalizeContent(parse(c.content_json))).some((x) => x.body)) throw Error("NO_CONTENT");
  if (Number(c.send_whatsapp) && (!String(c.whatsapp_template) || !String(c.whatsapp_languages))) throw Error("WHATSAPP_NO_TEMPLATE");
  await db().query(`UPDATE campaigns SET status='scheduled',scheduled_at=$3,updated_at=$4 WHERE owner_id=$1 AND id=$2`, [ownerId, id, Math.max(at, Date.now()), Date.now()]);
}

/** Stop: a scheduled campaign goes back to draft; a sending one stops (messages not yet sent are skipped). */
export async function cancelCampaign(ownerId: string, id: number): Promise<void> {
  const now = Date.now();
  const back = await db().query(`UPDATE campaigns SET status='draft',scheduled_at=NULL,updated_at=$3 WHERE owner_id=$1 AND id=$2 AND status='scheduled'`, [ownerId, id, now]);
  if (back.rowCount) return;
  const stop = await db().query(`UPDATE campaigns SET status='cancelled',finished_at=$3,updated_at=$3 WHERE owner_id=$1 AND id=$2 AND status='sending'`, [ownerId, id, now]);
  if (!stop.rowCount) throw Error("NOT_RUNNING");
  await db().query(`UPDATE campaign_recipients SET status='skipped',error='CANCELLED',updated_at=$3 WHERE owner_id=$1 AND campaign_id=$2 AND status IN ('pending','sending')`, [ownerId, id, now]);
}

export async function campaignFailures(ownerId: string, id: number) {
  return (await db().query(`SELECT channel,address,name,status,error,updated_at FROM campaign_recipients WHERE owner_id=$1 AND campaign_id=$2 AND status IN ('failed','skipped') ORDER BY id LIMIT 300`, [ownerId, id])).rows.map((r) => ({ channel: String(r.channel), address: String(r.address), name: String(r.name), status: String(r.status), error: String(r.error), at: Number(r.updated_at) }));
}

// ───────────────────────────── unsubscribe list ─────────────────────────────

export async function listUnsubscribes(ownerId: string) {
  return (await db().query(`SELECT channel,address,source,created_at FROM marketing_unsubscribes WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1000`, [ownerId])).rows.map((r) => ({ channel: String(r.channel), address: String(r.address), source: String(r.source), at: Number(r.created_at) }));
}

/** Add by hand (a guest asked by phone / e-mail); WhatsApp numbers are kept as digits only. */
export async function addUnsubscribe(ownerId: string, channel: "email" | "whatsapp", address: string): Promise<void> {
  const a = channel === "email" ? normalizeEmail(address) : normalizePhone(address);
  if (!a || (channel === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))) throw Error("INVALID_ADDRESS");
  await db().query(`INSERT INTO marketing_unsubscribes(owner_id,channel,address,source,created_at) VALUES($1,$2,$3,'pms',$4) ON CONFLICT DO NOTHING`, [ownerId, channel, a, Date.now()]);
}

export async function removeUnsubscribe(ownerId: string, channel: string, address: string): Promise<void> {
  await db().query(`DELETE FROM marketing_unsubscribes WHERE owner_id=$1 AND channel=$2 AND address=$3`, [ownerId, channel, address]);
}

/** The guest's unsubscribe link (signed per recipient): the e-mail address joins the list. */
export async function unsubscribeRecipient(recipientId: number, token: string): Promise<boolean> {
  if (!validUnsubscribeToken(documentKey(), recipientId, token)) return false;
  const owner = env().PMS_OWNER_ID;
  const r = (await db().query(`SELECT campaign_id,channel,address FROM campaign_recipients WHERE owner_id=$1 AND id=$2`, [owner, recipientId])).rows[0];
  if (!r) return false;
  await db().query(`INSERT INTO marketing_unsubscribes(owner_id,channel,address,source,campaign_id,created_at) VALUES($1,$2,$3,'link',$4,$5) ON CONFLICT DO NOTHING`, [owner, r.channel, r.address, r.campaign_id, Date.now()]);
  return true;
}

export { unsubscribeToken };
