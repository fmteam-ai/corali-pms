// Daily encrypted PostgreSQL backup (cron on ONE PMS instance, e.g. 03:40). Keeps the newest 14 in BACKUP_DIR
// (default /home/corali/backups/db, private 0700/0600). The file is useless without PMS_DOCUMENT_KEY, so a copy can
// be kept off the server (e.g. downloaded from cPanel File Manager) without exposing guests' data.
// Restore: node --env-file=runtime.env scripts/restore-db-backup.mjs FILE.dump.enc /tmp/restore.dump → pg_restore.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { backupName, encryptBuffer, expiredBackups } from "./db-backup-core.mjs";

const key = process.env.PMS_DOCUMENT_KEY;
if (!process.env.DATABASE_URL || !key) throw Error("Backup requires DATABASE_URL and PMS_DOCUMENT_KEY");
const dir = path.resolve(process.env.BACKUP_DIR?.trim() || "/home/corali/backups/db");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corali-db-"));
const plain = path.join(tmp, "backup.dump");
try {
  const r = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "backup-postgres.mjs"), plain], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw Error(`pg_dump step failed (${r.status})`);
  const out = path.join(dir, backupName(new Date()));
  fs.writeFileSync(out, encryptBuffer(fs.readFileSync(plain), key), { mode: 0o600 });
  for (const old of expiredBackups(fs.readdirSync(dir), Number(process.env.BACKUP_KEEP) || 14)) fs.rmSync(path.join(dir, old));
  console.log(`Encrypted backup: ${out} (${fs.statSync(out).size} bytes)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
