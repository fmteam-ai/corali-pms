// Social publisher (PMS instance only). cPanel cron every 5 minutes:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-social-publisher.mjs
// Publishes only posts a person has APPROVED whose time has come. Facebook Page and Instagram via the Meta Graph API;
// TikTok requires a video upload through TikTok's reviewed Content Posting API and is marked for manual posting.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { GraphError, graphCall, publishDue } from "./social-publish-core.mjs";

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

try {
  const row = (await pool.query(`SELECT active,settings_json,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='meta'`, [owner])).rows[0];
  const meta = row && Number(row.active) ? { settings: JSON.parse(row.settings_json), secrets: JSON.parse(unseal(row.secrets_encrypted)) } : null;
  // v201: atomic claim + lease + write-ahead per platform (scripts/social-publish-core.mjs). A Meta call without a
  // reliable answer is UNCERTAIN — never published a second time automatically.
  const send = async (channel, post) => {
    if (!meta?.secrets.pageAccessToken) throw new GraphError("Meta is not configured", "rejected");
    const version = meta.settings.graphVersion || "v21.0", token = meta.secrets.pageAccessToken;
    const text = post.link_url ? `${post.caption}\n\n${post.link_url}` : post.caption;
    if (channel === "facebook") {
      const r = post.image_url
        ? await graphCall({ version, path: `${meta.settings.pageId}/photos`, token, params: { url: post.image_url, caption: text } })
        : await graphCall({ version, path: `${meta.settings.pageId}/feed`, token, params: { message: post.caption, ...(post.link_url ? { link: post.link_url } : {}) } });
      return { id: r.post_id ?? r.id };
    }
    if (channel === "instagram") {
      // Creating the container publishes nothing: any failure there is a plain failure (safe to retry).
      let container;
      try { container = await graphCall({ version, path: `${meta.settings.instagramAccountId}/media`, token, params: { image_url: post.image_url, caption: text } }); }
      catch (e) { throw new GraphError(`Instagram container: ${e.message}`, "rejected"); }
      const r = await graphCall({ version, path: `${meta.settings.instagramAccountId}/media_publish`, token, params: { creation_id: container.id } });
      return { id: r.id };
    }
    throw new GraphError(`unknown channel ${channel}`, "rejected");
  };
  const run = await publishDue({ pool, owner, send });
  console.log(`Social publisher: ${run.claimed} claimed by ${run.workerId.slice(0, 8)} · ${run.results.map((r) => `#${r.id} ${r.status}`).join(", ") || "nothing due"}`);
} finally {
  await pool.end();
}
