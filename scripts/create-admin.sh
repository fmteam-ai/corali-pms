#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'Usage: bash scripts/create-admin.sh USERNAME "DISPLAY NAME" EMAIL' >&2; exit 1; }
read -r -s -p "New owner password (minimum 14 characters): " admin_password
echo
[[ ${#admin_password} -ge 14 ]] || { echo "Password is too short." >&2; exit 1; }
PMS_ADMIN_PASSWORD="$admin_password" node --env-file=runtime.env scripts/create-admin.mjs "$1" "$2" "$3"
unset admin_password
