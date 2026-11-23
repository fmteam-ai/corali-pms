import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const py = spawnSync("python3", ["--version"]).status === 0;
// The stubs (PYTHONPATH) replace tinytuya / broadlink: no network, and any command call raises «COMMAND SENT».
function probe(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "acp-")), out = join(dir, "r.json");
  const run = spawnSync("python3", [resolve("tools/ac-probe/ac_probe.py"), "--seconds", "1", "--no-port-check", "--neigh-file", resolve("tests/fixtures/ac-probe-neigh.txt"), ...args, "--out", out], {
    cwd: dir, encoding: "utf8", env: { ...process.env, PYTHONPATH: resolve("tests/fixtures/ac-probe-stubs"), PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout + run.stderr, /COMMAND SENT/, "no command reaches an A/C");
  const text = readFileSync(out, "utf8"), shareText = readFileSync(join(dir, "r-share.json"), "utf8");
  return { text, shareText, mode: statSync(out).mode & 0o777, rep: JSON.parse(text), share: JSON.parse(shareText), by: Object.fromEntries(JSON.parse(text).devices.map((d: { ip: string }) => [d.ip, d])) };
}

test("v197 AC probe: discovery is not proof — AUTHENTICATED / DISCOVERED_UNVERIFIED / AUTH_FAILED / NETWORK_ERROR / LOCAL_LOCKED", { skip: !py && "python3 not available" }, () => {
  const { rep, by } = probe([]);
  assert.equal(rep.version, 4);
  assert.equal(by["192.168.10.31"].access, "DISCOVERED_UNVERIFIED", "BroadLink answered discovery, no local session tried");
  assert.equal(by["192.168.10.21"].access, "DISCOVERED_UNVERIFIED", "Tuya broadcast, no key");
  assert.equal(by["192.168.10.32"].access, "LOCAL_LOCKED");
  const auth = probe(["--broadlink-auth"]).by;
  assert.equal(auth["192.168.10.31"].access, "AUTHENTICATED");
  assert.equal(auth["192.168.10.33"].access, "NETWORK_ERROR", "a timeout is not a lock");
  assert.equal(auth["192.168.10.34"].access, "AUTH_FAILED");
  assert.equal(auth["192.168.10.32"].access, "LOCAL_LOCKED");
});

test("v196/v197 AC probe: explicit Tuya target read even when discovery misses it; no secrets, no guest devices", { skip: !py && "python3 not available" }, () => {
  // 192.168.10.99 is not in the scan nor in the neighbour table: the requested read still happens.
  const { text, rep, by } = probe(["--tuya-id", "bf00000000000000aa", "--tuya-ip", "192.168.10.99", "--tuya-key", "SECRETKEY123"]);
  assert.doesNotMatch(text, /SECRETKEY123/, "the local key is never exported");
  assert.doesNotMatch(text, /50:c7:bf|3a:11:22/, "router / guest phone are counted, not listed");
  assert.equal(rep.extra_hardware, false);
  assert.equal(by["192.168.10.99"].requested, true);
  assert.equal(by["192.168.10.99"].seen_by_discovery, false);
  assert.equal(by["192.168.10.99"].access, "AUTHENTICATED");
  assert.deepEqual(by["192.168.10.99"].tuya_read.candidates, { power: true, setpoint: 24, room_temperature: 27, mode: "cold", fan_speed: "auto" });
  // Wrong key (tinytuya Err 914) → AUTH_FAILED; timeout → NETWORK_ERROR.
  assert.equal(probe(["--tuya-id", "x", "--tuya-ip", "192.168.10.21", "--tuya-key", "BADKEY_000"]).by["192.168.10.21"].access, "AUTH_FAILED");
  assert.equal(probe(["--tuya-id", "x", "--tuya-ip", "192.168.10.21", "--tuya-key", "TIMEOUT_000"]).by["192.168.10.21"].access, "NETWORK_ERROR");
});

test("v198 AC probe: compatibility level per device (DISCOVERED → AUTHENTICATED → STATUS_READ, never COMMAND_CONFIRMED); protected full report, shareable copy without IP/MAC/IDs", { skip: !py && "python3 not available" }, () => {
  const r = probe(["--broadlink-auth", "--tuya-id", "bf1234567890abcdef", "--tuya-ip", "192.168.10.21", "--tuya-key", "SECRETKEY123"]);
  assert.equal(r.by["192.168.10.21"].level, "STATUS_READ");
  assert.equal(r.by["192.168.10.31"].level, "AUTHENTICATED");
  assert.equal(r.by["192.168.10.33"].level, "DISCOVERED", "a timeout proves nothing beyond discovery");
  assert.equal(r.by["192.168.10.34"].level, "DISCOVERED");
  assert.ok(!r.rep.devices.some((d: { level: string }) => d.level === "COMMAND_CONFIRMED"), "the probe sends no command, so it never claims one");
  assert.match(r.rep.classification, /^PROTECTED_DIAGNOSTICS/);
  assert.equal(r.mode, 0o600, "the full report is readable by its owner only");
  // The shareable copy: labels instead of IP / MAC / device id / product key; levels and findings kept.
  for (const secret of ["192.168.10.", "34:ea:34", "10:d5:61", "bf1234567890abcdef", "keyabc", "SECRETKEY123"]) assert.ok(!r.shareText.includes(secret), secret);
  assert.match(r.share.classification, /^SHAREABLE/);
  assert.deepEqual(r.share.devices.map((d: { label: string }) => d.label), r.rep.devices.map((_: unknown, i: number) => `dev-${i + 1}`));
  assert.deepEqual(r.share.devices.map((d: { level: string }) => d.level), r.rep.devices.map((d: { level: string }) => d.level));
});
