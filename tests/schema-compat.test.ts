// The hotel's cPanel PostgreSQL is older than the one used in development (PGlite): v161 shipped a trigger written
// with `EXECUTE FUNCTION` (PostgreSQL 11+), so every install from v161 to v164 failed with a syntax error (42601)
// and rolled back to v160. Keep the schema to syntax that older servers accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync(new URL("../server/postgres-schema.sql", import.meta.url), "utf8");

test("schema: triggers use EXECUTE PROCEDURE (EXECUTE FUNCTION needs PostgreSQL 11+)", () => {
  assert.equal(/EXECUTE\s+FUNCTION/i.test(schema), false);
  for (const m of schema.matchAll(/CREATE\s+TRIGGER[^;]+;/gi)) assert.match(m[0], /EXECUTE\s+PROCEDURE/i, m[0].slice(0, 80));
});

test("schema: no syntax newer than the hotel's PostgreSQL", () => {
  const newer = [/GENERATED\s+(ALWAYS|BY\s+DEFAULT)/i, /CREATE\s+(OR\s+REPLACE\s+)?PROCEDURE/i, /CREATE\s+OR\s+REPLACE\s+TRIGGER/i, /\bINCLUDE\s*\(/i, /\bAS\s+(NOT\s+)?MATERIALIZED\b/i, /NULLS\s+NOT\s+DISTINCT/i, /\bMERGE\s+INTO\b/i, /jsonb_path_/i, /gen_random_uuid\s*\(/i];
  for (const re of newer) assert.equal(re.test(schema), false, String(re));
});
