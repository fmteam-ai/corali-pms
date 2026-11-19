import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The cPanel package copies an explicit list of scripts. A packaged script that imports a sibling
// missing from that list crashes the whole cron run on the server (ERR_MODULE_NOT_FOUND).
function packagedScripts(file: string) {
  return new Set(readFileSync(file, "utf8").match(/scripts\/[\w.-]+\.mjs/g) ?? []);
}

for (const list of ["scripts/package-cpanel.sh", "scripts/verify-package.sh"]) {
  test(`every relative import of a packaged script is packaged too (${list})`, () => {
    const packaged = packagedScripts(list);
    const missing: string[] = [];
    for (const script of packaged) {
      const source = readFileSync(script, "utf8");
      for (const [, name] of source.matchAll(/(?:from|import\()\s*["']\.\/([\w.-]+\.mjs)["']/g)) {
        if (!packaged.has(`scripts/${name}`)) missing.push(`${script} → scripts/${name}`);
      }
    }
    assert.deepEqual(missing, []);
  });
}
