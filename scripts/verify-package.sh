#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
mode="${2:-package}"
[[ "$mode" == "package" || "$mode" == "installed" ]] || {
  echo "Usage: bash verify-package.sh APP_ROOT [package|installed]" >&2
  exit 2
}

version="$(tr -d '\r\n' < "$root/DEPLOY_VERSION.txt" 2>/dev/null || true)"
[[ "$version" == "v46" ]] || { echo "Invalid deployment version: ${version:-missing}" >&2; exit 1; }

required=(
  app.js server.js package.json DEPLOY_VERSION.txt DEPLOY-CPANEL.md QA-v46.md REQUIREMENTS-STATUS.md ARCHITECTURE-AUDIT.md
  INSTALL-CPANEL.sh ROLLBACK-CPANEL.sh server/postgres-schema.sql
  scripts/init-postgres.mjs scripts/create-admin.mjs scripts/create-admin.sh
  scripts/reset-admin-2fa.mjs scripts/run-birthday-automation.mjs scripts/run-message-automations.mjs scripts/automation-core.mjs
  scripts/database-config.mjs scripts/backup-postgres.mjs scripts/prepare-runtime-env.mjs \
  scripts/load-runtime-env.mjs scripts/admin-recovery-core.mjs scripts/recover-admin.mjs
  scripts/fix-cpanel-permissions.sh scripts/smoke-runtime.sh scripts/verify-package.sh
)
for file in "${required[@]}"; do
  [[ -f "$root/$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done

for forbidden in .env .env.production Passengerfile.json; do
  [[ ! -e "$root/$forbidden" ]] || { echo "Forbidden file: $forbidden" >&2; exit 1; }
done

if [[ "$mode" == "package" ]]; then
  [[ ! -e "$root/runtime.env" ]] || { echo "Forbidden package file: runtime.env" >&2; exit 1; }
else
  [[ -s "$root/runtime.env" ]] || { echo "Missing or empty installed runtime.env" >&2; exit 1; }
  permissions="$(stat -c '%a' "$root/runtime.env")"
  [[ "$permissions" == "600" ]] || { echo "runtime.env must have mode 600, found $permissions" >&2; exit 1; }
  grep -q '^DATABASE_URL=' "$root/runtime.env" || { echo "DATABASE_URL missing from runtime.env" >&2; exit 1; }
  grep -q '^PMS_DOCUMENT_KEY=' "$root/runtime.env" || { echo "PMS_DOCUMENT_KEY missing from runtime.env" >&2; exit 1; }
  grep -q '^SESSION_SECRET=' "$root/runtime.env" || { echo "SESSION_SECRET missing from runtime.env" >&2; exit 1; }
  grep -q '^PMS_ORIGIN=https://' "$root/runtime.env" || { echo "PMS_ORIGIN missing from runtime.env" >&2; exit 1; }
  grep -q '^BOOKING_ORIGIN=https://' "$root/runtime.env" || { echo "BOOKING_ORIGIN missing from runtime.env" >&2; exit 1; }
  grep -Eq '^APP_ROLE=(pms|booking)$' "$root/runtime.env" || { echo "APP_ROLE missing from runtime.env" >&2; exit 1; }
fi

node_version="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$root/package.json")"
[[ "$node_version" == "46.0.0" ]] || { echo "package.json version mismatch: $node_version" >&2; exit 1; }
grep -R -q 'version.*v46' "$root/.next/server"
! grep -R -E -n 'rejectUnauthorized:[[:space:]]*false' "$root/scripts" "$root/server"
grep -q 'idx_bookings_owner_room_dates' "$root/server/postgres-schema.sql"
grep -q 'idx_guest_checkins_owner_booking' "$root/server/postgres-schema.sql"
grep -q 'api/webhooks/stripe' "$root/.next/routes-manifest.json" "$root/.next/server/app-paths-manifest.json" 2>/dev/null
grep -q '"/api/pms/diagnostics/route"' "$root/.next/server/app-paths-manifest.json" || {
  echo "Missing PMS diagnostics route in production build" >&2
  exit 1
}
grep -q '"/pms/page"' "$root/.next/server/app-paths-manifest.json" || {
  echo "Missing PMS dashboard route in production build" >&2
  exit 1
}

if grep -R -E -n --exclude='.env.example' --exclude='DEPLOY-CPANEL.md' \
  '(sk_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' \
  "$root" >/dev/null 2>&1; then
  echo "Possible production secret found in deployment files" >&2
  exit 1
fi

echo "Package verification ($mode): OK — $version"
