import assert from "node:assert/strict";
import test from "node:test";
import { arrivalInstructions, arrivalOptions, defaultArrivalSettings, normalizeArrivalSettings, pick, transferQuote } from "../lib/arrival.ts";

test("default templates cover every arrival mode with Greek and English text", () => {
  const s = defaultArrivalSettings();
  for (const mode of ["port", "airport", "car", "taxi"] as const) {
    assert.ok(s.modes[mode].hubs.length > 0, mode);
    for (const h of s.modes[mode].hubs) assert.ok(h.text.el && h.text.en, `${mode}/${h.key}`);
  }
  assert.deepEqual(s.transfer.vehicles.map((v) => [v.key, v.priceCents]), [["sedan", 3500], ["minivan", 6000]]);
});

test("instructions fall back to English for languages without a translation", () => {
  const s = defaultArrivalSettings();
  const de = arrivalInstructions(s, "port", "parikia", "de");
  assert.match(de!.text, /Ferries from Piraeus/);
  assert.match(arrivalInstructions(s, "port", "parikia", "el")!.text, /Πειραιά/);
  assert.equal(arrivalInstructions(s, "port", "nowhere", "en"), null);
  assert.equal(pick({ el: "Γεια" }, "fr"), "Γεια");
  s.modes.car.enabled = false;
  assert.equal(arrivalInstructions(s, "car", "self_drive", "en"), null);
  assert.deepEqual(arrivalOptions(s, "en").modes.map((m) => [m.mode, m.transfer]), [["port", true], ["airport", true], ["taxi", false]]);
});

test("transfer quotes enforce mode, vehicle status and capacity", () => {
  const s = defaultArrivalSettings();
  const ok = transferQuote(s, { mode: "airport", vehicle: "sedan", passengers: 2 });
  assert.ok(ok.ok && ok.vehicle.priceCents === 3500);
  assert.deepEqual(transferQuote(s, { mode: "car", vehicle: "sedan", passengers: 2 }), { ok: false, error: "TRANSFER_NOT_FOR_MODE" });
  assert.deepEqual(transferQuote(s, { mode: "port", vehicle: "sedan", passengers: 4 }), { ok: false, error: "VEHICLE_TOO_SMALL" });
  assert.deepEqual(transferQuote(s, { mode: "port", vehicle: "limo", passengers: 1 }), { ok: false, error: "VEHICLE_UNAVAILABLE" });
  s.transfer.vehicles[1].active = false;
  assert.deepEqual(transferQuote(s, { mode: "port", vehicle: "minivan", passengers: 5 }), { ok: false, error: "VEHICLE_UNAVAILABLE" });
  s.transfer.enabled = false;
  assert.deepEqual(transferQuote(s, { mode: "port", vehicle: "sedan", passengers: 1 }), { ok: false, error: "TRANSFER_DISABLED" });
  assert.deepEqual(arrivalOptions(s, "en").vehicles, []);
});

test("submitted settings are sanitised", () => {
  const s = normalizeArrivalSettings(JSON.stringify({
    modes: { port: { enabled: true, hubs: [{ key: "naxos", name: { en: "Naxos" }, text: { en: "Take the boat", xx: "bad" } }, { key: "BAD KEY", name: {}, text: {} }, { key: "naxos", name: {}, text: {} }] } },
    transfer: { enabled: true, autoFolio: false, modes: ["airport", "space"], vehicles: [{ key: "van", name: { el: "Βαν" }, priceCents: 8000, maxPassengers: 8 }, { key: "cheat", priceCents: -5, maxPassengers: 2 }, { key: "big", priceCents: 1, maxPassengers: 999 }] },
  }));
  assert.deepEqual(s.modes.port.hubs, [{ key: "naxos", name: { en: "Naxos" }, text: { en: "Take the boat" } }]);
  assert.equal(s.modes.airport.hubs.length, 2); // untouched modes keep defaults
  assert.deepEqual(s.transfer, { enabled: true, autoFolio: false, modes: ["airport"], vehicles: [{ key: "van", name: { el: "Βαν" }, priceCents: 8000, maxPassengers: 8, active: true }] });
  assert.deepEqual(normalizeArrivalSettings("not json"), defaultArrivalSettings());
});
