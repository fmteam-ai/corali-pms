#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
sandbox="$(mktemp -d)"
cleanup() { [[ "$sandbox" == /tmp/* ]] && rm -rf "$sandbox"; }
trap cleanup EXIT

fake_pg_dump="$sandbox/pg_dump"
backup="$sandbox/database.dump"
cat >"$fake_pg_dump" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${PGPASSWORD:-}" == 'pa:ss word' ]]
output=""
for argument in "$@"; do
  [[ "$argument" != *'pa:ss word'* ]]
  case "$argument" in --file=*) output="${argument#--file=}" ;; esac
done
[[ -n "$output" ]]
printf 'simulated-postgresql-custom-dump\n' >"$output"
EOF
chmod 700 "$fake_pg_dump"

DATABASE_URL='postgresql://hotel:pa%3Ass%20word@127.0.0.1:5432/corali_test' \
DATABASE_SSL=false PG_DUMP_BIN="$fake_pg_dump" \
  node "$project/scripts/backup-postgres.mjs" "$backup"
[[ -s "$backup" ]]
[[ "$(stat -c '%a' "$backup")" == "600" ]]
echo "PostgreSQL backup credential handling and output permissions: OK"
