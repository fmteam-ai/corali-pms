import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conflictTargets, explainSql } from "../scripts/conflict-targets-core.mjs";
import { PGlite } from "@electric-sql/pglite";

// v187: every «INSERT … ON CONFLICT (columns)» in the code must match a unique index PostgreSQL can infer. A partial
// unique index (… WHERE x IS NOT NULL) is NOT inferred without the same WHERE, and PostgreSQL rejects the statement
// (42P10) — this broke the Stripe booking fulfilment until v187. Each statement is planned (EXPLAIN) on the schema.
test("every ON CONFLICT target matches a unique index PostgreSQL can use", async () => {
  const found = conflictTargets(".");
  assert.ok(found.size > 30, `only ${found.size} statements found`);
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const bad: string[] = [];
    for (const [key, file] of found) {
      try { await db.query(explainSql(key)); }
      catch (e) { bad.push(`${key} — ${file}: ${e instanceof Error ? e.message : e}`); }
    }
    assert.deepEqual(bad, []);
  } finally { await db.close(); }
});
