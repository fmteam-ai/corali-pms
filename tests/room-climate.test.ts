import assert from "node:assert/strict";
import test from "node:test";
import { climateFromStatus, evaluateClimate, normalizeClimateSettings } from "../scripts/room-climate-core.mjs";

const s = normalizeClimateSettings({});
const empty = { humid_since: null, hot_since: null, alerted_humid_at: null, alerted_temp_at: null, alerted_battery_at: null };
const H = 3_600_000, now = 1_800_000_000_000;

test("Tuya thermo-hygrometer data points are read (temperature ×10, battery level)", () => {
  assert.deepEqual(climateFromStatus([{ code: "va_temperature", value: 235 }, { code: "va_humidity", value: 61 }, { code: "battery_percentage", value: 80 }]), { temp: 23.5, humidity: 61, battery: 80 });
  assert.deepEqual(climateFromStatus([{ code: "temp_current", value: 24 }, { code: "humidity_value", value: 655 }, { code: "battery_state", value: "low" }]), { temp: 24, humidity: 66, battery: 10 });
  assert.equal(climateFromStatus([{ code: "switch_1", value: true }]), null);
  assert.equal(climateFromStatus(null), null);
});

test("damp room: alert after the set hours above the limit, then once a day", () => {
  const r = { temp: 22, humidity: 78, battery: 90 }, ctx = { occupied: false, acOnSince: null, now };
  const a = evaluateClimate(empty, r, ctx, s);
  assert.deepEqual(a.alerts, []);
  assert.equal(a.next.humid_since, now);
  const b = evaluateClimate(a.next, r, { ...ctx, now: now + 3 * H }, s);
  assert.deepEqual(b.alerts, ["humid"]);
  assert.deepEqual(evaluateClimate(b.next, r, { ...ctx, now: now + 4 * H }, s).alerts, []);
  assert.equal(evaluateClimate(b.next, { ...r, humidity: 60 }, ctx, s).next.humid_since, null);
});

test("A/C fault: hot room with a guest and the A/C powered long enough, confirmed 20 minutes later", () => {
  const hot = { temp: 30.5, humidity: 50, battery: 90 };
  assert.deepEqual(evaluateClimate(empty, hot, { occupied: true, acOnSince: now - 30 * 60_000, now }, s).alerts, [], "A/C just switched on");
  assert.equal(evaluateClimate(empty, hot, { occupied: false, acOnSince: now - 2 * H, now }, s).next.hot_since, null, "no guest");
  const a = evaluateClimate(empty, hot, { occupied: true, acOnSince: now - 2 * H, now }, s);
  assert.deepEqual(a.alerts, []);
  const b = evaluateClimate(a.next, hot, { occupied: true, acOnSince: now - 2 * H, now: now + 25 * 60_000 }, s);
  assert.deepEqual(b.alerts, ["hot"]);
  const cold = evaluateClimate({ ...empty, hot_since: now - H }, { ...hot, temp: 15 }, { occupied: true, acOnSince: now - 2 * H, now }, s);
  assert.deepEqual(cold.alerts, ["cold"]);
});

test("low battery alert once a week", () => {
  const r = { temp: 22, humidity: 50, battery: 15 }, ctx = { occupied: false, acOnSince: null, now };
  const a = evaluateClimate(empty, r, ctx, s);
  assert.deepEqual(a.alerts, ["battery"]);
  assert.deepEqual(evaluateClimate(a.next, r, { ...ctx, now: now + 2 * 86_400_000 }, s).alerts, []);
  assert.deepEqual(evaluateClimate(a.next, r, { ...ctx, now: now + 8 * 86_400_000 }, s).alerts, ["battery"]);
});
