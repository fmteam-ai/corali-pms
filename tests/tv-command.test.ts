import { test } from "node:test";
import assert from "node:assert/strict";
import { ACK_TIMEOUT_MS, AGENT_ONLINE_MS, agentState, autoCommand, expiredStatus, reportStatus, validPowerMethod, menuLockState, menuLockVerdict, parseMenuLockRaw, powerState, parseStandbyDiag, standbyVerdict } from "../scripts/tv-command-core.mjs";

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

test("sound commands: EXECUTED only with a matching volume / mute read back", async () => {
  const { volumeStatus, reportStatus, normalizeSoundPolicy } = await import("../scripts/tv-command-core.mjs");
  assert.equal(volumeStatus({ command: "SET_VOLUME", value: 30 }, { volume: 33 }), "EXECUTED");
  assert.equal(volumeStatus({ command: "SET_VOLUME", value: 30 }, { volume: 60 }), "FAILED");
  assert.equal(volumeStatus({ command: "SET_VOLUME", value: 80, cap: 50 }, { volume: 50 }), "EXECUTED");
  assert.equal(volumeStatus({ command: "SET_VOLUME", value: 30 }, {}), "UNVERIFIED");
  assert.equal(volumeStatus({ command: "SET_VOLUME", value: 30 }, { volume: 30, fixed: true }), "FAILED");
  assert.equal(volumeStatus({ command: "MUTE" }, { muted: true }), "EXECUTED");
  assert.equal(volumeStatus({ command: "UNMUTE" }, { muted: true }), "FAILED");
  assert.equal(reportStatus({ status: "DELIVERED", command: "MUTE" }, { status: "EXECUTED", muted: true }), "EXECUTED");
  assert.equal(reportStatus({ status: "DELIVERED", command: "MUTE" }, { status: "FAILED", muted: false }), "FAILED");
  assert.deepEqual(normalizeSoundPolicy({ defaultVolume: 70, maxVolume: 50, enforceMax: true }), { defaultVolume: 50, maxVolume: 50, enforceMax: true });
  assert.deepEqual(normalizeSoundPolicy({ defaultVolume: "", maxVolume: null, enforceMax: true }), { defaultVolume: null, maxVolume: null, enforceMax: false });
  assert.deepEqual(normalizeSoundPolicy({ defaultVolume: 250 }), { defaultVolume: 100, maxVolume: null, enforceMax: false });
});

test("v160 resets: software policies only, never success without the TV's report", async () => {
  const { resetPlan, resetRoomStatus, normalizeSoundPreset } = await import("../scripts/tv-command-core.mjs");
  assert.deepEqual(normalizeSoundPreset(null), { defaultVolume: 8, maxVolume: 30, enforceMax: true });
  const cur = { defaultVolume: 20, maxVolume: 50, enforceMax: true };
  assert.deepEqual(resetPlan("hotel_default", cur, null), { policy: { defaultVolume: 8, maxVolume: 30, enforceMax: true }, commands: [{ command: "UNMUTE", value: null }] });
  assert.deepEqual(resetPlan("no_max_enforcement", cur, null), { policy: { defaultVolume: 20, maxVolume: 50, enforceMax: false }, commands: [] });
  assert.deepEqual(resetPlan("hotel_mode", cur, null).commands, [{ command: "UNMUTE", value: null }, { command: "SET_VOLUME", value: 8 }]);
  assert.deepEqual(resetPlan("restore_sound", cur, null), { policy: null, commands: [{ command: "UNMUTE", value: null }, { command: "SET_VOLUME", value: 20 }] });
  assert.deepEqual(resetPlan("restore_sound", null, { defaultVolume: 12, maxVolume: 40, enforceMax: true }).commands[1], { command: "SET_VOLUME", value: 12 });
  const base = { appVersion: 11, online: true, policyRev: 5, appliedRev: 5, needsPolicyAck: true };
  assert.equal(resetRoomStatus({ ...base, appVersion: 9, commands: [] }), "APP_TOO_OLD");
  assert.equal(resetRoomStatus({ ...base, commands: [{ status: "EXECUTED" }, { status: "EXECUTED" }] }), "EXECUTED");
  assert.equal(resetRoomStatus({ ...base, commands: [{ status: "EXECUTED" }, { status: "FAILED" }] }), "FAILED");
  assert.equal(resetRoomStatus({ ...base, online: false, commands: [{ status: "PENDING" }] }), "OFFLINE");
  assert.equal(resetRoomStatus({ ...base, commands: [{ status: "TIMEOUT" }] }), "OFFLINE");
  assert.equal(resetRoomStatus({ ...base, commands: [{ status: "CANCELLED" }] }), "SUPERSEDED");
  assert.equal(resetRoomStatus({ ...base, appliedRev: 4, commands: [] }), "PENDING");
  assert.equal(resetRoomStatus({ ...base, appVersion: 10, appliedRev: null, commands: [] }), "UNVERIFIED");
});


// ---- v163: Factory Menu command and the real «Lock Menu Key» state
test("v163: Factory Menu is EXECUTED only when the TV saw it come to the front", () => {
  const cmd = { status: "DELIVERED", command: "OPEN_FACTORY_MENU" };
  assert.equal(reportStatus(cmd, { status: "EXECUTED", opened: true }), "EXECUTED");
  assert.equal(reportStatus(cmd, { status: "EXECUTED", opened: false }), "FAILED");
  assert.equal(reportStatus(cmd, { status: "EXECUTED" }), "UNVERIFIED");
  assert.equal(reportStatus(cmd, { status: "FAILED" }), "FAILED");
  assert.equal(reportStatus({ ...cmd, status: "EXECUTED" }, { status: "EXECUTED", opened: true }), null);
});

test("v163: menu lock state from the TV's enabled states", () => {
  assert.equal(menuLockState("s2a2h2"), "LOCKED");
  assert.equal(menuLockState("s0a0h0"), "UNLOCKED");
  assert.equal(menuLockState("s1a1h1"), "UNLOCKED");
  assert.equal(menuLockState("s2a0h0"), "PARTIAL");
  assert.equal(menuLockState("s3a0h0"), "PARTIAL");
  assert.equal(menuLockState("s0a2h2"), "PARTIAL");
  assert.equal(menuLockState("sxa2h2"), "UNKNOWN");
  assert.equal(menuLockState("s0axhx"), "UNKNOWN");
  assert.equal(menuLockState("s2axhx"), "PARTIAL");
  assert.equal(menuLockState("LOCKED"), "UNKNOWN");
  assert.equal(menuLockState(null), "UNKNOWN");
  assert.equal(parseMenuLockRaw("s9a0h0"), null);
});


// ---- v164: power state, standby diagnostics, standby test verdict
test("v164: power state is measured, never assumed from the connection", () => {
  const now = 1_000_000_000;
  assert.deepEqual(powerState({ seenAt: now - 10_000, interactive: 1, now }), { state: "ON", reachable: true });
  assert.deepEqual(powerState({ seenAt: now - 10_000, interactive: 0, now }), { state: "STANDBY", reachable: true });
  assert.deepEqual(powerState({ seenAt: now - 10_000, interactive: null, now }), { state: "UNKNOWN", reachable: true });
  assert.deepEqual(powerState({ seenAt: now - 600_000, interactive: 0, now }), { state: "STANDBY", reachable: false });
  assert.deepEqual(powerState({ seenAt: now - 600_000, interactive: 1, now }), { state: "UNKNOWN", reachable: false });
  assert.deepEqual(powerState({ seenAt: null, interactive: null, now }), { state: "UNKNOWN", reachable: false });
  assert.equal(powerState({ seenAt: now - 600_000, interactive: 0, now, waking: true }).state, "WAKING");
  assert.equal(powerState({ seenAt: now - 600_000, interactive: 0, now, lastFailedAt: now - 60_000 }).state, "ERROR");
  assert.equal(powerState({ seenAt: now - 5_000, interactive: 1, now, lastFailedAt: now - 60_000 }).state, "ON");
});

test("v164: standby diagnostics flags", () => {
  assert.deepEqual(parseStandbyDiag({ ns: "1", cpu: "1", wl: "0", lps: "x", lpx: null, idl: "0", nv: "1" }),
    { networkStandby: true, cpuWakeLockHeld: true, wifiLockHeld: false, lowPowerStandbyEnabled: null, lowPowerStandbyExempt: null, deviceIdle: false, networkValidated: true });
});

test("v164: standby test verdict — PASS only when the TV took ON after the wait and the screen really came on", () => {
  const now = 5_000_000;
  assert.equal(standbyVerdict({}, { status: "PENDING" }, { status: "PENDING", not_before: now + 1 }, now), "STARTING");
  assert.equal(standbyVerdict({}, { status: "FAILED" }, { status: "PENDING", not_before: now + 1 }, now), "OFF_FAILED");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "PENDING", not_before: now + 1 }, now), "WAITING");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "PENDING", not_before: now - 1 }, now), "WAKE_DUE");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "DELIVERED" }, now), "WAKING");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "EXECUTED" }, now), "PASS");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "TIMEOUT" }, now), "FAIL_UNREACHABLE");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "FAILED" }, now), "FAIL_WAKE_REFUSED");
  assert.equal(standbyVerdict({}, { status: "EXECUTED" }, { status: "UNVERIFIED" }, now), "UNVERIFIED");
});

test("v164: diagnostics are EXECUTED only with the TV's text", () => {
  const cmd = { status: "DELIVERED", command: "NETWORK_DIAGNOSTICS" };
  assert.equal(reportStatus(cmd, { status: "EXECUTED", detail: "mWakefulness=Awake" }), "EXECUTED");
  assert.equal(reportStatus(cmd, { status: "EXECUTED" }), "UNVERIFIED");
});

test("v167: MENU_LOCK / MENU_UNLOCK are EXECUTED only with the target state read back and Hotel Status off", () => {
  const d = (command: string) => ({ status: "DELIVERED", command });
  const ok = (menuLock: string) => ({ status: "EXECUTED", menuLock });
  assert.equal(reportStatus(d("MENU_LOCK"), ok("s2a2h2g1e0")), "EXECUTED");
  assert.equal(reportStatus(d("MENU_UNLOCK"), ok("s1a0h0g0e0")), "EXECUTED");
  // Android disabled everything but the global flag says otherwise (or the reverse): not proven.
  assert.deepEqual(menuLockVerdict("MENU_LOCK", ok("s2a2h2g0e0")), { status: "FAILED", error: "STATE_NOT_CONFIRMED" });
  assert.deepEqual(menuLockVerdict("MENU_LOCK", ok("s0a0h0g1e0")), { status: "FAILED", error: "STATE_NOT_CONFIRMED" });
  assert.deepEqual(menuLockVerdict("MENU_LOCK", ok("s2a0h0g1e0")), { status: "FAILED", error: "STATE_PARTIAL" });
  assert.deepEqual(menuLockVerdict("MENU_UNLOCK", ok("s2a2h2g1e0")), { status: "FAILED", error: "STATE_NOT_CONFIRMED" });
  // Hotel Status must stay off: never success when the TV reports it on.
  assert.deepEqual(menuLockVerdict("MENU_LOCK", ok("s2a2h2g1e1")), { status: "FAILED", error: "HOTEL_MODE_ON" });
  // No state (old format, missing flags, garbage): never success.
  assert.deepEqual(menuLockVerdict("MENU_LOCK", ok("s2a2h2")), { status: "UNVERIFIED", error: "NO_STATE" });
  assert.deepEqual(menuLockVerdict("MENU_LOCK", ok("s2a2h2gxe0")), { status: "UNVERIFIED", error: "NO_STATE" });
  assert.deepEqual(menuLockVerdict("MENU_LOCK", { status: "EXECUTED" }), { status: "UNVERIFIED", error: "NO_STATE" });
  // A refusal on the TV keeps its own reason.
  assert.deepEqual(menuLockVerdict("MENU_LOCK", { status: "FAILED", error: "GUEST_APP_IN_FRONT", menuLock: "s1a1h1g0e0" }), { status: "FAILED", error: "GUEST_APP_IN_FRONT" });
  assert.equal(reportStatus(d("MENU_LOCK"), { status: "FAILED", error: "SCREEN_IS_OFF" }), "FAILED");
  assert.equal(reportStatus({ status: "EXECUTED", command: "MENU_LOCK" }, ok("s2a2h2g1e0")), null);
  // The extended raw still gives the same lock state; the flags are parsed.
  assert.equal(menuLockState("s2a2h2g1e0"), "LOCKED");
  assert.deepEqual(parseMenuLockRaw("s1a0h0g0e0"), { settings: 1, dashboardActivity: 0, dashboardHandler: 0, menuKeyLock: 0, hotelEnable: 0 });
  assert.equal(parseMenuLockRaw("s2a2h2g1"), null);
});

test("v167: SCREEN_OFF in the black-screen mode is EXECUTED when the app reports the black screen in front", () => {
  const d = { status: "DELIVERED", command: "SCREEN_OFF" };
  assert.equal(reportStatus(d, { status: "EXECUTED", interactive: true, blank: true }), "EXECUTED");
  assert.equal(reportStatus(d, { status: "EXECUTED", interactive: true }), "FAILED");
  assert.equal(reportStatus(d, { status: "FAILED", interactive: true, blank: false }), "FAILED");
  assert.equal(reportStatus({ status: "DELIVERED", command: "SCREEN_ON" }, { status: "EXECUTED", interactive: true }), "EXECUTED");
});
