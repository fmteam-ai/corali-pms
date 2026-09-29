// Social publisher (PMS instance only). cPanel cron every 5 minutes:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-social-publisher.mjs
// Publishes only posts a person has APPROVED whose time has come. Facebook Page and Instagram via the Meta Graph API;
// TikTok requires a video upload through TikTok's reviewed Content Posting API and is marked for manual posting.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";

if (!process.env.DATABASE_URL || !process.env.PMS_DOCUMENT_KEY) throw Error("DATABASE_URL and PMS_DOCUMENT_KEY are required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });

function unseal(value) {
  const key = createHash("sha256").update(process.env.PMS_DOCUMENT_KEY).digest();
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw Error("INVALID_CIPHERTEXT");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

async function graph(version, path, token, params) {
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw Error(String(body.error?.message ?? `HTTP ${response.status}`).slice(0, 300));
  return body;
}

try {
  const row = (await pool.query(`SELECT active,settings_json,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='meta'`, [owner])).rows[0];
  const meta = row && Number(row.active) ? { settings: JSON.parse(row.settings_json), secrets: JSON.parse(unseal(row.secrets_encrypted)) } : null;
  const due = (await pool.query(`SELECT * FROM social_posts WHERE owner_id=$1 AND status='approved' AND approved_by IS NOT NULL AND scheduled_at<=$2 AND attempts<3 ORDER BY scheduled_at LIMIT 20`, [owner, Date.now()])).rows;
  for (const post of due) {
    const claim = await pool.query(`UPDATE social_posts SET attempts=attempts+1,updated_at=$1 WHERE id=$2 AND status='approved' RETURNING attempts`, [Date.now(), post.id]);
    if (!claim.rowCount) continue;
    const results = JSON.parse(post.results_json || "{}");
    const text = post.link_url ? `${post.caption}\n\n${post.link_url}` : post.caption;
    for (const channel of JSON.parse(post.channels)) {
      if (results[channel]?.id || results[channel]?.status === "manual") continue;
      try {
        if (channel === "tiktok") { results.tiktok = { status: "manual", note: "Upload the video in the TikTok app" }; continue; }
        if (!meta?.secrets.pageAccessToken) throw Error("Meta is not configured");
        const version = meta.settings.graphVersion || "v21.0", token = meta.secrets.pageAccessToken;
        if (channel === "facebook") {
          const r = post.image_url ? await graph(version, `${meta.settings.pageId}/photos`, token, { url: post.image_url, caption: text }) : await graph(version, `${meta.settings.pageId}/feed`, token, { message: post.caption, ...(post.link_url ? { link: post.link_url } : {}) });
          results.facebook = { status: "published", id: r.post_id ?? r.id };
        } else if (channel === "instagram") {
          const container = await graph(version, `${meta.settings.instagramAccountId}/media`, token, { image_url: post.image_url, caption: text });
          const r = await graph(version, `${meta.settings.instagramAccountId}/media_publish`, token, { creation_id: container.id });
          results.instagram = { status: "published", id: r.id };
        }
      } catch (error) {
        results[channel] = { status: "failed", error: String(error.message ?? error).slice(0, 300) };
      }
    }
    const states = Object.values(results).map((r) => r.status);
    const status = states.every((s) => s === "published" || s === "manual") ? "published" : states.some((s) => s === "published") ? "partially_published" : Number(claim.rows[0].attempts) >= 3 ? "failed" : "approved";
    await pool.query(`UPDATE social_posts SET status=$1,results_json=$2,published_at=CASE WHEN $1 IN ('published','partially_published') THEN $3::bigint ELSE published_at END,updated_at=$3 WHERE id=$4`, [status, JSON.stringify(results), Date.now(), post.id]);
    if (status !== "approved") await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/social',$4)`, [owner, `Ανάρτηση social: ${status}`, `Social post: ${status}`, Date.now()]);
  }
  console.log(`Social publisher: ${due.length} due.`);
} finally {
  await pool.end();
}
