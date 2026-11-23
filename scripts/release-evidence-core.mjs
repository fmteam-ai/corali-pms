// v189 release evidence: the package carries RELEASE-EVIDENCE.json — the QA verdict of this exact package and a
// SHA-256 of every file in it. The post-install check recomputes the hashes of the installed files, so «the code
// running is the code that passed QA» is verified on the server, not assumed.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

export const EVIDENCE_FILE = "RELEASE-EVIDENCE.json";
// Written on the server after installation (never part of the package).
const SKIP = new Set([EVIDENCE_FILE, "runtime.env", "tmp", "logs", "uploads", ".env"]);

export function fileManifest(dir) {
  const out = {};
  const walk = (rel) => {
    for (const f of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${f}` : f;
      if (!rel && SKIP.has(f)) continue;
      const st = statSync(path.join(dir, r));
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out[r] = createHash("sha256").update(readFileSync(path.join(dir, r))).digest("hex");
    }
  };
  walk("");
  return out;
}

export function contentHash(manifest) {
  const h = createHash("sha256");
  for (const k of Object.keys(manifest).sort()) h.update(`${k}\0${manifest[k]}\n`);
  return h.digest("hex");
}

/** Files of the evidence that are missing or different in dir (files added on the server are ignored). */
export function verifyManifest(dir, manifest) {
  const missing = [], changed = [];
  for (const [rel, hash] of Object.entries(manifest)) {
    const p = path.join(dir, rel);
    if (!existsSync(p)) { missing.push(rel); continue; }
    if (createHash("sha256").update(readFileSync(p)).digest("hex") !== hash) changed.push(rel);
  }
  return { total: Object.keys(manifest).length, missing, changed, ok: !missing.length && !changed.length };
}

/** The QA summary kept in the evidence (no file lists or logs). */
export function qaSummary(report) {
  return {
    version: report.version, verdict: report.verdict, at: report.at, commit: report.commit, database: report.database,
    // v198: the archive this QA tested (the final archive = the same files + this evidence file).
    testedPackageSha256: report.package?.sha256 ?? null,
    passed: report.flows.filter((f) => f.status === "PASS").length, total: report.flows.length,
    flows: report.flows.map((f) => ({ id: f.id, name: f.name, status: f.status })),
    sandbox: (report.sandbox ?? []).map((s) => ({ name: s.name, status: s.status })),
    acceptance: report.acceptance ?? null,
  };
}
