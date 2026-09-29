// Daily GDPR retention job. cPanel cron (PMS instance only), e.g. 03:15 every day:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-data-retention.mjs
import process from "node:process";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { purgeExpiredIdentityData, retentionCutoff } from "./retention-core.mjs";

if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
try {
  const purged = await purgeExpiredIdentityData((text, values) => pool.query(text, values), owner);
  await pool.query(
    `INSERT INTO audit_logs(owner_id,user_id,action,entity_name,entity_id,payload_after,created_at) VALUES($1,NULL,'retention.purge','guest_checkin',NULL,$2,$3)`,
    [owner, JSON.stringify({ purged, cutoff: retentionCutoff() }), Date.now()],
  ).catch(() => undefined);
  console.log(`Data retention complete: ${purged} pre-check-in record(s) purged (last stay on/before ${retentionCutoff()}).`);
} finally {
  await pool.end();
}
