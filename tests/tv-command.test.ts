import { test } from "node:test";
import assert from "node:assert/strict";
import { ACK_TIMEOUT_MS, AGENT_ONLINE_MS, agentState, autoCommand, expiredStatus, reportStatus, validPowerMethod } from "../scripts/tv-command-core.mjs";

test("commands expire: not delivered → TIMEOUT, delivered without report → UNVERIFIED, final never changes", () => {
  const now = 1_000_000;
  assert.equal(expiredStatus({ status: "PENDING", expires_at: now - 1, delivered_at: null }, now), "TIMEOUT");
  assert.equal(expiredStatus({ status: "PENDING", expires_at: now + 1, delivered_at: null }, now), "PENDING");
  assert.equal(expiredStatus({ status: "DELIVERED", expires_at: now, delivered_at: now - ACK_TIMEOUT_MS }, now), "UNVERIFIED");
  assert.equal(expiredStatus({ status: "DELIVERED", expires_at: now, delivered_at: now - 1000 }, now), "DELIVERED");
  assert.equal(expiredStatus({ status: "EXECUTED", expires_at: 0, delivered_at: 0 }, now), "EXECUTED");
});

test("EXECUTED only with a measured screen state that matches; reports are applied once", () => {
  const on = { status: "DELIVERED", command: "SCREEN_ON" }, off = { status: "DELIVERED", command: "SCREEN_OFF" };
  assert.equal(reportStatus(on, { status: "EXECUTED", interactive: true }), "EXECUTED");
  assert.equal(reportStatus(on, { status: "EXECUTED", interactive: false }), "FAILED");
  assert.equal(reportStatus(off, { status: "EXECUTED", interactive: false }), "EXECUTED");
  assert.equal(reportStatus(off, { status: "EXECUTED", interactive: true }), "FAILED");
  assert.equal(reportStatus(on, { status: "EXECUTED" }), "UNVERIFIED");
  assert.equal(reportStatus(on, { status: "FAILED", interactive: false }), "FAILED");
  assert.equal(reportStatus({ status: "EXECUTED", command: "SCREEN_ON" }, { status: "EXECUTED", interactive: true }), null);
  assert.equal(reportStatus({ status: "PENDING", command: "SCREEN_ON" }, { status: "EXECUTED", interactive: true }), null);
});

test("the PMS never says the TV is on without a recent report", () => {
  const now = 5_000_000;
  assert.equal(agentState(null, null, now), "unknown");
  assert.equal(agentState(now - AGENT_ONLINE_MS - 1, 1, now), "offline");
  assert.equal(agentState(now - 1000, 1, now), "screen_on");
  assert.equal(agentState(now - 1000, 0, now), "screen_off");
  assert.equal(agentState(now - 1000, null, now), "online");
});

test("automatic commands only on a change of the arrival / check-out decision", () => {
  const s = { autoOn: true, autoOff: true };
  assert.deepEqual(autoCommand(null, true, s), { state: "on", command: null });
  assert.deepEqual(autoCommand("on", true, s), { state: "on", command: null });
  assert.deepEqual(autoCommand("off", true, s), { state: "on", command: "SCREEN_ON" });
  assert.deepEqual(autoCommand("on", false, s), { state: "off", command: "SCREEN_OFF" });
  assert.deepEqual(autoCommand("on", false, { autoOn: true, autoOff: false }), { state: "off", command: null });
  assert.equal(validPowerMethod("android_agent"), true);
  assert.equal(validPowerMethod("ir_controller"), false);
});
