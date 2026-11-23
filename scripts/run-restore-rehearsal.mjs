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
import { randomBytes } from "node:crypto";
import { CRITICAL_TABLES, REHEARSAL_MARKER, backupTime, evaluateRehearsal, newestBackup, sameDatabase, tablesWithData, targetDecision } from "./restore-rehearsal-core.mjs";
import { raiseAlert } from "./alert-core.mjs";

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
// v190: once anything may have been written to the target, it is emptied in `finally` whatever happened, and the
// emptying is verified; a target that could not be emptied is a critical alert (it may hold guests' data).
let touched = false, cleanup = { needed: false, ok: true, detail: "" };
const targetTables = async (c) => (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r) => String(r.table_name));
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
  const notes = [];
  if (target) {
    // Never the live database: by address, and by a random value written to the live database and looked for there.
    const nonce = randomBytes(16).toString("hex");
    await pool.query(`INSERT INTO rehearsal_guard(nonce,created_at) VALUES($1,$2)`, [nonce, Date.now()]);
    const rehearsal = new pg.Client({ connectionString: target, ssl: databaseSsl() });
    await rehearsal.connect();
    try {
      const seen = await rehearsal.query(`SELECT 1 FROM rehearsal_guard WHERE nonce=$1`, [nonce]).then((r) => r.rows.length > 0, () => false);
      const tables = await targetTables(rehearsal);
      const decision = targetDecision({ sameUrl: sameDatabase(target, live), nonceSeen: seen, tables, marker: tables.includes(REHEARSAL_MARKER) });
      if (!decision.ok) throw Error(decision.reason);
      // Least privilege: the rehearsal login should not be able to open the live database.
      const liveName = decodeURIComponent(new URL(live).pathname.replace(/^\//, ""));
      const canLive = await rehearsal.query(`SELECT has_database_privilege(current_user,$1,'CONNECT') ok`, [liveName]).then((r) => Boolean(r.rows[0]?.ok), () => false);
      if (canLive) notes.push(`ο χρήστης της βάσης δοκιμής μπορεί να συνδεθεί και στη βάση παραγωγής «${liveName}» — συνιστάται ξεχωριστός χρήστης μόνο για τη βάση δοκιμής`);
      touched = true;
      cleanup.needed = true;
      const r = sh(["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", ...conn(target), plain], pgEnv(target));
      if (r.status !== 0) throw Error(`Η επαναφορά απέτυχε: ${String(r.stderr).slice(-400)}`);
      restored = await counts(rehearsal, CRITICAL_TABLES, null);
    } finally {
      if (touched) {
        try {
          await rehearsal.query("DROP SCHEMA IF EXISTS public CASCADE");
          await rehearsal.query("CREATE SCHEMA public");
          await rehearsal.query(`CREATE TABLE ${REHEARSAL_MARKER}(created_at BIGINT NOT NULL)`);
          await rehearsal.query(`INSERT INTO ${REHEARSAL_MARKER}(created_at) VALUES($1)`, [Date.now()]);
          const left = (await targetTables(rehearsal)).filter((t) => t !== REHEARSAL_MARKER);
          cleanup = { needed: true, ok: left.length === 0, detail: left.length ? `παρέμειναν πίνακες: ${left.slice(0, 5).join(", ")}` : "η βάση δοκιμής άδειασε" };
        } catch (e) {
          cleanup = { needed: true, ok: false, detail: `ο καθαρισμός απέτυχε: ${e instanceof Error ? e.message : e}` };
        }
      }
      await rehearsal.end().catch(() => {});
      await pool.query(`DELETE FROM rehearsal_guard WHERE nonce=$1 OR created_at<$2`, [nonce, Date.now() - 86_400_000]).catch(() => {});
    }
  }
  result = evaluateRehearsal({ toc, restored, liveBefore, decryptOk });
  result.liveBefore = liveBefore; result.restored = restored; result.tables = toc.size; result.backupAt = at; result.notes = notes;
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (cleanup.needed) {
  result.checks = [...(result.checks ?? []), { name: "Καθαρισμός βάσης δοκιμής", ok: cleanup.ok, detail: cleanup.detail }];
  if (!cleanup.ok) {
    error = error || `Η βάση δοκιμής ΔΕΝ καθαρίστηκε: ${cleanup.detail}`;
    await raiseAlert({ pool, owner, key: `rehearsal:cleanup:${runId}`, area: "backups", severity: "fail", title: `Η βάση δοκιμής επαναφοράς δεν καθαρίστηκε και μπορεί να περιέχει προσωπικά δεδομένα πελατών (${cleanup.detail}). Αδειάστε την από cPanel → PostgreSQL.`, titleEn: "The restore rehearsal database was not emptied and may hold guests' data." }).catch(() => {});
  }
}
const status = error ? "failed" : result.status;
await pool.query(`UPDATE backup_runs SET finished_at=$2,status=$3,file=$4,size_bytes=$5,details_json=$6,error=$7 WHERE id=$1`, [runId, Date.now(), status, file, size, JSON.stringify(result), error.slice(0, 500)]);
if (status === "failed") await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/reliability',$4)`, [owner, `⚠️ Η δοκιμαστική επαναφορά αντιγράφου ασφαλείας απέτυχε: ${(error || result.checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.detail ?? ""}`).join(" · ")).slice(0, 220)}`, "⚠️ Backup restore rehearsal failed (see Reliability center)", Date.now()]);
await pool.end();
console.log(`Restore rehearsal: ${status}${file ? ` (${file})` : ""}${error ? ` — ${error}` : ""}`);
for (const c of result.checks) console.log(` ${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
if (status === "failed") process.exitCode = 1;
