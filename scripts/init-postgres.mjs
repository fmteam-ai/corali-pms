import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: databaseSsl(),
});
const root = path.resolve(import.meta.dirname, "..");
const schema = fs.readFileSync(path.join(root, "server/postgres-schema.sql"), "utf8");
const ownerId = process.env.PMS_OWNER_ID || "hotel-corali";
const now = Date.now();

try {
  await pool.query(schema);
  await pool.query(`ALTER TABLE guest_checkins ADD COLUMN IF NOT EXISTS travel_details TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE guest_checkins ADD COLUMN IF NOT EXISTS special_requests TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE guest_checkins ADD COLUMN IF NOT EXISTS luggage_assistance BIGINT NOT NULL DEFAULT 0`);
  await pool.query(
    `INSERT INTO payment_policies
      (owner_id, full_payment, deposit_percent, balance_due_days, reminder_channels, active, updated_at)
     VALUES ($1, 0, 30, 5, 'email', 1, $2)
     ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId, now],
  );
  await pool.query(`INSERT INTO extras (owner_id, code, name, description, price_cents, pricing_mode, active, sort_order, created_at)
    VALUES ($1, 'BREAKFAST', 'Breakfast', 'Future breakfast upsell — activate only when service becomes available.', 0, 'per_person', 0, 98, $2)
    ON CONFLICT (owner_id, code) DO NOTHING`, [ownerId, now]);
  await pool.query(`UPDATE extras SET
    name_en=CASE WHEN code='AIRPORT_TRANSFER' THEN 'One-way airport transfer' WHEN code='BREAKFAST' THEN 'Breakfast' ELSE COALESCE(NULLIF(name_en,''),name) END,
    name_el=CASE WHEN code='AIRPORT_TRANSFER' THEN 'Μεταφορά μίας διαδρομής από το αεροδρόμιο' WHEN code='BREAKFAST' THEN 'Πρωινό' ELSE COALESCE(NULLIF(name_el,''),name) END,
    description_en=COALESCE(NULLIF(description_en,''),description), description_el=COALESCE(NULLIF(description_el,''),description)
    WHERE owner_id=$1`, [ownerId]);
  await pool.query(`UPDATE mandatory_charges SET
    name_en=CASE WHEN category IN ('climate_resilience','climate_tax') OR name ILIKE '%κλιματ%' THEN 'Climate Crisis Resilience Fee' ELSE COALESCE(NULLIF(name_en,''),name) END,
    name_el=CASE WHEN category IN ('climate_resilience','climate_tax') OR name ILIKE '%climate%' THEN 'Τέλος ανθεκτικότητας στην κλιματική κρίση' ELSE COALESCE(NULLIF(name_el,''),name) END
    WHERE owner_id=$1`, [ownerId]);
  // Birthday offers are personal single-use codes issued by scripts/run-birthday-automation.mjs; the former shared code is retired.
  await pool.query(`UPDATE coupons SET active=0 WHERE owner_id=$1 AND code='BIRTHDAY10' AND purpose='birthday'`,[ownerId]);
  await pool.query(
    `INSERT INTO rate_widget_settings (owner_id, active, position, updated_at)
     VALUES ($1, 1, 'right', $2)
     ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId, now],
  );
  console.log(`PostgreSQL schema and Hotel Corali defaults are ready for ${ownerId}.`);
} finally {
  await pool.end();
}
