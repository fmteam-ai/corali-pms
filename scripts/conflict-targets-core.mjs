// v189: every «INSERT … ON CONFLICT (columns)» target in the code (lib, app, scripts). The test plans each one on the
// schema; the packager writes them to server/conflict-targets.json and the post-install check plans them on the
// PRODUCTION database before the new version goes live — a target PostgreSQL cannot infer (42P10, the v187 Stripe
// fault) stops the installation instead of breaking payments.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) { if (!["node_modules", ".next"].includes(f)) files(p, out); }
    else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

/** Map "table(cols)WHERE…" → first file using it. */
export function conflictTargets(root = ".", dirs = ["lib", "app", "scripts"]) {
  const found = new Map();
  for (const f of dirs.flatMap((d) => files(path.join(root, d)))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/INSERT INTO\s+"?([a-z_]+)"?\s*\(([^)]*)\)[\s\S]{0,1200}?ON CONFLICT\s*\(([^)]+)\)(\s*WHERE[^D]*)?\s*DO/gi)) {
      if (/INSERT INTO/i.test(m[0].slice(11))) continue; // matched across two statements
      const key = `${m[1]}(${m[3].replace(/\s+/g, "")})${m[4] ? m[4].trim() : ""}`;
      if (!found.has(key)) found.set(key, path.relative(root, f));
    }
  }
  return found;
}

/** The statement that plans (never runs) an insert with this target. */
export function explainSql(key) {
  const m = /^([a-z_]+)\(([^)]+)\)(.*)$/i.exec(key);
  if (!m) throw Error(`BAD_TARGET ${key}`);
  return `EXPLAIN INSERT INTO "${m[1]}" DEFAULT VALUES ON CONFLICT (${m[2]}) ${m[3]} DO NOTHING`;
}
