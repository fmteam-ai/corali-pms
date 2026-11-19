import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ACK_TIMEOUT_MS, APP_UPDATE_ACK_MS, expiredStatus, reportStatus, TV_APP_LATEST } from "../scripts/tv-command-core.mjs";

test("the latest Corali TV build named by the PMS is the file in public/downloads (hash)", () => {
  const sha = createHash("sha256").update(readFileSync(`public/downloads/${TV_APP_LATEST.file}`)).digest("hex");
  assert.equal(TV_APP_LATEST.sha256, sha);
});

test("APP_UPDATE is EXECUTED only when the restarted app reports the target versionCode", () => {
  const cmd = { status: "DELIVERED", command: "APP_UPDATE", value: 21 };
  assert.equal(reportStatus(cmd, { status: "EXECUTED", version: 21 }), "EXECUTED");
  assert.equal(reportStatus(cmd, { status: "EXECUTED", version: 22 }), "EXECUTED");
  assert.equal(reportStatus(cmd, { status: "EXECUTED", version: 20 }), "FAILED");
  assert.equal(reportStatus(cmd, { status: "EXECUTED" }), "FAILED");
  assert.equal(reportStatus(cmd, { status: "FAILED", version: 21, error: "HASH_MISMATCH" }), "FAILED");
  assert.equal(reportStatus({ ...cmd, status: "EXECUTED" }, { status: "EXECUTED", version: 21 }), null);
});

test("APP_UPDATE waits 10 minutes for its report; screen commands keep 2 minutes", () => {
  const at = 1_000_000;
  const later = at + ACK_TIMEOUT_MS + 1;
  assert.equal(expiredStatus({ status: "DELIVERED", expires_at: at * 10, delivered_at: at, command: "APP_UPDATE" }, later), "DELIVERED");
  assert.equal(expiredStatus({ status: "DELIVERED", expires_at: at * 10, delivered_at: at, command: "APP_UPDATE" }, at + APP_UPDATE_ACK_MS), "UNVERIFIED");
  assert.equal(expiredStatus({ status: "DELIVERED", expires_at: at * 10, delivered_at: at, command: "SCREEN_ON" }, later), "UNVERIFIED");
});
