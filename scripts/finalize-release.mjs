#!/usr/bin/env node
// v198: one final archive, one published hash. The QA runs on the archive of the tested files; the archive that is
// handed over is then built ONCE more with RELEASE-EVIDENCE.json added. This script runs after that final build:
//   finalize  — computes the SHA-256 of the FINAL archive, checks that its RELEASE-EVIDENCE.json is the one of this QA
//               report (version, verdict, commit, tested archive), writes the .sha256 file from that same computation
//               and publishes it in the QA report (QA-REPORT-<v>.md / qa-report-<v>.json → package.final);
//   check     — at the very end of the build: the archive on disk, its .sha256 file, the QA report and the web
//               installer all name the same hash. Any difference (the archive was rebuilt after the report) → exit 1.
//
//   node scripts/finalize-release.mjs finalize <archive> <version> <qa-dir>
//   node scripts/finalize-release.mjs check    <archive> <version> <qa-dir> [installer.php]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [mode, archive, version, qaDir, installer] = process.argv.slice(2);
if (!["finalize", "check"].includes(mode) || !archive || !version || !qaDir) { console.error("usage: finalize-release.mjs finalize|check <archive> <version> <qa-dir> [installer.php]"); process.exit(2); }
const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
const jsonPath = path.join(qaDir, `qa-report-${version}.json`), mdPath = path.join(qaDir, `QA-REPORT-${version}.md`), shaPath = `${archive}.sha256`;
const report = JSON.parse(readFileSync(jsonPath, "utf8"));
const fail = (m) => { console.error(`RELEASE HASH: ${m}`); process.exit(1); };

if (mode === "finalize") {
  const evidence = JSON.parse(execFileSync("tar", ["-xzf", archive, "-O", "./RELEASE-EVIDENCE.json"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8"));
  if (evidence.version !== version) fail(`evidence version ${evidence.version} ≠ ${version}`);
  for (const k of ["verdict", "commit", "at"]) if (evidence.qa?.[k] !== report[k]) fail(`evidence ${k} «${evidence.qa?.[k]}» ≠ report «${report[k]}»`);
  if (evidence.qa?.testedPackageSha256 !== report.package.sha256) fail("the evidence does not name the archive this report tested");
  const tested = report.package.tested ?? { file: report.package.file, sha256: report.package.sha256 };
  report.package = { ...report.package, tested, final: { file: path.basename(archive), sha256: sha, contentHash: evidence.contentHash, files: Array.isArray(evidence.files) ? evidence.files.length : evidence.files && typeof evidence.files === "object" ? Object.keys(evidence.files).length : null, addedAfterQa: ["RELEASE-EVIDENCE.json"], finalizedAt: new Date().toISOString() } };
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const md = readFileSync(mdPath, "utf8").split("\n");
  const i = md.findIndex((l) => l.startsWith("- Πακέτο:"));
  const lines = [
    `- **Τελικό πακέτο προς εγκατάσταση:** \`${path.basename(archive)}\` · SHA-256 \`${sha}\``,
    `  - Ελέγχθηκε το archive SHA-256 \`${tested.sha256}\` (${report.package.final.files} αρχεία, contentHash \`${evidence.contentHash.slice(0, 16)}…\`); το τελικό είναι τα ίδια αρχεία + \`RELEASE-EVIDENCE.json\` (το αποδεικτικό αυτού του ελέγχου). Ο έλεγχος μετά την εγκατάσταση επαληθεύει κάθε αρχείο.`,
  ];
  if (i >= 0) md.splice(i, 1, ...lines); else md.splice(4, 0, ...lines);
  writeFileSync(mdPath, md.join("\n"));
  writeFileSync(shaPath, `${sha}  ${path.basename(archive)}\n`);
  console.log(`${sha}  ${path.basename(archive)}`);
} else {
  const problems = [];
  if (!existsSync(shaPath)) problems.push(".sha256 λείπει");
  else if (readFileSync(shaPath, "utf8").split(/\s+/)[0] !== sha) problems.push(".sha256 ≠ archive");
  if (report.package?.final?.sha256 !== sha) problems.push(`QA report (${report.package?.final?.sha256 ?? "χωρίς τελικό hash"}) ≠ archive`);
  if (!readFileSync(mdPath, "utf8").includes(sha)) problems.push("QA-REPORT.md δεν αναφέρει το hash του archive");
  if (installer && !readFileSync(installer, "utf8").includes(sha.slice(0, 20))) problems.push("ο web installer δεν αναφέρει το hash του archive");
  if (problems.length) fail(`${problems.join(" · ")} — το archive ξαναχτίστηκε μετά το αποδεικτικό; τρέξτε ξανά τη δημιουργία πακέτου`);
  console.log(`RELEASE HASH OK — ${sha} (archive = .sha256 = QA report${installer ? " = installer" : ""})`);
}
