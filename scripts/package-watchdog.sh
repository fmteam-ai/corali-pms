#!/usr/bin/env bash
# v201: the external watchdog for Fly.io — separate from the PMS installation package.
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-v201}"
output="$project/corali-watchdog-$version.tar.gz"
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
root="$stage/corali-watchdog-$version"; mkdir -p "$root"
cp "$project/tools/watchdog/"{watchdog.mjs,Dockerfile,fly.toml,.env.example,README-GR.md} "$root/"
node --check "$root/watchdog.mjs"
(cd "$stage" && tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01' -czf "$output" "corali-watchdog-$version")
(cd "$project" && sha256sum "$(basename "$output")") | tee "$output.sha256"
