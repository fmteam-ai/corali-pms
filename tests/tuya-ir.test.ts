import { test } from "node:test";
import assert from "node:assert/strict";
import { acScene, irAcScene, irSendKey, pickPowerKey, tuyaSign } from "../scripts/tuya-core.mjs";

test("v170: A/C scene is clamped to what the Tuya IR API accepts", () => {
  assert.deepEqual(acScene({ mode: 0, temp: 25, wind: 0 }), { power: 1, mode: 0, temp: 25, wind: 0 });
  assert.deepEqual(acScene({ power: false, mode: 9, temp: 40, wind: -1 }), { power: 0, mode: 4, temp: 30, wind: 0 });
  assert.deepEqual(acScene({ temp: "abc" }), { power: 1, mode: 0, temp: 25, wind: 0 });
  assert.deepEqual(acScene(null), { power: 1, mode: 0, temp: 25, wind: 0 });
});

test("v170: the TV's Power key is found in the remote's key list", () => {
  assert.deepEqual(pickPowerKey({ category_id: 2, key_list: [{ key: "Mute", key_id: 3 }, { key: "Power", key_id: 1, key_name: "Power" }] }), { category_id: 2, key: "Power", key_id: 1 });
  assert.deepEqual(pickPowerKey({ category_id: 2, key_list: [{ key: "K1", key_id: 7, key_name: "POWER on/off" }] }), { category_id: 2, key: "K1", key_id: 7 });
  assert.equal(pickPowerKey({ category_id: 2, key_list: [{ key: "Mute", key_id: 3 }] }), null);
  assert.equal(pickPowerKey(null), null);
});

test("v170: IR requests are signed over the JSON body and go to the right path", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ success: true, result: true }), { status: 200 }); }) as unknown as typeof fetch;
  const creds = { accessId: "id1234", secret: "s3cr3t" };
  await irAcScene(fake, "https://h", creds, "tok", "bf7928c441f7c7ca61fnir", "acremote123", { mode: 1, temp: 22, wind: 2 });
  assert.equal(calls[0].url, "https://h/v2.0/infrareds/bf7928c441f7c7ca61fnir/air-conditioners/acremote123/scenes/command");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, JSON.stringify({ power: 1, mode: 1, temp: 22, wind: 2 }));
  const h = calls[0].init.headers as Record<string, string>;
  const path = "/v2.0/infrareds/bf7928c441f7c7ca61fnir/air-conditioners/acremote123/scenes/command";
  assert.equal(h.sign, tuyaSign({ accessId: "id1234", secret: "s3cr3t", token: "tok", t: h.t, method: "POST", path, body: String(calls[0].init.body) }));
  await irSendKey(fake, "https://h", creds, "tok", "bf7928c441f7c7ca61fnir", "bf134fec24eb1d39a6jzkq", { category_id: 2, key: "Power", key_id: 1 });
  assert.equal(calls[1].url, "https://h/v2.0/infrareds/bf7928c441f7c7ca61fnir/remotes/bf134fec24eb1d39a6jzkq/command");
  await assert.rejects(irSendKey(fake, "https://h", creds, "tok", "../x", "abcdef", { category_id: 2, key: "Power", key_id: 1 }), /BAD_ID/);
});

test("IR A/C settings are clamped and kept with the power settings", async () => {
  const { normalizeIrSettings, normalizePowerSettings } = await import("../scripts/tv-power-core.mjs");
  assert.deepEqual(normalizeIrSettings(null), { auto: false, mode: 0, temp: 25, wind: 0, limit: false, coolMin: 20, heatMax: 26, quiet: true });
  assert.deepEqual(normalizeIrSettings({ auto: true, mode: 9, temp: 40, wind: -1 }), { auto: true, mode: 4, temp: 30, wind: 0, limit: false, coolMin: 20, heatMax: 26, quiet: true });
  assert.deepEqual(normalizePowerSettings({ ir: { auto: true, mode: 1, temp: 22, wind: 2 } }).ir, { auto: true, mode: 1, temp: 22, wind: 2, limit: false, coolMin: 20, heatMax: 26, quiet: true });
});

test("v171: IR temperature limit corrects only an occupied room past the limit, by season, rate-limited", async () => {
  const { irLimitDecision, irOnTemp, normalizeIrSettings } = await import("../scripts/tv-power-core.mjs");
  const noon = Date.parse("2026-07-01T09:00:00Z"); // 12:00 Athens
  const cool = normalizeIrSettings({ mode: 0, temp: 21, limit: true, coolMin: 20, heatMax: 26 });
  const x = { temp: 19, readAt: noon, occupied: true, lastAt: null, count: 0, now: noon };
  assert.deepEqual(irLimitDecision(cool, x).send, { power: true, mode: 0, temp: 21, wind: 0 });
  assert.equal(irLimitDecision(cool, { ...x, temp: 20 }).send, null);
  assert.equal(irLimitDecision(cool, { ...x, temp: 20 }).inRange, true);
  assert.equal(irLimitDecision(cool, { ...x, temp: 30 }).send, null); // hot in summer: not the limit's job
  assert.equal(irLimitDecision(cool, { ...x, occupied: false }).send, null);
  assert.equal(irLimitDecision(cool, { ...x, lastAt: noon - 30 * 60_000 }).send, null);
  assert.equal(irLimitDecision(cool, { ...x, count: 3 }).send, null);
  assert.equal(irLimitDecision(cool, { ...x, now: Date.parse("2026-07-01T21:30:00Z"), readAt: Date.parse("2026-07-01T21:30:00Z") }).send, null); // 00:30 quiet
  assert.equal(irLimitDecision({ ...cool, limit: false }, x).send, null);
  const heat = normalizeIrSettings({ mode: 1, temp: 28, limit: true, heatMax: 26 });
  assert.equal(irLimitDecision(heat, { ...x, temp: 27 }).send?.temp, 25);
  assert.equal(irOnTemp(heat), 26);
  assert.equal(irOnTemp(normalizeIrSettings({ mode: 0, temp: 18, limit: true, coolMin: 20 })), 20);
});
