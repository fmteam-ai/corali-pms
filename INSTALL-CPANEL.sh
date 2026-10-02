#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="v60"
release_dir="$(cd "$(dirname "$0")" && pwd)"
pms_root="/home/corali/apps/corali-pms"
booking_root="/home/corali/apps/corali-booking"
app_user="corali"
pms_url="https://pms.hotelcorali.gr"
booking_url="https://booking.hotelcorali.gr"
backup_dir=""
assume_yes=0
skip_db_backup=0

usage() {
  cat <<'EOF'
Hotel Corali v60 — automatic cPanel installer

Usage:
  bash INSTALL-CPANEL.sh [options]

Options:
  --pms-root PATH       Active PMS root (default /home/corali/apps/corali-pms)
  --booking-root PATH   Active booking root (default /home/corali/apps/corali-booking)
  --user USER           cPanel Unix user (default corali)
  --pms-url URL         PMS public origin
  --booking-url URL     Booking public origin
  --backup-dir PATH     Backup directory (default /home/USER/backups)
  --yes                 Non-interactive confirmation
  --skip-db-backup      Skip pg_dump only when an external DB backup already exists
  --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pms-root) pms_root="${2:-}"; shift 2 ;;
    --booking-root) booking_root="${2:-}"; shift 2 ;;
    --user) app_user="${2:-}"; shift 2 ;;
    --pms-url) pms_url="${2:-}"; shift 2 ;;
    --booking-url) booking_url="${2:-}"; shift 2 ;;
    --backup-dir) backup_dir="${2:-}"; shift 2 ;;
    --yes) assume_yes=1; shift ;;
    --skip-db-backup) skip_db_backup=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

fail() { echo "INSTALLATION STOPPED: $*" >&2; exit 1; }
require_absolute() { [[ "$2" == /* ]] || fail "$1 must be an absolute path"; }
require_absolute "PMS root" "$pms_root"
require_absolute "Booking root" "$booking_root"
if [[ -n "$backup_dir" ]]; then require_absolute "Backup directory" "$backup_dir"; fi
[[ "$pms_root" != "$booking_root" ]] || fail "PMS and booking roots must be different"
[[ -f "$release_dir/DEPLOY_VERSION.txt" ]] || fail "Run the installer from the extracted v60 directory"
[[ "$(tr -d '\r\n' < "$release_dir/DEPLOY_VERSION.txt")" == "$VERSION" ]] || fail "This installer requires $VERSION"
[[ "$release_dir" != "$pms_root" && "$release_dir" != "$booking_root" ]] || fail "Extract the release outside the active application directories"

command -v node >/dev/null 2>&1 || fail "Node.js is not available"
command -v tar >/dev/null 2>&1 || fail "tar is not available"
id "$app_user" >/dev/null 2>&1 || fail "Unknown cPanel user: $app_user"
[[ -d "$pms_root" && -f "$pms_root/app.js" ]] || fail "Active PMS application not found: $pms_root"
[[ -d "$booking_root" && -f "$booking_root/app.js" ]] || fail "Active booking application not found: $booking_root"
[[ -s "$pms_root/runtime.env" ]] || fail "PMS runtime.env is missing or empty"
[[ -s "$booking_root/runtime.env" ]] || fail "Booking runtime.env is missing or empty"

env_value() {
  local key="$1" file="$2"
  awk -v wanted="$key" '
    { sub(/\r$/, "") }
    $0 ~ "^[[:space:]]*" wanted "=" {
      sub("^[[:space:]]*" wanted "=", "")
      print
      exit
    }
  ' "$file"
}

pms_key="$(env_value PMS_DOCUMENT_KEY "$pms_root/runtime.env")"
booking_key="$(env_value PMS_DOCUMENT_KEY "$booking_root/runtime.env")"
[[ -n "$pms_key" ]] || fail "PMS_DOCUMENT_KEY is missing from PMS runtime.env"
[[ -n "$booking_key" ]] || fail "PMS_DOCUMENT_KEY is missing from booking runtime.env"
[[ "$pms_key" == "$booking_key" ]] || fail "PMS and booking PMS_DOCUMENT_KEY values do not match"
unset pms_key booking_key

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( node_major >= 22 )) || fail "Node.js 22 or newer is required"

echo
echo "Hotel Corali automatic cPanel installation — $VERSION"
echo "Release:       $release_dir"
echo "PMS root:      $pms_root"
echo "Booking root:  $booking_root"
echo "cPanel user:   $app_user"
echo "PMS URL:       $pms_url"
echo "Booking URL:   $booking_url"
echo "Backup path:   ${backup_dir:-/home/$app_user/backups}"
echo "DB backup:     $([[ "$skip_db_backup" == 1 ]] && echo 'external backup confirmed' || echo 'automatic pg_dump')"
echo

if [[ "$assume_yes" != 1 ]]; then
  [[ -t 0 ]] || fail "Use --yes for non-interactive installation"
  read -r -p "Type INSTALL to continue: " confirmation
  [[ "$confirmation" == "INSTALL" ]] || fail "Installation cancelled"
fi

bash "$release_dir/scripts/verify-package.sh" "$release_dir" package

apps_dir="$(dirname "$pms_root")"
[[ "$(dirname "$booking_root")" == "$apps_dir" ]] || fail "Both application roots must have the same parent directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
backup_dir="${backup_dir:-/home/$app_user/backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

lock_dir="$apps_dir/.corali-v60-install.lock"
mkdir "$lock_dir" 2>/dev/null || fail "Another installation is running or a stale lock exists: $lock_dir"
pms_stage="$apps_dir/.corali-pms-$VERSION-stage-$timestamp"
booking_stage="$apps_dir/.corali-booking-$VERSION-stage-$timestamp"
pms_backup="$apps_dir/corali-pms-backup-$timestamp"
booking_backup="$apps_dir/corali-booking-backup-$timestamp"
database_backup="$backup_dir/corali-postgres-$timestamp.dump"
manifest="$backup_dir/corali-deployment-$VERSION-$timestamp.manifest"

pms_old_moved=0
pms_new_active=0
booking_old_moved=0
booking_new_active=0
finished=0

cleanup_lock() { rmdir "$lock_dir" 2>/dev/null || true; }
automatic_rollback() {
  local status=$?
  trap - ERR INT TERM
  if [[ "$finished" != 1 ]]; then
    echo "Installation failed. Starting automatic application rollback..." >&2
    if [[ "$booking_new_active" == 1 && -d "$booking_root" ]]; then
      mv "$booking_root" "$booking_root.failed-$timestamp" || true
    fi
    if [[ "$booking_old_moved" == 1 && -d "$booking_backup" && ! -e "$booking_root" ]]; then
      mv "$booking_backup" "$booking_root" || true
      touch "$booking_root/tmp/restart.txt" 2>/dev/null || true
    fi
    if [[ "$pms_new_active" == 1 && -d "$pms_root" ]]; then
      mv "$pms_root" "$pms_root.failed-$timestamp" || true
    fi
    if [[ "$pms_old_moved" == 1 && -d "$pms_backup" && ! -e "$pms_root" ]]; then
      mv "$pms_backup" "$pms_root" || true
      touch "$pms_root/tmp/restart.txt" 2>/dev/null || true
    fi
  fi
  cleanup_lock
  exit "$status"
}
trap automatic_rollback ERR INT TERM
trap cleanup_lock EXIT

[[ ! -e "$pms_stage" && ! -e "$booking_stage" ]] || fail "Staging directory already exists"
[[ ! -e "$pms_backup" && ! -e "$booking_backup" ]] || fail "Backup directory already exists"

echo "[1/9] Preparing isolated PMS and booking stages..."
mkdir -p "$pms_stage" "$booking_stage"
cp -a "$release_dir/." "$pms_stage/"
cp -a "$release_dir/." "$booking_stage/"
install -m 600 "$pms_root/runtime.env" "$pms_stage/runtime.env"
install -m 600 "$booking_root/runtime.env" "$booking_stage/runtime.env"
node "$pms_stage/scripts/prepare-runtime-env.mjs" \
  "$pms_stage/runtime.env" "$booking_stage/runtime.env" "$pms_url" "$booking_url"

echo "[2/9] Verifying installed-file layout and protected settings..."
bash "$pms_stage/scripts/verify-package.sh" "$pms_stage" installed
bash "$booking_stage/scripts/verify-package.sh" "$booking_stage" installed

if [[ "$skip_db_backup" != 1 ]]; then
  echo "[3/9] Creating PostgreSQL backup..."
  node --env-file="$pms_stage/runtime.env" "$pms_stage/scripts/backup-postgres.mjs" "$database_backup"
else
  echo "[3/9] PostgreSQL backup skipped by explicit operator choice."
fi

echo "[4/9] Applying additive, idempotent database migrations..."
node --env-file="$pms_stage/runtime.env" "$pms_stage/scripts/init-postgres.mjs"

echo "[5/9] Running isolated runtime health tests..."
bash "$pms_stage/scripts/smoke-runtime.sh" "$pms_stage" "$VERSION"
bash "$booking_stage/scripts/smoke-runtime.sh" "$booking_stage" "$VERSION"

echo "[6/9] Applying secure ownership and permissions..."
bash "$pms_stage/scripts/fix-cpanel-permissions.sh" "$pms_stage" "$app_user"
bash "$booking_stage/scripts/fix-cpanel-permissions.sh" "$booking_stage" "$app_user"

echo "[7/9] Performing atomic application swap..."
mv "$pms_root" "$pms_backup"
pms_old_moved=1
mv "$pms_stage" "$pms_root"
pms_new_active=1
mv "$booking_root" "$booking_backup"
booking_old_moved=1
mv "$booking_stage" "$booking_root"
booking_new_active=1

echo "[8/9] Restarting Passenger applications..."
mkdir -p "$pms_root/tmp" "$booking_root/tmp"
touch "$pms_root/tmp/restart.txt" "$booking_root/tmp/restart.txt"
chown -R "$app_user:$(id -gn "$app_user")" "$pms_root/tmp" "$booking_root/tmp"

echo "[9/9] Verifying active directories..."
bash "$pms_root/scripts/verify-package.sh" "$pms_root" installed
bash "$booking_root/scripts/verify-package.sh" "$booking_root" installed

cat >"$manifest" <<EOF
version=$VERSION
installed_at_utc=$timestamp
pms_root=$pms_root
booking_root=$booking_root
pms_backup=$pms_backup
booking_backup=$booking_backup
database_backup=$([[ "$skip_db_backup" == 1 ]] && echo external || echo "$database_backup")
app_user=$app_user
EOF
chmod 600 "$manifest"

finished=1
trap - ERR INT TERM
cleanup_lock

echo
echo "INSTALLATION COMPLETE — $VERSION"
echo "PMS backup:      $pms_backup"
echo "Booking backup:  $booking_backup"
echo "Deployment log:  $manifest"
[[ "$skip_db_backup" == 1 ]] || echo "Database backup: $database_backup"
echo
echo "Open these URLs in a browser (browser test avoids server-side ModSecurity curl blocks):"
echo "  $pms_url/api/health"
echo "  $booking_url/api/health"
echo "Both must report version $VERSION."
echo "Rollback command, only if required:"
echo "  bash $pms_root/ROLLBACK-CPANEL.sh $manifest"
