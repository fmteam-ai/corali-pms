#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
output="$project/corali-pms-cpanel-v51-root.tar.gz"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cd "$project"
pnpm test
pnpm typecheck
pnpm lint
pnpm audit --audit-level high
pnpm build
node scripts/verify-schema-pglite.mjs
bash tests/backup-postgres.integration.sh

cp -a .next/standalone/. "$stage/"
mkdir -p "$stage/.next" "$stage/scripts"
cp -a .next/static "$stage/.next/static"
cp -a public "$stage/public"
cp -a server "$stage/server"
cp scripts/init-postgres.mjs scripts/create-admin.mjs scripts/create-admin.sh \
  scripts/reset-admin-2fa.mjs scripts/run-birthday-automation.mjs scripts/run-message-automations.mjs scripts/automation-core.mjs scripts/retention-core.mjs scripts/birthday-core.mjs scripts/run-data-retention.mjs scripts/run-balance-collection.mjs scripts/balance-collection-core.mjs scripts/mydata-core.mjs scripts/run-mydata-queue.mjs scripts/channel-core.mjs scripts/run-channel-sync.mjs scripts/run-social-publisher.mjs scripts/arrival-core.mjs scripts/rate-shopper-core.mjs scripts/run-rate-shopper.mjs \
  scripts/database-config.mjs scripts/backup-postgres.mjs scripts/prepare-runtime-env.mjs \
  scripts/load-runtime-env.mjs scripts/admin-recovery-core.mjs scripts/recover-admin.mjs \
  scripts/fix-cpanel-permissions.sh scripts/smoke-runtime.sh \
  scripts/verify-package.sh "$stage/scripts/"
cp app.js .env.example DEPLOY-CPANEL.md QA-v51.md REQUIREMENTS-STATUS.md ARCHITECTURE-AUDIT.md INSTALL-CPANEL.sh \
  ROLLBACK-CPANEL.sh package.json "$stage/"
printf 'v51\n' > "$stage/DEPLOY_VERSION.txt"

find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
find "$stage/scripts" -type f -exec chmod 750 {} +
chmod 750 "$stage/INSTALL-CPANEL.sh" "$stage/ROLLBACK-CPANEL.sh"

bash "$stage/scripts/verify-package.sh" "$stage" package
tar -C "$stage" -czf "$output" .
bash tests/package-http-smoke.sh "$output"
bash tests/install-cpanel.integration.sh "$output"
(cd "$project" && sha256sum "$(basename "$output")") | tee "$output.sha256"
node scripts/build-web-installer.mjs
node tests/web-installer-static.mjs
node tests/prepare-runtime-env.integration.mjs
node tests/runtime-env-loader.integration.mjs
echo "$output"
