import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("v201 release hash: published from the FINAL archive; a rebuilt archive makes the check fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin-")), stage = join(dir, "stage"), qa = join(dir, "qa"), archive = join(dir, "corali-pms-cpanel-v201-root.tar.gz");
  mkdirSync(stage); mkdirSync(qa);
  const report = { version: "v201", verdict: "PASS", at: "2026-11-23T10:00:00.000Z", commit: "abc1234", package: { file: "corali-pms-cpanel-v201-root.tar.gz", sha256: "a".repeat(64) }, flows: [] };
  writeFileSync(join(qa, "qa-report-v201.json"), JSON.stringify(report));
  writeFileSync(join(qa, "QA-REPORT-v201.md"), "# r\n\n**Αποτέλεσμα: PASS**\n\n- Πακέτο: `x` · SHA-256 `aaaa`\n- Κώδικας: commit\n");
  writeFileSync(join(stage, "app.js"), "x");
  writeFileSync(join(stage, "RELEASE-EVIDENCE.json"), JSON.stringify({ version: "v201", contentHash: "c".repeat(64), files: [{ path: "app.js" }], qa: { verdict: "PASS", at: report.at, commit: "abc1234", testedPackageSha256: "a".repeat(64) } }));
  execFileSync("tar", ["-C", stage, "-czf", archive, "."]);
  const run = (...a: string[]) => spawnSync(process.execPath, [resolve("scripts/finalize-release.mjs"), ...a], { encoding: "utf8" });
  const f = run("finalize", archive, "v201", qa);
  assert.equal(f.status, 0, f.stderr);
  const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const out = JSON.parse(readFileSync(join(qa, "qa-report-v201.json"), "utf8"));
  assert.equal(out.package.final.sha256, sha);
  assert.equal(out.package.tested.sha256, "a".repeat(64));
  assert.match(readFileSync(join(qa, "QA-REPORT-v201.md"), "utf8"), new RegExp(`Τελικό πακέτο προς εγκατάσταση:.*${sha}`));
  assert.equal(readFileSync(`${archive}.sha256`, "utf8").split(/\s+/)[0], sha);
  assert.equal(run("check", archive, "v201", qa).status, 0);
  // The archive rebuilt after the report (different content) → the check refuses it.
  writeFileSync(join(stage, "app.js"), "changed");
  execFileSync("tar", ["-C", stage, "-czf", archive, "."]);
  const c = run("check", archive, "v201", qa);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /\.sha256 ≠ archive/);
  // Evidence that names another tested archive is refused at finalize.
  writeFileSync(join(stage, "RELEASE-EVIDENCE.json"), JSON.stringify({ version: "v201", contentHash: "c", files: [], qa: { verdict: "PASS", at: report.at, commit: "abc1234", testedPackageSha256: "b".repeat(64) } }));
  writeFileSync(join(qa, "qa-report-v201.json"), JSON.stringify(report));
  execFileSync("tar", ["-C", stage, "-czf", archive, "."]);
  assert.equal(run("finalize", archive, "v201", qa).status, 1);
});
