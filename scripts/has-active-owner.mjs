// Web installer helper: exit 0 when the PMS already has an active owner account (an upgrade can then keep it as it is,
// 2FA included), 3 when it has none. Prints nothing secret.
import process from "node:process";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
try {
  const r = await pool.query("SELECT username FROM pms_staff_users WHERE owner_id=$1 AND role='owner' AND active=1 ORDER BY id LIMIT 1", [process.env.PMS_OWNER_ID ?? "hotel-corali"]);
  if (!r.rowCount) { console.log("No active owner account."); process.exitCode = 3; }
  else console.log(`Active owner account: ${r.rows[0].username}`);
} finally {
  await pool.end();
}
