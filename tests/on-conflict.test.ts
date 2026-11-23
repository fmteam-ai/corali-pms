import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// v187: every «INSERT … ON CONFLICT (columns)» in the code must match a unique index PostgreSQL can infer. A partial
// unique index (… WHERE x IS NOT NULL) is NOT inferred without the same WHERE, and PostgreSQL rejects the statement
// (42P10) — this broke the Stripe booking fulfilment until v187. Each statement is planned (EXPLAIN) on the schema.
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) { if (!["node_modules", ".next"].includes(f)) files(p, out); }
    else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

test("every ON CONFLICT target matches a unique index PostgreSQL can use", async () => {
  const found = new Map<string, string>();
  for (const f of [...files("lib"), ...files("app"), ...files("scripts")]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/INSERT INTO\s+"?([a-z_]+)"?\s*\(([^)]*)\)[\s\S]{0,1200}?ON CONFLICT\s*\(([^)]+)\)(\s*WHERE[^D]*)?\s*DO/gi)) {
      const between = m[0];
      if (/INSERT INTO/i.test(between.slice(11))) continue; // matched across two statements
      const key = `${m[1]}(${m[3].replace(/\s+/g, "")})${m[4] ? m[4].trim() : ""}`;
      if (!found.has(key)) found.set(key, f);
    }
  }
  assert.ok(found.size > 30, `only ${found.size} statements found`);
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const bad: string[] = [];
    for (const [key, file] of found) {
      const m = /^([a-z_]+)\(([^)]+)\)(.*)$/i.exec(key)!;
      try { await db.query(`EXPLAIN INSERT INTO "${m[1]}" DEFAULT VALUES ON CONFLICT (${m[2]}) ${m[3]} DO NOTHING`); }
      catch (e) { bad.push(`${key} — ${file}: ${e instanceof Error ? e.message : e}`); }
    }
    assert.deepEqual(bad, []);
  } finally { await db.close(); }
});
