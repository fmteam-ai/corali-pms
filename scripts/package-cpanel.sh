#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
output="$project/corali-pms-cpanel-v119-root.tar.gz"
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
  scripts/reset-admin-2fa.mjs scripts/run-birthday-automation.mjs scripts/run-message-automations.mjs scripts/automation-core.mjs scripts/retention-core.mjs scripts/birthday-core.mjs scripts/run-data-retention.mjs scripts/run-balance-collection.mjs scripts/balance-collection-core.mjs scripts/mydata-core.mjs scripts/run-mydata-queue.mjs scripts/channel-core.mjs scripts/run-channel-sync.mjs scripts/run-social-publisher.mjs scripts/arrival-core.mjs scripts/rate-shopper-core.mjs scripts/run-rate-shopper.mjs scripts/tv-power-core.mjs scripts/run-tv-power.mjs scripts/room-ac-worker.mjs scripts/tuya-core.mjs scripts/room-climate-core.mjs scripts/room-climate-worker.mjs scripts/access-card-core.mjs scripts/access-card-worker.mjs scripts/open-api-core.mjs scripts/api-webhook-worker.mjs scripts/auto-pricing-core.mjs scripts/auto-pricing-worker.mjs scripts/campaign-core.mjs scripts/campaign-worker.mjs \
  scripts/database-config.mjs scripts/backup-postgres.mjs scripts/prepare-runtime-env.mjs \
  scripts/load-runtime-env.mjs scripts/admin-recovery-core.mjs scripts/recover-admin.mjs scripts/has-active-owner.mjs \
  scripts/fix-cpanel-permissions.sh scripts/smoke-runtime.sh \
  scripts/verify-package.sh "$stage/scripts/"
# Cron scripts import packages at run time; Next's standalone output bundles some of them (nodemailer) into its own
# chunks, so copy every package a packaged script imports and the standalone tree lacks (dependency-free ones only).
for pkg in nodemailer; do
  [ -f "$stage/node_modules/$pkg/package.json" ] || cp -a "$(readlink -f "node_modules/$pkg")" "$stage/node_modules/$pkg"
done
cp app.js .env.example DEPLOY-CPANEL.md QA-v119.md REQUIREMENTS-STATUS.md ARCHITECTURE-AUDIT.md INSTALL-CPANEL.sh \
  ROLLBACK-CPANEL.sh package.json "$stage/"
printf 'v119\n' > "$stage/DEPLOY_VERSION.txt"

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
