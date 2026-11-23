import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const py = spawnSync("python3", ["--version"]).status === 0;

test("v196 AC probe: read-only diagnostics from the factory Wi-Fi modules — local vs cloud, no secrets, no guest devices", { skip: !py && "python3 not available" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-")), out = join(dir, "r.json");
  // The stubs (PYTHONPATH) replace tinytuya / broadlink: no network, and any command call raises «COMMAND SENT».
  const run = spawnSync("python3", [resolve("tools/ac-probe/ac_probe.py"), "--seconds", "1", "--no-port-check", "--neigh-file", resolve("tests/fixtures/ac-probe-neigh.txt"),
    "--tuya-id", "bf1234567890abcdef", "--tuya-ip", "192.168.10.21", "--tuya-key", "SECRETKEY123", "--broadlink-auth", "--out", out], { cwd: dir, encoding: "utf8", env: { ...process.env, PYTHONPATH: resolve("tests/fixtures/ac-probe-stubs"), PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout + run.stderr, /COMMAND SENT/, "no command reaches an A/C");
  const text = readFileSync(out, "utf8"), rep = JSON.parse(text);
  assert.doesNotMatch(text, /SECRETKEY123/, "the local key is never exported");
  assert.doesNotMatch(text, /50:c7:bf|3a:11:22/, "router / guest phone are counted, not listed");
  assert.equal(rep.version, 2);
  assert.equal(rep.extra_hardware, false);
  assert.equal(rep.neighbors.not_listed, 2);
  const by = Object.fromEntries(rep.devices.map((d: { ip: string }) => [d.ip, d]));
  assert.equal(by["192.168.10.21"].module_vendor, "Tuya Smart");
  assert.equal(by["192.168.10.21"].access, "LOCAL_API");
  assert.deepEqual(by["192.168.10.21"].tuya_read.candidates, { power: true, setpoint: 24, room_temperature: 27, mode: "cold", fan_speed: "auto" });
  assert.equal(by["192.168.10.31"].access, "LOCAL_API");
  assert.equal(by["192.168.10.32"].access, "LOCAL_LOCKED");
  assert.equal(by["192.168.10.77"].access, "CLOUD_ONLY_OR_UNKNOWN");
  assert.deepEqual(rep.summary, { LOCAL_API: 2, LOCAL_LOCKED: 1, CLOUD_ONLY_OR_UNKNOWN: 1 });
});
