import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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
  const text = readFileSync(out, "utf8");
  return { text, rep: JSON.parse(text), by: Object.fromEntries(JSON.parse(text).devices.map((d: { ip: string }) => [d.ip, d])) };
}

test("v197 AC probe: discovery is not proof — AUTHENTICATED / DISCOVERED_UNVERIFIED / AUTH_FAILED / NETWORK_ERROR / LOCAL_LOCKED", { skip: !py && "python3 not available" }, () => {
  const { rep, by } = probe([]);
  assert.equal(rep.version, 3);
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
