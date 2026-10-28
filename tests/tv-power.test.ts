import assert from "node:assert/strict";
import test from "node:test";
import { desiredPower, deviceState, normalizePowerSettings, shellyServer, statusRequest, switchError, switchRequest, validDeviceId, wakeAction } from "../scripts/tv-power-core.mjs";

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
    { enabled: true, server: "https://shelly-77-eu.shelly.cloud", onTime: "13:00", autoOn: true, autoOff: false, acEnabled: false, acPresence: false, acAwayMinutes: 20, climate: { humidityMax: 70, humidityHours: 3, tempMax: 28, tempMin: 17, tempMinutes: 60, batteryMin: 20 } });
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
  assert.deepEqual(deviceState({ id: "a", online: 1, status: { "switch:0": { output: true, apower: 63.2 } } }), { online: true, on: true, power: 63.2 });
  assert.deepEqual(deviceState({ id: "a", online: 0, status: { relays: [{ ison: false }], meters: [{ power: 0 }] } }), { online: false, on: false, power: 0 });
  assert.deepEqual(deviceState(undefined), { online: false, on: null, power: null });
});

test("Urgent wake through the plug: on when off, power-cycle a TV in standby, leave a running TV alone", () => {
  assert.equal(wakeAction({ online: true, on: false, power: 0 }), "on");
  assert.equal(wakeAction({ online: true, on: true, power: 0.6 }), "cycle");
  assert.equal(wakeAction({ online: true, on: true, power: 72 }), "none");
  assert.equal(wakeAction({ online: true, on: true, power: null }), "none", "no power meter: do not cut the power");
  assert.equal(wakeAction({ online: false, on: false, power: null }), "none");
});

test("room A/C has power only while a guest is checked in, unless staff switched it by hand", async () => {
  const { acTarget, acOverride, AC_MANUAL_EMPTY_MS } = await import("../scripts/tv-power-core.mjs");
  const now = 1_800_000_000_000;
  assert.equal(acTarget(true, null, now), true);
  assert.equal(acTarget(false, null, now), false);
  const offWhileIn = acOverride(false, true, now);
  assert.equal(acTarget(true, offWhileIn, now + 3_600_000), false); // staff turned it off, guest still in
  assert.equal(acTarget(false, offWhileIn, now + 3_600_000), false); // checked out: back to automatic (off)
  const coolBeforeArrival = acOverride(true, false, now);
  assert.equal(coolBeforeArrival.until, now + AC_MANUAL_EMPTY_MS);
  assert.equal(acTarget(false, coolBeforeArrival, now + 60_000), true);
  assert.equal(acTarget(false, coolBeforeArrival, now + AC_MANUAL_EMPTY_MS + 1), false); // expired
  assert.equal(acTarget(true, coolBeforeArrival, now + 60_000), true); // guest arrived: automatic (on)
});

test("with a presence sensor the A/C is cut only after nobody was seen for the away time", async () => {
  const { acTarget, acOverride, PRESENCE_STALE_MS } = await import("../scripts/tv-power-core.mjs");
  const now = 1_800_000_000_000, away = 20 * 60_000;
  assert.equal(acTarget(true, null, now, { seenAt: now - 5 * 60_000, checkedAt: now - 30_000, awayMs: away }), true);
  assert.equal(acTarget(true, null, now, { seenAt: now - 25 * 60_000, checkedAt: now - 30_000, awayMs: away }), false);
  assert.equal(acTarget(true, null, now, { seenAt: now - 25 * 60_000, checkedAt: now - PRESENCE_STALE_MS - 1, awayMs: away }), true, "old readings keep it on");
  assert.equal(acTarget(false, null, now, { seenAt: now, checkedAt: now, awayMs: away }), false, "no guest, no A/C");
  assert.equal(acTarget(true, acOverride(true, true, now - 60_000), now, { seenAt: 0, checkedAt: now, awayMs: away }), true, "staff choice wins");
});

test("Tuya presence data points and request signature", async () => {
  const { presenceFromStatus, tuyaHeaders, tuyaSign } = await import("../scripts/tuya-core.mjs");
  const { createHash, createHmac } = await import("node:crypto");
  assert.equal(presenceFromStatus([{ code: "presence_state", value: "presence" }, { code: "illuminance_value", value: 80 }]), true);
  assert.equal(presenceFromStatus([{ code: "presence_state", value: "none" }]), false);
  assert.equal(presenceFromStatus([{ code: "human_motion_state", value: "small_move" }]), true);
  assert.equal(presenceFromStatus([{ code: "presence", value: false }]), false);
  assert.equal(presenceFromStatus([{ code: "battery", value: 90 }]), null);
  assert.equal(presenceFromStatus(null), null);
  const sts = ["GET", createHash("sha256").update("").digest("hex"), "", "/v1.0/token?grant_type=1"].join("\n");
  assert.equal(tuyaSign({ accessId: "id", secret: "sec", t: "1700000000000", method: "GET", path: "/v1.0/token?grant_type=1" }), createHmac("sha256", "sec").update(`id1700000000000${sts}`).digest("hex").toUpperCase());
  const h = tuyaHeaders({ accessId: "id", secret: "sec", token: "tok", method: "GET", path: "/x", t: "1" });
  assert.equal(h.access_token, "tok");
  assert.equal(h.sign_method, "HMAC-SHA256");
});
