// myDATA retry queue (PMS instance only). cPanel cron every 10 minutes:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-mydata-queue.mjs
// Re-sends documents that failed (network or AADE errors) with exponential back-off; each keeps its number.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { invoiceXml, nextAttemptAt, sendInvoice } from "./mydata-core.mjs";

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
  const c = (await pool.query(`SELECT active,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='mydata'`, [owner])).rows[0];
  if (!c || !Number(c.active)) { console.log("myDATA not active; nothing to do."); process.exit(0); }
  const secrets = JSON.parse(unseal(c.secrets_encrypted));
  const due = (await pool.query(`SELECT * FROM fiscal_documents WHERE owner_id=$1 AND status IN ('pending','failed') AND COALESCE(next_attempt_at,0)<=$2 ORDER BY id LIMIT 50`, [owner, Date.now()])).rows;
  let sent = 0;
  for (const row of due) {
    // Claim the row so a concurrent PMS "retry" click cannot double-send.
    const claim = await pool.query(`UPDATE fiscal_documents SET next_attempt_at=$1 WHERE id=$2 AND status IN ('pending','failed') AND COALESCE(next_attempt_at,0)<=$3 RETURNING id`, [Date.now() + 10 * 60_000, row.id, Date.now()]);
    if (!claim.rowCount) continue;
    let result;
    try { result = await sendInvoice(invoiceXml(JSON.parse(row.document_json)), { username: secrets.username, subscriptionKey: secrets.subscriptionKey }, row.environment); }
    catch (error) { result = { statusCode: "NETWORK", mark: null, errors: [String(error).slice(0, 300)] }; }
    const attempts = Number(row.attempts) + 1, now = Date.now();
    if (result.statusCode === "Success" && result.mark) {
      await pool.query(`UPDATE fiscal_documents SET status='sent',mark=$1,uid=$2,qr_url=$3,attempts=$4,last_error=NULL,next_attempt_at=NULL,updated_at=$5 WHERE id=$6`, [result.mark, result.uid, result.qrUrl, attempts, now, row.id]);
      sent++;
    } else {
      await pool.query(`UPDATE fiscal_documents SET status='failed',attempts=$1,last_error=$2,next_attempt_at=$3,updated_at=$4 WHERE id=$5`, [attempts, `${result.statusCode}: ${result.errors.join("; ")}`.slice(0, 1000), nextAttemptAt(attempts, now), now, row.id]);
    }
  }
  console.log(`myDATA queue: ${due.length} due, ${sent} sent.`);
} finally {
  await pool.end();
}
