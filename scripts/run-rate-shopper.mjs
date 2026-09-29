// Daily competitor rate shopper (PMS instance only). For each active competitor with an API source, fetches the
// next 60 days of public rates from the configured rate-shopping endpoint and stores the latest rate per date.
import process from "node:process";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { buildRateUrl, parseRates } from "./rate-shopper-core.mjs";

if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const to = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10);

try {
  const competitors = await pool.query(`SELECT id,name,api_url FROM competitors WHERE owner_id=$1 AND active=1 AND source='api' AND api_url<>'' ORDER BY id LIMIT 10`, [owner]);
  for (const c of competitors.rows) {
    try {
      const url = buildRateUrl(c.api_url, { from: today, to, date: today, checkout: to });
      const headers = { Accept: "application/json", ...(process.env.RATE_SHOPPER_TOKEN ? { Authorization: `Bearer ${process.env.RATE_SHOPPER_TOKEN}` } : {}) };
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`HTTP_${response.status}`);
      const rates = parseRates(await response.json(), today, to);
      const now = Date.now();
      for (const r of rates) {
        await pool.query(
          `INSERT INTO competitor_rates(owner_id,competitor_id,stay_date,rate_cents,sold_out,source,captured_at) VALUES($1,$2,$3,$4,$5,'api',$6)
           ON CONFLICT(owner_id,competitor_id,stay_date) DO UPDATE SET previous_rate_cents=CASE WHEN competitor_rates.rate_cents IS DISTINCT FROM EXCLUDED.rate_cents THEN competitor_rates.rate_cents ELSE competitor_rates.previous_rate_cents END,
             rate_cents=EXCLUDED.rate_cents,sold_out=EXCLUDED.sold_out,source='api',captured_at=EXCLUDED.captured_at`,
          [owner, c.id, r.date, r.rateCents, r.soldOut ? 1 : 0, now],
        );
      }
      await pool.query(`UPDATE competitors SET last_fetch_at=$1,last_fetch_error=NULL WHERE id=$2`, [now, c.id]);
      console.log(`Rate shopper: ${c.name}: ${rates.length} date(s).`);
    } catch (e) {
      await pool.query(`UPDATE competitors SET last_fetch_at=$1,last_fetch_error=$2 WHERE id=$3`, [Date.now(), String(e instanceof Error ? e.message : e).slice(0, 200), c.id]);
      console.error(`Rate shopper: ${c.name} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
} finally {
  await pool.end();
}
