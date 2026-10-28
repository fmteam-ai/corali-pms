import assert from "node:assert/strict";
import test from "node:test";
import { clampRadiusKm, metersBetween, nearbyText, overpassQuery, parseOverpass, walkMinutes } from "../lib/tv-nearby-core.ts";

const H = { lat: 37.0405, lon: 25.2555 };

test("distance and walking time", () => {
  assert.equal(metersBetween(H.lat, H.lon, H.lat, H.lon), 0);
  const m = metersBetween(H.lat, H.lon, H.lat + 0.009, H.lon); // ~1 km north
  assert.ok(m > 990 && m < 1010);
  assert.equal(walkMinutes(400), 7);
  assert.equal(walkMinutes(10), 1);
});

test("radius is clamped and used in the Overpass query", () => {
  assert.equal(clampRadiusKm(0), 1);
  assert.equal(clampRadiusKm(0.1), 0.3);
  assert.equal(clampRadiusKm(20), 5);
  assert.match(overpassQuery(H.lat, H.lon, 1), /around:1000,37\.0405,25\.2555/);
});

test("Overpass → named places within the radius, nearest first, no duplicates", () => {
  const json = { elements: [
    { type: "node", lat: H.lat + 0.004, lon: H.lon, tags: { amenity: "restaurant", name: "Taverna Far", cuisine: "greek;seafood" } },
    { type: "node", lat: H.lat + 0.001, lon: H.lon, tags: { amenity: "cafe", name: "Café Near", opening_hours: "08:00-24:00" } },
    { type: "way", center: { lat: H.lat + 0.002, lon: H.lon }, tags: { shop: "bakery", name: "Φούρνος" } },
    { type: "node", lat: H.lat + 0.001, lon: H.lon, tags: { amenity: "cafe", name: "Café Near" } },
    { type: "node", lat: H.lat + 0.05, lon: H.lon, tags: { amenity: "bar", name: "Too far" } },
    { type: "node", lat: H.lat, lon: H.lon, tags: { amenity: "bench" } },
  ] };
  const ps = parseOverpass(json, H.lat, H.lon, 1);
  assert.deepEqual(ps.map((p) => p.name), ["Café Near", "Φούρνος", "Taverna Far"]);
  assert.equal(ps[0].kind, "cafe");
  assert.equal(ps[1].kind, "bakery");
  assert.equal(ps[2].cuisine, "greek, seafood");
  const text = nearbyText(ps, 1);
  assert.match(text, /Restaurants \/ taverns: Taverna Far \(\d+ m, ~\d+ min walk, greek, seafood\)/);
  assert.match(text, /within 1 km/);
  assert.match(nearbyText([], 1), /no data/);
  assert.deepEqual(parseOverpass(null, H.lat, H.lon, 1), []);
});
