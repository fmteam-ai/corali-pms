#!/usr/bin/env node
// v201 Corali Sentinel (PMS instance only). cPanel cron every 5 minutes:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-sentinel.mjs
// Read-only against production data; writes only sentinel_runs / sentinel_incidents. One JSON log line per run.
import process from "node:process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { runSentinel } from "./sentinel-core.mjs";

if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl(), max: 2 });
// v202: the checks read through their own pool whose connections PostgreSQL itself keeps read-only.
const readPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl(), max: 4, options: "-c default_transaction_read_only=on" });
const correlationId = randomUUID(), started = Date.now();
const hardStop = setTimeout(() => { console.error(JSON.stringify({ event: "sentinel_run", correlationId, status: "timeout", ms: Date.now() - started })); process.exit(2); }, 120_000);
try {
  // Only one Sentinel run at a time (an overlapping cron start exits at once).
  const lock = (await pool.query(`SELECT pg_try_advisory_lock(hashtext('corali-sentinel:' || $1)) ok`, [owner])).rows[0].ok;
  if (!lock) { console.log(JSON.stringify({ event: "sentinel_run", correlationId, status: "skipped_overlap" })); }
  else {
    const r = await runSentinel({ pool, owner, now: Date.now(), correlationId, readPool });
    console.log(JSON.stringify({ event: "sentinel_run", ...r, ms: Date.now() - started }));
  }
} catch (e) {
  console.error(JSON.stringify({ event: "sentinel_run", correlationId, status: "error", error: String(e?.message ?? e).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  clearTimeout(hardStop);
  await Promise.all([pool.end(), readPool.end()]);
}
