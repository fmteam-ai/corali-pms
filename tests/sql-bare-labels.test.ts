import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// v202: the hotel's PostgreSQL (older than 14) rejects a column label that is a keyword unless it is written with AS
// («SELECT max(x) last» fails, «SELECT max(x) AS last» works). Newer PostgreSQL (and PGlite in the tests) accepts both,
// so a bare keyword label passes every test and fails only in production — this scan catches it in every SQL string.
const KEYWORDS = "absolute|action|admin|after|all|always|any|array|at|before|begin|between|by|cache|called|cascade|case|cast|check|close|collate|column|comment|commit|constraint|content|cost|create|cross|current|cursor|cycle|data|day|default|delete|do|document|domain|double|else|enable|event|except|exclude|execute|exists|external|false|family|fetch|filter|first|following|for|format|from|full|function|global|grant|group|handler|having|header|hold|hour|identity|if|immediate|import|in|include|index|inline|input|insert|instead|into|is|key|label|language|large|last|leading|level|limit|local|location|lock|locked|mapping|match|method|minute|mode|month|move|name|names|new|next|no|none|not|nothing|null|object|of|off|offset|old|on|only|operator|option|options|or|order|over|owner|parser|partial|partition|password|policy|position|prepare|primary|prior|privileges|procedure|program|quote|range|read|ref|references|refresh|release|rename|replace|reset|restart|return|returns|revoke|role|rollback|routine|row|rows|rule|schema|search|second|security|select|sequence|server|session|set|share|show|simple|skip|some|stable|start|statement|statistics|storage|strict|support|system|table|tables|temp|template|text|then|ties|time|timestamp|to|trailing|transaction|trigger|true|truncate|type|types|union|unique|until|update|user|using|valid|value|values|version|view|views|when|where|window|with|within|without|work|write|year|yes|zone";
const BARE = new RegExp(`(?:\\)(?:::\\w+)?|\\b\\w+\\.\\w+)\\s+(${KEYWORDS})\\s*(?:,|\\bFROM\\b)`, "i");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "android-tv"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(mjs|ts|tsx)$/.test(name) && !p.startsWith("tests")) yield p;
  }
}

test("v202 SQL: no keyword column label without AS (the hotel's PostgreSQL < 14 rejects it)", () => {
  const found: string[] = [];
  for (const dir of ["scripts", "lib", "app"]) for (const f of files(dir)) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (!/\bSELECT\b/.test(line)) return;
      const m = BARE.exec(line);
      if (m) found.push(`${f}:${i + 1} «${m[0].trim()}»`);
    });
  }
  assert.deepEqual(found, [], `write these labels with AS:\n${found.join("\n")}`);
});
