// v189 post-install check (INSTALL-CPANEL.sh runs it on the staged release, after the migrations and before the
// switch; a failure stops the installation and rolls it back):
//   node --env-file=STAGE/runtime.env STAGE/scripts/post-install-check.mjs STAGE VERSION [--require-evidence] [--no-db]
// 1) the files are the ones of the package that passed QA (RELEASE-EVIDENCE.json hashes);
// 2) every ON CONFLICT target of the code is planned on the PRODUCTION database (unique index PostgreSQL can infer);
// 3) every table of the schema exists.
// The result is stored in release_checks and shown in PMS → Αξιοπιστία → Έκδοση & έλεγχοι.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { EVIDENCE_FILE, verifyManifest } from "./release-evidence-core.mjs";
import { explainSql } from "./conflict-targets-core.mjs";

const [dirArg, version] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const requireEvidence = process.argv.includes("--require-evidence"), noDb = process.argv.includes("--no-db");
if (!dirArg || !version) throw Error("Usage: post-install-check.mjs DIR VERSION [--require-evidence] [--no-db]");
const dir = path.resolve(dirArg);
const checks = [];
const check = (name, status, detail = "") => { checks.push({ name, status, detail }); console.log(`${status === "ok" ? "OK  " : status === "warn" ? "WARN" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

let qa = {};
const evidencePath = path.join(dir, EVIDENCE_FILE);
if (!existsSync(evidencePath)) check("Αποδεικτικό QA πακέτου", requireEvidence ? "fail" : "warn", "το πακέτο δεν έχει RELEASE-EVIDENCE.json");
else {
  const ev = JSON.parse(readFileSync(evidencePath, "utf8"));
  qa = { ...ev.qa, contentHash: ev.contentHash, files: Object.keys(ev.files ?? {}).length };
  if (ev.version !== version) check("Αποδεικτικό QA πακέτου", "fail", `για ${ev.version}, όχι ${version}`);
  else if (ev.qa?.verdict !== "PASS") check("Αποδεικτικό QA πακέτου", "fail", `QA ${ev.qa?.verdict ?? "—"}`);
  else check("Αποδεικτικό QA πακέτου", "ok", `QA ${ev.qa.passed}/${ev.qa.total} PASS (${String(ev.qa.at).slice(0, 10)}, commit ${ev.qa.commit})`);
  const v = verifyManifest(dir, ev.files ?? {});
  check("Αρχεία ίδια με το ελεγμένο πακέτο", v.ok ? "ok" : "fail", v.ok ? `${v.total} αρχεία` : `${v.changed.length} διαφορετικά, ${v.missing.length} λείπουν: ${[...v.changed, ...v.missing].slice(0, 5).join(", ")}`);
}

if (!noDb) {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required (or --no-db)");
  const { default: pg } = await import("pg");
  const { databaseSsl } = await import("./database-config.mjs");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl(), statement_timeout: 30_000 });
  await client.connect();
  try {
    const targetsFile = path.join(dir, "server", "conflict-targets.json");
    if (!existsSync(targetsFile)) check("ON CONFLICT στη βάση παραγωγής", "warn", "δεν υπάρχει server/conflict-targets.json");
    else {
      const targets = JSON.parse(readFileSync(targetsFile, "utf8"));
      const bad = [];
      for (const t of targets) { try { await client.query(explainSql(t.target)); } catch (e) { bad.push(`${t.target} (${t.file}): ${e instanceof Error ? e.message : e}`); } }
      check("ON CONFLICT στη βάση παραγωγής", bad.length ? "fail" : "ok", bad.length ? bad.slice(0, 3).join(" · ") : `${targets.length} εντολές με κατάλληλο μοναδικό index`);
    }
    const schema = readFileSync(path.join(dir, "server", "postgres-schema.sql"), "utf8");
    const tables = [...new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+"?([a-z_]+)"?/gi)].map((m) => m[1]))];
    const missing = [];
    for (const t of tables) if (!(await client.query(`SELECT to_regclass($1) IS NOT NULL ok`, [`public.${t}`])).rows[0].ok) missing.push(t);
    check("Πίνακες σχήματος", missing.length ? "fail" : "ok", missing.length ? `λείπουν: ${missing.slice(0, 8).join(", ")}` : `${tables.length} πίνακες`);
    const status = checks.some((c) => c.status === "fail") ? "failed" : checks.some((c) => c.status === "warn") ? "unverified" : "ok";
    await client.query(`INSERT INTO release_checks(version,ran_at,status,checks_json,qa_json,scope) VALUES($1,$2,$3,$4,$5,'installation')`, [version, Date.now(), status, JSON.stringify(checks), JSON.stringify(qa)]);
  } finally { await client.end(); }
}
const failed = checks.filter((c) => c.status === "fail");
if (failed.length) { console.error(`POST-INSTALL CHECK FAILED: ${failed.map((c) => c.name).join(", ")}`); process.exit(1); }
console.log("Post-install check: OK");
