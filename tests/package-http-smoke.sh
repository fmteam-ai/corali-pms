#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
[[ -f "$archive" ]] || { echo "Usage: bash package-http-smoke.sh PACKAGE.tar.gz" >&2; exit 2; }
sandbox="$(mktemp -d)"
cleanup() {
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  [[ "$sandbox" == /tmp/* ]] && rm -rf "$sandbox"
}
trap cleanup EXIT

tar -xzf "$archive" -C "$sandbox"
cat >"$sandbox/runtime.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://test:test@127.0.0.1:1/test
DATABASE_SSL=false
SESSION_SECRET=http-smoke-session-secret-longer-than-thirty-two-bytes
PMS_DOCUMENT_KEY=http-smoke-document-key-longer-than-thirty-two-bytes
APP_ROLE=pms
PMS_ORIGIN=https://pms.hotelcorali.gr
BOOKING_ORIGIN=https://booking.hotelcorali.gr
PMS_OWNER_ID=hotel-corali
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SMTP_PORT=
SMTP_FROM=
OPENAI_API_KEY=
EOF
chmod 600 "$sandbox/runtime.env"
port="$(node -e "const n=require('net').createServer();n.listen(0,'127.0.0.1',()=>{console.log(n.address().port);n.close()})")"
log="$sandbox/http-smoke.log"
(
  cd "$sandbox"
  PORT="$port" HOSTNAME=127.0.0.1 node app.js >"$log" 2>&1
) &
pid=$!

ready=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/login" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
[[ "$ready" == 1 ]] || { tail -80 "$log" >&2; exit 1; }

for route in /login /booking-widget.js /rate-widget.js /fonts/DejaVuSans-Bold.ttf; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$route")"
  [[ "$status" == 200 ]] || { echo "$route returned HTTP $status" >&2; exit 1; }
done
diagnostics_file="$sandbox/diagnostics.json"
diagnostics_status="$(curl -sS -o "$diagnostics_file" -w '%{http_code}' "http://127.0.0.1:$port/api/pms/diagnostics")"
[[ "$diagnostics_status" == 401 || "$diagnostics_status" == 403 ]] || {
  echo "PMS diagnostics route returned HTTP $diagnostics_status (expected protected route)" >&2
  exit 1
}
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/book")" == 307 ]]
grep -qi '^location: https://booking.hotelcorali.gr/book' < <(curl -sSI "http://127.0.0.1:$port/book")
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/public/availability")" == 404 ]]
headers="$(curl -sSI "http://127.0.0.1:$port/login")"
grep -qi '^x-content-type-options: nosniff' <<<"$headers"
grep -qi '^x-frame-options: DENY' <<<"$headers"
health_file="$sandbox/health.json"
health_status="$(curl -sS -o "$health_file" -w '%{http_code}' "http://127.0.0.1:$port/api/health")"
[[ "$health_status" == 503 ]]
grep -Eq '"ok"[[:space:]]*:[[:space:]]*false' "$health_file"
grep -Eq '"version"[[:space:]]*:[[:space:]]*"v49"' "$health_file"
grep -Eq '"reason"[[:space:]]*:[[:space:]]*"database_unavailable"' "$health_file"

csrf_url="http://127.0.0.1:$port/api/auth/login"
csrf_body='{}'
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data "$csrf_body" "$csrf_url")" == 403 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Origin: https://pms.hotelcorali.gr' -H 'Sec-Fetch-Site: cross-site' --data "$csrf_body" "$csrf_url")" == 403 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: same-site' --data "$csrf_body" "$csrf_url")" == 403 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Sec-Fetch-Site: same-site' --data "$csrf_body" "$csrf_url")" == 400 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Origin: https://booking.hotelcorali.gr' -H 'Sec-Fetch-Site: same-site' --data "$csrf_body" "$csrf_url")" == 400 ]]

kill "$pid"
wait "$pid" 2>/dev/null || true
pid=""
sed -i 's/^APP_ROLE=pms$/APP_ROLE=booking/' "$sandbox/runtime.env"
port="$(node -e "const n=require('net').createServer();n.listen(0,'127.0.0.1',()=>{console.log(n.address().port);n.close()})")"
(
  cd "$sandbox"
  PORT="$port" HOSTNAME=127.0.0.1 node app.js >"$log" 2>&1
) &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/book" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
[[ "$ready" == 1 ]] || { tail -80 "$log" >&2; exit 1; }
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/book")" == 200 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login")" == 307 ]]
grep -qi '/book' < <(curl -sSI "http://127.0.0.1:$port/login")
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/auth/login")" == 404 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/pms/users")" == 404 ]]
booking_health="$sandbox/booking-health.json"
[[ "$(curl -sS -o "$booking_health" -w '%{http_code}' "http://127.0.0.1:$port/api/health")" == 503 ]]
grep -Eq '"service"[[:space:]]*:[[:space:]]*"corali-booking"' "$booking_health"
grep -Eq '"version"[[:space:]]*:[[:space:]]*"v49"' "$booking_health"
echo "Production archive role isolation, routes, headers, health version and CSRF behavior: OK"
