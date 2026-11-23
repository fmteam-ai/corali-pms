#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
output="$project/corali-pms-cpanel-v204-root.tar.gz"
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
  scripts/reset-admin-2fa.mjs scripts/run-birthday-automation.mjs scripts/run-message-automations.mjs scripts/automation-core.mjs scripts/retention-core.mjs scripts/birthday-core.mjs scripts/run-data-retention.mjs scripts/run-balance-collection.mjs scripts/balance-collection-core.mjs scripts/mydata-core.mjs scripts/run-mydata-queue.mjs scripts/channel-core.mjs scripts/room-ready-core.mjs scripts/run-channel-sync.mjs scripts/run-social-publisher.mjs scripts/social-publish-core.mjs scripts/run-sentinel.mjs scripts/sentinel-core.mjs scripts/health-core.mjs scripts/telemetry-core.mjs scripts/arrival-core.mjs scripts/rate-shopper-core.mjs scripts/run-rate-shopper.mjs scripts/tv-power-core.mjs scripts/tv-command-core.mjs scripts/run-tv-power.mjs scripts/tv-plug-worker.mjs scripts/omada-core.mjs scripts/guest-wifi-worker.mjs scripts/security-core.mjs scripts/security-worker.mjs scripts/edge-lock.mjs scripts/device-compat-core.mjs scripts/corali_bridge.py scripts/room-ac-worker.mjs scripts/tuya-core.mjs scripts/room-climate-core.mjs scripts/room-climate-worker.mjs scripts/access-card-core.mjs scripts/access-card-worker.mjs scripts/open-api-core.mjs scripts/api-webhook-worker.mjs scripts/auto-pricing-core.mjs scripts/auto-pricing-worker.mjs scripts/campaign-core.mjs scripts/campaign-worker.mjs scripts/sales-advisor-worker.mjs scripts/journey-worker.mjs scripts/journey-core.mjs scripts/reliability-core.mjs scripts/delivery-policy-core.mjs scripts/turnover-core.mjs scripts/data-availability.mjs scripts/comfort-core.mjs scripts/root-cause-core.mjs scripts/job-control-core.mjs scripts/alert-core.mjs scripts/alert-intel-core.mjs scripts/integration-state-core.mjs scripts/ota-reconcile-core.mjs scripts/stripe-reconcile-core.mjs scripts/restore-rehearsal-core.mjs scripts/run-restore-rehearsal.mjs scripts/release-evidence-core.mjs scripts/post-install-check.mjs scripts/conflict-targets-core.mjs scripts/reconcile-core.mjs scripts/department-sales-core.mjs scripts/email-brand-core.mjs scripts/db-backup-core.mjs scripts/run-db-backup.mjs scripts/restore-db-backup.mjs scripts/imap-core.mjs scripts/mail-inbox-worker.mjs scripts/whatsapp-inbox-worker.mjs \
  scripts/database-config.mjs scripts/backup-postgres.mjs scripts/prepare-runtime-env.mjs \
  scripts/load-runtime-env.mjs scripts/admin-recovery-core.mjs scripts/recover-admin.mjs scripts/has-active-owner.mjs \
  scripts/fix-cpanel-permissions.sh scripts/smoke-runtime.sh \
  scripts/verify-package.sh "$stage/scripts/"
# Cron scripts import packages at run time; Next's standalone output bundles some of them (nodemailer) into its own
# chunks, so copy every package a packaged script imports and the standalone tree lacks (dependency-free ones only).
for pkg in nodemailer; do
  [ -f "$stage/node_modules/$pkg/package.json" ] || cp -a "$(readlink -f "node_modules/$pkg")" "$stage/node_modules/$pkg"
done
cp app.js .env.example DEPLOY-CPANEL.md QA-v204.md REQUIREMENTS-STATUS.md ARCHITECTURE-AUDIT.md INSTALL-CPANEL.sh \
  ROLLBACK-CPANEL.sh package.json "$stage/"
printf 'v204\n' > "$stage/DEPLOY_VERSION.txt"

find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
find "$stage/scripts" -type f -exec chmod 750 {} +
chmod 750 "$stage/INSTALL-CPANEL.sh" "$stage/ROLLBACK-CPANEL.sh"

# v189: every ON CONFLICT target of the code, planned on the production database by the post-install check.
node --input-type=module -e 'import {conflictTargets} from "./scripts/conflict-targets-core.mjs"; import {writeFileSync} from "node:fs"; writeFileSync(process.argv[1], JSON.stringify([...conflictTargets(".")].map(([target,file])=>({target,file})),null,1))' "$stage/server/conflict-targets.json"
chmod 644 "$stage/server/conflict-targets.json"

bash "$stage/scripts/verify-package.sh" "$stage" package
tar -C "$stage" -czf "$output" .
bash tests/package-http-smoke.sh "$output"
bash tests/install-cpanel.integration.sh "$output"
node tests/prepare-runtime-env.integration.mjs
node tests/runtime-env-loader.integration.mjs
# v188: end-to-end QA of this package (fresh PostgreSQL, both applications, real HTTP, the cron): a PASS / FAIL report
# per critical flow in docs/qa/; any FAIL stops here, so a package that fails is never handed over.
node scripts/release-qa.mjs "$output" v204 "$project/docs/qa"
# v189: the package then carries the evidence — that QA report's summary and the SHA-256 of every file it contains —
# so the post-install check proves on the server that the installed files are exactly the ones that passed QA.
node --input-type=module -e '
import {writeFileSync,readFileSync} from "node:fs";
import {fileManifest,contentHash,qaSummary,EVIDENCE_FILE} from "./scripts/release-evidence-core.mjs";
const [stage,version,report]=process.argv.slice(1), files=fileManifest(stage);
writeFileSync(`${stage}/${EVIDENCE_FILE}`, JSON.stringify({version,createdAt:new Date().toISOString(),contentHash:contentHash(files),qa:qaSummary(JSON.parse(readFileSync(report,"utf8"))),files}));
' "$stage" v204 "$project/docs/qa/qa-report-v204.json"
chmod 644 "$stage/RELEASE-EVIDENCE.json"
rm -f "$output"
tar -C "$stage" -czf "$output" .
evidence_check="$(mktemp -d)"
tar -C "$evidence_check" -xzf "$output"
node "$evidence_check/scripts/post-install-check.mjs" "$evidence_check" v204 --require-evidence --no-db --skip-acceptance
rm -rf "$evidence_check"
# v204: the hash is computed once, from the final archive, and published in the QA report and the .sha256 file.
node scripts/finalize-release.mjs finalize "$output" v204 "$project/docs/qa"
# v204: the QA evidence with its logs (per flow, applications, full TAP of the tests, reproduction steps) as its own
# archive, and the diagnostics package (AC Probe) — neither is part of the installation package.
tar -C "$project/docs/qa" -czf "$project/corali-qa-evidence-v204.tar.gz" QA-REPORT-v204.md qa-report-v204.json qa-logs-v204
(cd "$project" && sha256sum corali-qa-evidence-v204.tar.gz) | tee "$project/corali-qa-evidence-v204.tar.gz.sha256"
bash scripts/package-diagnostics.sh v204
bash scripts/package-watchdog.sh v204
node scripts/build-web-installer.mjs
node tests/web-installer-static.mjs
# v204: last step — the archive, its .sha256, the QA report and the installer name the same hash.
node scripts/finalize-release.mjs check "$output" v204 "$project/docs/qa" "$project/corali-web-installer-v204.php"
echo "$output"
