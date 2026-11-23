import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// v203: one release version everywhere it is checked at build / install time (a stale one failed two builds).
test("release version is the same in every file that checks it at build or install time", () => {
  const version = /^VERSION="(v\d+)"/m.exec(readFileSync("INSTALL-CPANEL.sh", "utf8"))![1];
  const files: Record<string, RegExp> = {
    "web-installer/corali-installer.php.template": /CORALI_INSTALLER_RELEASE = '(v\d+)'/,
    "scripts/package-cpanel.sh": /printf '(v\d+)\\n' > "\$stage\/DEPLOY_VERSION.txt"/,
    "scripts/verify-package.sh": /\[\[ "\$version" == "(v\d+)" \]\]/,
    "scripts/smoke-runtime.sh": /expected_version="\$\{2:-(v\d+)\}"/,
    "lib/reliability.ts": /RUNNING_VERSION = "(v\d+)"/,
    "app/api/health/route.ts": /version: "(v\d+)"/,
  };
  for (const [f, re] of Object.entries(files)) {
    const m = re.exec(readFileSync(f, "utf8"));
    assert.ok(m, `${f}: version not found`);
    assert.equal(m![1], version, f);
  }
  // No other release number in the files that name the package or check the version.
  for (const f of ["web-installer/corali-installer.php.template", "scripts/package-cpanel.sh", "scripts/verify-package.sh", "scripts/build-web-installer.mjs", "tests/package-http-smoke.sh", "tests/web-installer-static.mjs"]) {
    const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join("\n");
    const other = [...code.matchAll(/\bv(\d{3})\b/g)].map((m) => `v${m[1]}`).filter((v) => v !== version);
    assert.deepEqual([...new Set(other)], [], `${f} names another release`);
  }
  const installTest = readFileSync("tests/install-cpanel.integration.sh", "utf8").split("\n").filter((l) => !l.trimStart().startsWith("#"));
  assert.deepEqual([...new Set(installTest.flatMap((l) => [...l.matchAll(/\bv(\d{3})\b/g)].map((m) => `v${m[1]}`)).filter((v) => v !== version))], [], "install integration test");
});
