import { test } from "node:test";
import assert from "node:assert/strict";
import { desiredPower, normalizePowerSettings, plugAutomated } from "../scripts/tv-power-core.mjs";
import { runTvPlugs } from "../scripts/tv-plug-worker.mjs";

test("plug use: «tv» by default; «fridge» switches every room plug whatever the TV method", () => {
  assert.equal(normalizePowerSettings({}).plugUse, "tv");
  assert.equal(normalizePowerSettings({ plugUse: "fridge" }).plugUse, "fridge");
  assert.equal(normalizePowerSettings({ plugUse: "oven" }).plugUse, "tv");
  assert.equal(plugAutomated("tv", "shelly"), true);
  assert.equal(plugAutomated("tv", "android_agent"), false);
  assert.equal(plugAutomated("fridge", "android_agent"), true);
  assert.equal(plugAutomated("fridge", "manual"), true);
});

test("fridge follows the stay: on from the arrival time, on while checked in, off after check-out", () => {
  const stay = (status: string) => [{ status, check_in: "2026-11-20", check_out: "2026-11-22" }];
  assert.equal(desiredPower(stay("confirmed"), "2026-11-20", "10:59", "11:00"), false);
  assert.equal(desiredPower(stay("confirmed"), "2026-11-20", "11:00", "11:00"), true);
  assert.equal(desiredPower(stay("checked_in"), "2026-11-22", "12:00", "11:00"), true);
  assert.equal(desiredPower([], "2026-11-22", "12:00", "11:00"), false);
});

test("worker: with «fridge» an android_agent room's plug is switched on for an arrival, with Shelly's answer recorded", async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("FROM tv_power_settings")) return { rows: [{ settings_json: JSON.stringify({ enabled: true, server: "shelly-1-eu.shelly.cloud", onTime: "00:00", plugUse: "fridge" }), auth_key_encrypted: "x" }] };
      if (sql.includes("FROM tv_screens")) return { rows: [{ room_id: 112, power_device_id: "abcd1234", power_channel: 0, power_auto_state: 0, method: "android_agent", active: 1 }] };
      if (sql.includes("FROM bookings")) return { rows: [{ status: "checked_in", check_in: "2000-01-01", check_out: "2999-01-01" }] };
      return { rows: [] };
    },
  };
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => { calls.push(`${url} ${init.body}`); return new Response(JSON.stringify({ isok: true }), { status: 200 }); }) as typeof fetch;
  try {
    const r = await runTvPlugs({ pool, owner: "o", unseal: () => "key" });
    assert.equal(r.label, "Fridge");
    assert.equal(r.switched, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /"on":true/);
    assert.ok(queries.some((q) => q.startsWith("UPDATE tv_screens SET power_error")));
  } finally {
    globalThis.fetch = realFetch;
  }
});
