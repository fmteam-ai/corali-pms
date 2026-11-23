#!/usr/bin/env bash
# v196: the diagnostics package (AC Probe) — separate from the PMS installation package. Source + tests + README.
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-v196}"
output="$project/corali-diagnostics-$version.tar.gz"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
root="$stage/corali-diagnostics-$version"
mkdir -p "$root/ac-probe/tests/stubs"
cp "$project/tools/ac-probe/ac_probe.py" "$project/tools/ac-probe/README-GR.md" "$root/ac-probe/"
cp "$project/tests/fixtures/ac-probe-stubs/"*.py "$root/ac-probe/tests/stubs/"
cp "$project/tests/fixtures/ac-probe-neigh.txt" "$root/ac-probe/tests/neigh-sample.txt"
cat > "$root/ac-probe/tests/self-test.sh" <<'SH'
#!/usr/bin/env bash
# Offline self-test with stub libraries: no network, no command can be sent (the stubs raise «COMMAND SENT»).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="$(mktemp -d)/r.json"
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$here/stubs" python3 "$here/../ac_probe.py" --seconds 1 --no-port-check --neigh-file "$here/neigh-sample.txt" \
  --tuya-id bf1234567890abcdef --tuya-ip 192.168.10.21 --tuya-key SECRETKEY123 --broadlink-auth --out "$out" >/dev/null
! grep -q SECRETKEY123 "$out" || { echo "FAIL: key in report"; exit 1; }
! grep -q '3a:11:22' "$out" || { echo "FAIL: non-IoT device listed"; exit 1; }
grep -q '"LOCAL_LOCKED"' "$out" && grep -q '"LOCAL_API"' "$out" && echo "SELF-TEST PASS"
SH
chmod 755 "$root/ac-probe/tests/self-test.sh" "$root/ac-probe/ac_probe.py"
bash "$root/ac-probe/tests/self-test.sh"
(cd "$stage" && tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01' -czf "$output" "corali-diagnostics-$version")
(cd "$project" && sha256sum "$(basename "$output")") | tee "$output.sha256"
