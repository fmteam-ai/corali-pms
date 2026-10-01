#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
[[ -f "$archive" ]] || { echo "Usage: bash install-cpanel.integration.sh PACKAGE.tar.gz" >&2; exit 2; }
test_user="${CORALI_INSTALL_TEST_USER:-root}"
id "$test_user" >/dev/null 2>&1 || { echo "Unknown integration-test user: $test_user" >&2; exit 2; }
sandbox="$(mktemp -d)"
cleanup() {
  [[ "$sandbox" == /tmp/* ]] && rm -rf "$sandbox"
}
trap cleanup EXIT

release="$sandbox/release"
apps="$sandbox/apps"
backups="$sandbox/backups"
pms="$apps/corali-pms"
booking="$apps/corali-booking"
mkdir -p "$release" "$pms" "$booking" "$backups"
tar -xzf "$archive" -C "$release"

cat >"$release/app.js" <<'EOF'
import fs from "node:fs";
import http from "node:http";
for (const sourceLine of fs.readFileSync(new URL("./runtime.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const line = sourceLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator > 0) process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
}
const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || "127.0.0.1";
http.createServer((request, response) => {
  if (request.url?.startsWith("/api/public/availability?") && process.env.APP_ROLE === "booking") {
    const failed=process.env.CORALI_TEST_AVAILABILITY_FAIL === "1";
    response.writeHead(failed ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(failed ? {ok:false,error:"AVAILABILITY_FAILED"} : { ok: true, nights: 2, rooms: [], extras: [], charges: [] }));
    return;
  }
  if (request.url === "/api/pms/diagnostics" && process.env.APP_ROLE === "pms") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }));
    return;
  }
  if (request.url === "/api/health") {
    const required = ["DATABASE_URL", "SESSION_SECRET", "PMS_ORIGIN", "BOOKING_ORIGIN", "PMS_OWNER_ID", "PMS_DOCUMENT_KEY", "APP_ROLE"];
    if (required.some((key) => !process.env[key])) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, service: "corali-pms", version: "v58", reason: "runtime_configuration_invalid" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "corali-pms", version: "v58" }));
    return;
  }
  response.writeHead(404);
  response.end("not found");
}).listen(port, host);
EOF
cat >"$release/scripts/init-postgres.mjs" <<'EOF'
console.log("Simulated idempotent PostgreSQL migration: OK");
EOF

for app in "$pms" "$booking"; do
  printf 'old application\n' >"$app/app.js"
  cat >"$app/runtime.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://test:test@127.0.0.1:5432/test
DATABASE_SSL=false
PMS_DOCUMENT_KEY=integration-test-key-that-is-never-production
SESSION_SECRET=integration-test-session-secret
PMS_OWNER_ID=hotel-corali
EOF
  chmod 600 "$app/runtime.env"
done

sed -i 's/integration-test-key-that-is-never-production/different-test-key/' "$booking/runtime.env"
set +e
HTTP_PROXY="http://127.0.0.1:9" HTTPS_PROXY="http://127.0.0.1:9" ALL_PROXY="http://127.0.0.1:9" \
bash "$release/INSTALL-CPANEL.sh" --yes --skip-db-backup \
  --user "$test_user" --backup-dir "$backups" \
  --pms-root "$pms" --booking-root "$booking" \
  --pms-url "https://pms.invalid" --booking-url "https://booking.invalid" >/dev/null 2>&1
mismatch_status=$?
set -e
[[ "$mismatch_status" -ne 0 ]]
grep -qx 'old application' "$pms/app.js"
grep -qx 'old application' "$booking/app.js"
sed -i 's/different-test-key/integration-test-key-that-is-never-production/' "$booking/runtime.env"

set +e
CORALI_TEST_AVAILABILITY_FAIL=1 bash "$release/INSTALL-CPANEL.sh" --yes --skip-db-backup \
  --user "$test_user" --backup-dir "$backups" \
  --pms-root "$pms" --booking-root "$booking" \
  --pms-url "https://pms.invalid" --booking-url "https://booking.invalid" >/dev/null 2>&1
availability_status=$?
set -e
[[ "$availability_status" -ne 0 ]]
grep -qx 'old application' "$pms/app.js"
grep -qx 'old application' "$booking/app.js"

HTTP_PROXY="http://127.0.0.1:9" HTTPS_PROXY="http://127.0.0.1:9" ALL_PROXY="http://127.0.0.1:9" \
bash "$release/INSTALL-CPANEL.sh" --yes --skip-db-backup \
  --user "$test_user" --backup-dir "$backups" \
  --pms-root "$pms" --booking-root "$booking" \
  --pms-url "https://pms.invalid" --booking-url "https://booking.invalid"

grep -qx 'v58' "$pms/DEPLOY_VERSION.txt"
grep -qx 'v58' "$booking/DEPLOY_VERSION.txt"
grep -q '^PMS_DOCUMENT_KEY=integration-test-key-that-is-never-production$' "$pms/runtime.env"
grep -q '^PMS_DOCUMENT_KEY=integration-test-key-that-is-never-production$' "$booking/runtime.env"
manifest="$(find "$backups" -maxdepth 1 -name 'corali-deployment-v58-*.manifest' -print -quit)"
[[ -n "$manifest" && -f "$manifest" ]]

printf 'rollback-preservation-marker\n' >"$pms/rollback-marker"
printf 'rollback-preservation-marker\n' >"$booking/rollback-marker"
original_verifier="$release/scripts/verify-package.sh"
cp "$original_verifier" "$release/scripts/verify-package-original.sh"
cat >"$original_verifier" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$1"
mode="${2:-package}"
bash "$(dirname "$0")/verify-package-original.sh" "$root" "$mode"
if [[ "$mode" == "installed" && "$root" == "${CORALI_TEST_FAIL_PATH:-never}" ]]; then
  echo "Simulated post-swap verification failure" >&2
  exit 91
fi
EOF
chmod 750 "$original_verifier"

set +e
CORALI_TEST_FAIL_PATH="$pms" bash "$release/INSTALL-CPANEL.sh" --yes --skip-db-backup \
  --user "$test_user" --backup-dir "$backups" \
  --pms-root "$pms" --booking-root "$booking" \
  --pms-url "https://pms.invalid" --booking-url "https://booking.invalid"
failure_status=$?
set -e
[[ "$failure_status" -ne 0 ]]
grep -qx 'rollback-preservation-marker' "$pms/rollback-marker"
grep -qx 'rollback-preservation-marker' "$booking/rollback-marker"
echo "Installer success path and automatic rollback path: OK"
