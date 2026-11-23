// v189 backup restore rehearsal (weekly, after the Sunday backup; or by hand):
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-restore-rehearsal.mjs
// Takes the newest encrypted backup in BACKUP_DIR, decrypts it, reads the archive, and — when REHEARSAL_DATABASE_URL
// names a separate, empty database (cPanel → PostgreSQL Databases, e.g. corali_rehearsal) — restores it there,
// counts the key tables against the live database and empties the rehearsal database again. The result is kept in
// backup_runs and shown in PMS → Αξιοπιστία → Αντίγραφα ασφαλείας. The live database is only read.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { decryptBuffer } from "./db-backup-core.mjs";
import { CRITICAL_TABLES, backupTime, evaluateRehearsal, newestBackup, sameDatabase, tablesWithData } from "./restore-rehearsal-core.mjs";

const live = process.env.DATABASE_URL, key = process.env.PMS_DOCUMENT_KEY, target = process.env.REHEARSAL_DATABASE_URL?.trim() || "";
if (!live || !key) throw Error("DATABASE_URL and PMS_DOCUMENT_KEY are required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const dir = path.resolve(process.argv[2] || process.env.BACKUP_DIR?.trim() || "/home/corali/backups/db");
const restoreBin = process.env.PG_RESTORE_BIN?.trim() || (process.env.PG_DUMP_BIN?.trim() ? path.join(path.dirname(process.env.PG_DUMP_BIN.trim()), "pg_restore") : "pg_restore");
const pool = new pg.Pool({ connectionString: live, ssl: databaseSsl(), statement_timeout: 60_000 });
const startedAt = Date.now();
const runId = Number((await pool.query(`INSERT INTO backup_runs(owner_id,kind,started_at,status) VALUES($1,'rehearsal',$2,'running') RETURNING id`, [owner, startedAt])).rows[0].id);

const pgEnv = (url) => {
  const u = new URL(url);
  return { ...process.env, PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: process.env.DATABASE_SSL === "true" ? "verify-full" : "disable" };
};
const conn = (url) => { const u = new URL(url); return [`--host=${u.hostname}`, `--port=${u.port || "5432"}`, `--username=${decodeURIComponent(u.username)}`, `--dbname=${decodeURIComponent(u.pathname.replace(/^\//, ""))}`]; };
function sh(args, env) {
  const r = spawnSync(restoreBin, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000 });
  if (r.error?.code === "ENOENT") throw Error("pg_restore not found (set PG_RESTORE_BIN)");
  if (r.error) throw r.error;
  return r;
}

async function counts(client, tables, beforeMs) {
  const out = {};
  for (const t of tables) {
    const exists = (await client.query(`SELECT to_regclass($1) IS NOT NULL ok, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$2 AND column_name='created_at') dated`, [`public.${t}`, t])).rows[0];
    if (!exists.ok) continue;
    out[t] = Number((await client.query(`SELECT count(*)::bigint n FROM public."${t}"${beforeMs && exists.dated ? " WHERE created_at<=$1" : ""}`, beforeMs && exists.dated ? [beforeMs] : [])).rows[0].n);
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corali-rehearsal-"));
let result = { status: "failed", checks: [] }, error = "", file = "", size = 0;
try {
  const name = newestBackup(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  if (!name) throw Error(`Δεν βρέθηκε αντίγραφο στο ${dir}`);
  file = name;
  size = fs.statSync(path.join(dir, name)).size;
  const plain = path.join(tmp, "backup.dump");
  let decryptOk = true;
  try { fs.writeFileSync(plain, decryptBuffer(fs.readFileSync(path.join(dir, name)), key), { mode: 0o600 }); } catch (e) { decryptOk = false; throw Error(`Αποκρυπτογράφηση απέτυχε: ${e instanceof Error ? e.message : e}`); }
  const list = sh(["--list", plain], process.env);
  if (list.status !== 0) throw Error(`pg_restore --list: ${String(list.stderr).slice(0, 300)}`);
  const toc = tablesWithData(list.stdout);
  const at = backupTime(name);
  const liveBefore = await counts(pool, CRITICAL_TABLES, at);
  let restored = null;
  if (target) {
    if (sameDatabase(target, live)) throw Error("REHEARSAL_DATABASE_URL είναι η ίδια βάση με την παραγωγή — η δοκιμή ακυρώθηκε");
    const r = sh(["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", ...conn(target), plain], pgEnv(target));
    if (r.status !== 0) throw Error(`Η επαναφορά απέτυχε: ${String(r.stderr).slice(-400)}`);
    const rehearsal = new pg.Client({ connectionString: target, ssl: databaseSsl() });
    await rehearsal.connect();
    try {
      restored = await counts(rehearsal, CRITICAL_TABLES, null);
      // Leave the rehearsal database empty (guests' data is not kept twice).
      await rehearsal.query("DROP SCHEMA public CASCADE");
      await rehearsal.query("CREATE SCHEMA public");
    } finally { await rehearsal.end(); }
  }
  result = evaluateRehearsal({ toc, restored, liveBefore, decryptOk });
  result.liveBefore = liveBefore; result.restored = restored; result.tables = toc.size; result.backupAt = at;
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const status = error ? "failed" : result.status;
await pool.query(`UPDATE backup_runs SET finished_at=$2,status=$3,file=$4,size_bytes=$5,details_json=$6,error=$7 WHERE id=$1`, [runId, Date.now(), status, file, size, JSON.stringify(result), error.slice(0, 500)]);
if (status === "failed") await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/reliability',$4)`, [owner, `⚠️ Η δοκιμαστική επαναφορά αντιγράφου ασφαλείας απέτυχε: ${(error || result.checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.detail ?? ""}`).join(" · ")).slice(0, 220)}`, "⚠️ Backup restore rehearsal failed (see Reliability center)", Date.now()]);
await pool.end();
console.log(`Restore rehearsal: ${status}${file ? ` (${file})` : ""}${error ? ` — ${error}` : ""}`);
for (const c of result.checks) console.log(` ${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
if (status === "failed") process.exitCode = 1;
