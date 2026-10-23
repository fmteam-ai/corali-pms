import assert from "node:assert/strict";
import test from "node:test";
import { desiredPower, deviceState, normalizePowerSettings, shellyServer, statusRequest, switchError, switchRequest, validDeviceId } from "../scripts/tv-power-core.mjs";

const stay = (status: string, check_in: string, check_out: string) => ({ status, check_in, check_out });

test("TV power follows the stay: from the switch-on time of the arrival day, off after check-out", () => {
  const s = [stay("confirmed", "2026-07-10", "2026-07-13")];
  assert.equal(desiredPower(s, "2026-07-10", "12:59", "13:00"), false, "arrival day before the switch-on time");
  assert.equal(desiredPower(s, "2026-07-10", "13:00", "13:00"), true);
  assert.equal(desiredPower(s, "2026-07-11", "03:00", "13:00"), true, "nights in between");
  assert.equal(desiredPower(s, "2026-07-13", "09:00", "13:00"), false, "departure day of a stay never checked in");
  assert.equal(desiredPower([stay("checked_in", "2026-07-10", "2026-07-13")], "2026-07-13", "17:00", "13:00"), true, "late check-out: on until checked out");
  assert.equal(desiredPower([stay("checked_in", "2026-07-10", "2026-07-13")], "2026-07-10", "09:00", "13:00"), true, "early check-in at reception");
  assert.equal(desiredPower([], "2026-07-10", "14:00", "13:00"), false, "empty room");
  assert.equal(desiredPower(s, "2026-07-10", "13:00", "bad"), true, "invalid time falls back to 13:00");
});

test("Shelly server, device id and settings are validated", () => {
  assert.equal(shellyServer("shelly-103-eu.shelly.cloud"), "https://shelly-103-eu.shelly.cloud");
  assert.equal(shellyServer("https://SHELLY-103-EU.shelly.cloud/"), "https://shelly-103-eu.shelly.cloud");
  assert.equal(shellyServer("https://evil.example.com"), "", "only *.shelly.cloud");
  assert.equal(shellyServer("shelly.cloud.evil.com"), "");
  assert.equal(validDeviceId("e4b063f0c38c"), true);
  assert.equal(validDeviceId("bad id"), false);
  assert.deepEqual(normalizePowerSettings({ enabled: true, server: "shelly-77-eu.shelly.cloud", onTime: "25:00", autoOff: false }),
    { enabled: true, server: "https://shelly-77-eu.shelly.cloud", onTime: "13:00", autoOn: true, autoOff: false });
  assert.equal(normalizePowerSettings(null).enabled, false);
});

test("Shelly requests and replies", () => {
  const r = switchRequest("https://shelly-1-eu.shelly.cloud", "k&ey", "abc123", 0, true);
  assert.equal(r.url, "https://shelly-1-eu.shelly.cloud/v2/devices/api/set/switch?auth_key=k%26ey");
  assert.deepEqual(JSON.parse(r.body), { id: "abc123", channel: 0, on: true });
  assert.deepEqual(JSON.parse(statusRequest("https://x.shelly.cloud", "k", Array.from({ length: 12 }, (_, i) => `d${i}`)).body).ids.length, 10);
  assert.equal(switchError(200, null, "abc123"), "");
  assert.equal(switchError(401, null, "abc123"), "SHELLY_AUTH");
  assert.equal(switchError(429, null, "abc123"), "SHELLY_RATE_LIMIT");
  assert.equal(switchError(200, { abc123: "DEVICE_OFFLINE" }, "abc123"), "DEVICE_OFFLINE");
  assert.deepEqual(deviceState({ id: "a", online: 1, status: { "switch:0": { output: true } } }), { online: true, on: true });
  assert.deepEqual(deviceState({ id: "a", online: 0, status: { relays: [{ ison: false }] } }), { online: false, on: false });
  assert.deepEqual(deviceState(undefined), { online: false, on: null });
});
