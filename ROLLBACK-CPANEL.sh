#!/usr/bin/env bash
set -Eeuo pipefail

manifest="${1:-}"
[[ -n "$manifest" && -f "$manifest" ]] || {
  echo "Usage: bash ROLLBACK-CPANEL.sh /absolute/deployment.manifest" >&2
  exit 2
}
[[ "$manifest" == /* ]] || { echo "Manifest path must be absolute" >&2; exit 2; }

value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1==wanted { sub("^[^=]*=", ""); print; exit }' "$manifest"
}
pms_root="$(value pms_root)"
booking_root="$(value booking_root)"
pms_backup="$(value pms_backup)"
booking_backup="$(value booking_backup)"
app_user="$(value app_user)"

for path_value in "$pms_root" "$booking_root" "$pms_backup" "$booking_backup"; do
  [[ "$path_value" == /home/*/apps/* ]] || { echo "Unsafe path in manifest: $path_value" >&2; exit 1; }
done
id "$app_user" >/dev/null 2>&1 || { echo "Unknown cPanel user: $app_user" >&2; exit 1; }
[[ -d "$pms_root" && -d "$booking_root" ]] || { echo "Current applications are missing" >&2; exit 1; }
[[ -d "$pms_backup" && -d "$booking_backup" ]] || { echo "Rollback backups are missing" >&2; exit 1; }
[[ -s "$pms_backup/runtime.env" && -s "$booking_backup/runtime.env" ]] || { echo "Backup runtime.env is missing" >&2; exit 1; }

echo "This restores both applications from:"
echo "  $pms_backup"
echo "  $booking_backup"
read -r -p "Type ROLLBACK to continue: " confirmation
[[ "$confirmation" == "ROLLBACK" ]] || { echo "Rollback cancelled"; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
pms_failed="$pms_root.failed-$timestamp"
booking_failed="$booking_root.failed-$timestamp"
mv "$pms_root" "$pms_failed"
mv "$pms_backup" "$pms_root"
mv "$booking_root" "$booking_failed"
mv "$booking_backup" "$booking_root"

bash "$pms_root/scripts/fix-cpanel-permissions.sh" "$pms_root" "$app_user"
bash "$booking_root/scripts/fix-cpanel-permissions.sh" "$booking_root" "$app_user"
touch "$pms_root/tmp/restart.txt" "$booking_root/tmp/restart.txt"

echo "Application rollback complete."
echo "Failed release retained at:"
echo "  $pms_failed"
echo "  $booking_failed"
echo "The additive database schema was not reverted, preventing loss of newer data."
