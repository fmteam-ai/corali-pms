// Daily encrypted PostgreSQL backup (cron on ONE PMS instance, e.g. 03:40). Keeps the newest 14 in BACKUP_DIR
// (default /home/corali/backups/db, private 0700/0600). The file is useless without PMS_DOCUMENT_KEY, so a copy can
// be kept off the server (e.g. downloaded from cPanel File Manager) without exposing guests' data.
// Restore: node --env-file=runtime.env scripts/restore-db-backup.mjs FILE.dump.enc /tmp/restore.dump → pg_restore.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { backupName, encryptBuffer, expiredBackups } from "./db-backup-core.mjs";

const key = process.env.PMS_DOCUMENT_KEY;
if (!process.env.DATABASE_URL || !key) throw Error("Backup requires DATABASE_URL and PMS_DOCUMENT_KEY");
const dir = path.resolve(process.env.BACKUP_DIR?.trim() || "/home/corali/backups/db");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);

// v189: every backup is recorded (PMS → Αξιοπιστία shows a missing or failed backup), and on Sundays (or with
// REHEARSAL_EVERY_RUN=1) the restore rehearsal runs right after it.
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl(), max: 1 });
const startedAt = Date.now();
const runId = await db.query(`INSERT INTO backup_runs(owner_id,kind,started_at,status) VALUES($1,'backup',$2,'running') RETURNING id`, [owner, startedAt]).then((r) => Number(r.rows[0].id)).catch(() => null);
let out = "", failure = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corali-db-"));
const plain = path.join(tmp, "backup.dump");
try {
  const r = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "backup-postgres.mjs"), plain], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw Error(`pg_dump step failed (${r.status})`);
  out = path.join(dir, backupName(new Date()));
  fs.writeFileSync(out, encryptBuffer(fs.readFileSync(plain), key), { mode: 0o600 });
  for (const old of expiredBackups(fs.readdirSync(dir), Number(process.env.BACKUP_KEEP) || 14)) fs.rmSync(path.join(dir, old));
  console.log(`Encrypted backup: ${out} (${fs.statSync(out).size} bytes)`);
} catch (e) {
  failure = e instanceof Error ? e.message : String(e);
  throw e;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (runId) await db.query(`UPDATE backup_runs SET finished_at=$2,status=$3,file=$4,size_bytes=$5,error=$6 WHERE id=$1`, [runId, Date.now(), failure ? "failed" : "ok", out ? path.basename(out) : "", out && !failure ? fs.statSync(out).size : 0, failure.slice(0, 500)]).catch(() => {});
  await db.end().catch(() => {});
}
const sunday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date()) === "Sun";
if (sunday || process.env.REHEARSAL_EVERY_RUN === "1") {
  const r = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "run-restore-rehearsal.mjs"), dir], { stdio: "inherit", env: process.env });
  if (r.status !== 0) process.exitCode = 1;
}
