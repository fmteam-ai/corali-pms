import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const project = process.cwd();
const template = await readFile(path.join(project, "web-installer", "corali-installer.php.template"), "utf8");
const installer = await readFile(path.join(project, "corali-web-installer-v53.php"), "utf8");
const access = await readFile(path.join(project, "corali-web-installer-v53-access.txt"), "utf8");
const archive=await readFile(path.join(project,"corali-pms-cpanel-v53-root.tar.gz"));
const stateId=`v53-${createHash("sha256").update(archive).digest("hex").slice(0,20)}`;
assert.ok(installer.includes(`/.corali-web-installer-${stateId}`),"installer lock must belong to this exact archive");
assert.ok(!installer.includes("__INSTALL_STATE_ID__"));

function assertBalancedPhp(source) {
  const chunks = [...source.matchAll(/<\?(?:php|=)([\s\S]*?)\?>/g)].map((match) => match[1]);
  assert.ok(chunks.length > 10, "installer must contain the expected PHP sections");
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const stack = [];
    let quote = "";
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];
      const next = chunk[index + 1];
      if (lineComment) { if (character === "\n") lineComment = false; continue; }
      if (blockComment) { if (character === "*" && next === "/") { blockComment = false; index += 1; } continue; }
      if (quote) {
        if (character === "\\") { index += 1; continue; }
        if (character === quote) quote = "";
        continue;
      }
      if (character === "/" && next === "/") { lineComment = true; index += 1; continue; }
      if (character === "#") { lineComment = true; continue; }
      if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
      if (character === "'" || character === '"') { quote = character; continue; }
      if ("({[".includes(character)) stack.push(character);
      if (")}]".includes(character)) {
        const opening = stack.pop();
        const expected = { ")": "(", "}": "{", "]": "[" }[character];
        assert.equal(opening, expected, `unbalanced PHP delimiter in section ${chunkIndex + 1}`);
      }
    }
    assert.equal(quote, "", `unterminated PHP string in section ${chunkIndex + 1}`);
    assert.equal(blockComment, false, `unterminated PHP comment in section ${chunkIndex + 1}`);
    assert.deepEqual(stack, [], `unclosed PHP delimiter in section ${chunkIndex + 1}`);
  }
}

assertBalancedPhp(installer);

assert.equal((template.match(/__INSTALL_TOKEN_HASH__/g) ?? []).length, 1);
assert.equal(installer.includes("__INSTALL_TOKEN_HASH__"), false);

const hash = installer.match(/CORALI_INSTALL_TOKEN_HASH = '([a-f0-9]{64})'/)?.[1];
const token = access.match(/[?&]key=([A-Za-z0-9_-]{40,})/)?.[1];
assert.ok(hash, "generated installer must contain a SHA-256 token hash");
assert.ok(token, "access instructions must contain the one-time token");
assert.equal(createHash("sha256").update(token).digest("hex"), hash);
assert.equal(installer.includes(token), false, "raw access token must never be embedded in PHP");

for (const required of [
  "hash_equals(CORALI_INSTALL_TOKEN_HASH",
  "requireCsrf()",
  "Content-Security-Policy",
  "X-Frame-Options: DENY",
  "Cache-Control: no-store",
  "PMS_DOCUMENT_KEY",
  "sha256sum -c",
  "INSTALL-CPANEL.sh --yes",
  "αυτόματο rollback",
  "@unlink(__FILE__)",
  "corali-pms-cpanel-v53-root.tar.gz",
  "access_action",
  "access_csrf",
  "authorizeAccessKey",
  "/opt/cpanel/ea-nodejs22/bin/node",
  "/.corali-releases",
  "/.corali-backups",
  "resolvedCommandPath('node')",
  "dirname($nodePath)",
  "Choose language",
  "Επιλέξτε γλώσσα",
  "recoverAdministrator($_POST)",
  "scripts/recover-admin.mjs",
  "admin_password_confirmation",
  "@unlink($inputFile)",
]) {
  assert.ok(installer.includes(required), `missing web-installer safeguard: ${required}`);
}

assert.equal(/(?:sk_live_|whsec_)[A-Za-z0-9]{16,}/.test(installer), false);
assert.equal(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(installer), false);
assert.equal(installer.includes("$password . ' "), false, "administrator password must not be added to a shell command");
console.log("Web installer token, CSRF, headers, checksum, rollback and secret checks: OK");
