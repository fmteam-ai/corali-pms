import assert from "node:assert/strict";
import test from "node:test";
import { beachQuery, matrixBody, parseMatrix, parseTextSearch, textSearchBody, validCoord } from "../lib/beach-distance-core.ts";
import { normalizeBeaches } from "../lib/tv-beaches.ts";
import { normalizeTvSettings } from "../lib/tv-core.ts";

test("beach search text uses the note in brackets and stays inside Paros", () => {
  assert.equal(beachQuery("Λογαράς"), "Λογαράς, παραλία, Πάρος");
  assert.equal(beachQuery("Πούντα (μετά τον Λογαρά)"), "Πούντα, παραλία, Λογαρά, Πάρος");
  assert.equal(beachQuery("Δρυός / Λολαντώνης"), "Δρυός, παραλία, Πάρος");
  const b = textSearchBody("x");
  assert.equal(b.maxResultCount, 1);
  assert.ok(b.locationRestriction.rectangle.low.latitude < 37.0405 && b.locationRestriction.rectangle.high.longitude > 25.2555);
});

test("Text Search → point and label; nothing found → null", () => {
  assert.deepEqual(parseTextSearch({ places: [{ displayName: { text: "Παραλία Λογαράς" }, location: { latitude: 37.0371234, longitude: 25.2561239 }, formattedAddress: "Λογαράς 844 00" }] }), { lat: 37.037123, lon: 25.256124, label: "Παραλία Λογαράς · Λογαράς 844 00" });
  assert.equal(parseTextSearch({}), null);
  assert.equal(parseTextSearch(null), null);
});

test("route matrix → driving km and minutes per destination; no route skipped", () => {
  const body = matrixBody({ lat: 37.04, lon: 25.25 }, [{ lat: 37.03, lon: 25.25 }, { lat: 36.99, lon: 25.13 }]);
  assert.equal(body.destinations.length, 2);
  assert.equal(body.travelMode, "DRIVE");
  const m = parseMatrix([{ originIndex: 0, destinationIndex: 0, distanceMeters: 320, duration: "62s", condition: "ROUTE_EXISTS" }, { originIndex: 0, destinationIndex: 1, distanceMeters: 14180, duration: "1090s" }, { originIndex: 0, destinationIndex: 2, condition: "ROUTE_NOT_FOUND" }]);
  assert.deepEqual(m.get(0), { km: 0.3, meters: 320, minutes: 1 });
  assert.deepEqual(m.get(1), { km: 14.2, meters: 14180, minutes: 18 });
  assert.equal(m.has(2), false);
  assert.equal(parseMatrix({ error: 1 }).size, 0);
});

test("beach points and hotel position are kept only inside Paros", () => {
  assert.equal(validCoord(37.04, 25.25), true);
  assert.equal(validCoord(38, 23.7), false);
  const [b] = normalizeBeaches([{ name: "Λογαράς", minutes: 1, km: 0.3, sheltered: [], lat: 37.037, lon: 25.256, found: "Παραλία Λογαράς" }]);
  assert.equal(b.lat, 37.037);
  assert.equal(b.found, "Παραλία Λογαράς");
  assert.equal(normalizeBeaches([{ name: "X", lat: 40, lon: 20 }])[0].lat, undefined);
  assert.equal(normalizeTvSettings({ hotelLat: 37.041, hotelLon: 25.2551, hotelFound: "Hotel Corali" }).hotelLat, 37.041);
  assert.equal(normalizeTvSettings({ hotelLat: 50, hotelLon: 1 }).hotelLat, 37.0405);
});

test("coordinates pasted from Google Maps; walking matrix; beach walking minutes", async () => {
  const { parseCoords } = await import("../lib/beach-distance-core.ts");
  assert.deepEqual(parseCoords("37.0402134, 25.2561987"), { lat: 37.040213, lon: 25.256199 });
  assert.deepEqual(parseCoords(" 37.0402 25.2561 "), { lat: 37.0402, lon: 25.2561 });
  assert.equal(parseCoords("51.5, -0.12"), null);
  assert.equal(parseCoords("abc"), null);
  const w = matrixBody({ lat: 37.04, lon: 25.25 }, [{ lat: 37.03, lon: 25.25 }], "WALK");
  assert.equal(w.travelMode, "WALK");
  assert.equal("routingPreference" in w, false);
  assert.equal(normalizeBeaches([{ name: "Λογαράς", minutes: 1, km: 0.3, sheltered: [], walkMin: 4 }])[0].walkMin, 4);
  assert.equal(normalizeBeaches([{ name: "Λογαράς", minutes: 1, km: 0.3, sheltered: [] }])[0].walkMin, undefined);
});
