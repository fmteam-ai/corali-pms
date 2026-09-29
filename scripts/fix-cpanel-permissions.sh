#!/usr/bin/env bash
set -euo pipefail
app_dir="${1:-}"; app_user="${2:-corali}"
[[ -n "$app_dir" && -d "$app_dir" && -f "$app_dir/app.js" && -f "$app_dir/server.js" ]] || { echo "Usage: bash fix-cpanel-permissions.sh /absolute/app/path [cpanel-user]" >&2; exit 1; }
id "$app_user" >/dev/null 2>&1 || { echo "Unknown cPanel user" >&2; exit 1; }
app_group="$(id -gn "$app_user")"; chown -R "$app_user:$app_group" "$app_dir"
find "$app_dir" -type d -exec chmod 755 {} +; find "$app_dir" -type f -exec chmod 644 {} +
find "$app_dir/scripts" -type f \( -name '*.sh' -o -name '*.mjs' \) -exec chmod 750 {} +
[[ ! -f "$app_dir/runtime.env" ]] || chmod 600 "$app_dir/runtime.env"
mkdir -p "$app_dir/tmp"; touch "$app_dir/tmp/restart.txt"; chown -R "$app_user:$app_group" "$app_dir/tmp"; chmod 755 "$app_dir/tmp"; chmod 644 "$app_dir/tmp/restart.txt"
echo "cPanel permissions and Passenger restart: OK"
