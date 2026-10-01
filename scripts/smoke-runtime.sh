#!/usr/bin/env bash
set -euo pipefail

app_dir="${1:-}"
expected_version="${2:-v54}"
port="${3:-}"
[[ -d "$app_dir" && -f "$app_dir/app.js" && -f "$app_dir/runtime.env" ]] || {
  echo "Usage: bash smoke-runtime.sh APP_DIR [EXPECTED_VERSION] [PORT]" >&2
  exit 2
}
if [[ -z "$port" ]]; then
  port="$(node -e "const n=require('net').createServer();n.listen(0,'127.0.0.1',()=>{console.log(n.address().port);n.close()})")"
fi
log_file="$(mktemp)"
pid=""
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
}
trap cleanup EXIT

(
  cd "$app_dir"
  PORT="$port" HOSTNAME="127.0.0.1" NODE_ENV="production" node app.js >"$log_file" 2>&1
) &
pid=$!

body=""
last_probe_error=""
for _ in $(seq 1 120); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Application exited during smoke test" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  # Use Node's native HTTP client so cPanel HTTP_PROXY/HTTPS_PROXY settings
  # cannot redirect a loopback health request away from this process.
  probe_file="$(mktemp)"
  if node --input-type=module - "$port" >"$probe_file" 2>&1 <<'NODE'
import http from "node:http";

const port = Number(process.argv[2]);
const request = http.get(
  {
    hostname: "127.0.0.1",
    port,
    path: "/api/health",
    headers: { host: `127.0.0.1:${port}`, connection: "close" },
  },
  (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => {
      process.stdout.write(body);
      process.exit(response.statusCode === 200 ? 0 : 22);
    });
  },
);
request.setTimeout(2_000, () => request.destroy(new Error("health request timed out")));
request.on("error", (error) => {
  process.stderr.write(error.message);
  process.exit(7);
});
NODE
  then
    body="$(cat "$probe_file")"
    rm -f "$probe_file"
    break
  fi
  last_probe_error="$(cat "$probe_file")"
  rm -f "$probe_file"
  sleep 0.25
done

grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$body" || {
  echo "Health check did not return ok=true: ${body:-${last_probe_error:-no response}}" >&2
  tail -80 "$log_file" >&2
  exit 1
}
grep -Eq "\"version\"[[:space:]]*:[[:space:]]*\"$expected_version\"" <<<"$body" || {
  echo "Health check version mismatch: $body" >&2
  exit 1
}
role="$(sed -n 's/^APP_ROLE=//p' "$app_dir/runtime.env" | tail -1)"
if [[ "$role" == pms ]]; then
  diagnostic_status="$(node --input-type=module - "$port" <<'NODE'
import http from "node:http";
const port = Number(process.argv[2]);
http.get({hostname:"127.0.0.1",port,path:"/api/pms/diagnostics"},response=>{
  response.resume();
  response.on("end",()=>process.stdout.write(String(response.statusCode)));
}).on("error",error=>{console.error(error.message);process.exitCode=1});
NODE
)"
  [[ "$diagnostic_status" == 401 || "$diagnostic_status" == 403 ]] || {
    echo "PMS diagnostics route returned HTTP $diagnostic_status during installation" >&2
    exit 1
  }
elif [[ "$role" == booking ]]; then
  availability_status="$(node --input-type=module - "$port" <<'NODE'
import http from "node:http";
const port=Number(process.argv[2]);
const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const checkIn=new Date(`${today}T12:00:00Z`);
checkIn.setUTCDate(checkIn.getUTCDate()+1);
const checkOut=new Date(checkIn);
checkOut.setUTCDate(checkOut.getUTCDate()+2);
const path=`/api/public/availability?checkIn=${checkIn.toISOString().slice(0,10)}&checkOut=${checkOut.toISOString().slice(0,10)}&adults=2&children=0&rooms=1&lang=en`;
http.get({hostname:"127.0.0.1",port,path},response=>{
 let body="";
 response.on("data",chunk=>body+=chunk);
 response.on("end",()=>{
  try{const result=JSON.parse(body);process.stdout.write(response.statusCode===200&&result.ok===true?"OK":`HTTP_${response.statusCode}_${result.error??"UNKNOWN"}`)}
  catch{process.stdout.write(`HTTP_${response.statusCode}_INVALID_JSON`)}
 });
}).on("error",error=>{console.error(error.message);process.exitCode=1});
NODE
)"
  [[ "$availability_status" == OK ]] || {
    echo "Booking availability failed against the installed database: $availability_status" >&2
    tail -80 "$log_file" >&2
    exit 1
  }
fi
echo "Runtime smoke test: OK — $expected_version"
