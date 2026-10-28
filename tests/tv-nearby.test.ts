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
  assert.equal(clampRadiusKm(0), 2);
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
  assert.match(text, /Restaurants \/ taverns: Taverna Far \(~\d+ m straight line, ~\d+ min walk, greek, seafood\)/);
  assert.match(text, /within 1 km/);
  assert.match(nearbyText([], 1), /no data/);
  assert.deepEqual(parseOverpass(null, H.lat, H.lon, 1), []);
});

test("Google Places → places with rating, price and today's hours; no lodging, no closed", async () => {
  const { parseGooglePlaces, googleNearbyBody, lodgingTypes, mergePlaces, todayLine } = await import("../lib/tv-nearby-core.ts");
  const week = ["Δευτέρα: 12:00–23:30", "Τρίτη: 12:00–23:30", "Τετάρτη: Κλειστά", "Πέμπτη: 12:00–23:30", "Παρασκευή: 12:00–01:00", "Σάββατο: 12:00–01:00", "Κυριακή: 13:00–23:00"];
  const json = { places: [
    { displayName: { text: "Ταβέρνα Θάλασσα" }, location: { latitude: H.lat + 0.002, longitude: H.lon }, primaryType: "greek_restaurant", types: ["greek_restaurant", "restaurant"], rating: 4.7, userRatingCount: 812, priceLevel: "PRICE_LEVEL_MODERATE", regularOpeningHours: { weekdayDescriptions: week }, businessStatus: "OPERATIONAL" },
    { displayName: { text: "Corali Rival Hotel Restaurant" }, location: { latitude: H.lat + 0.001, longitude: H.lon }, primaryType: "restaurant", types: ["restaurant", "lodging"], businessStatus: "OPERATIONAL" },
    { displayName: { text: "Closed Grill" }, location: { latitude: H.lat + 0.001, longitude: H.lon }, primaryType: "restaurant", businessStatus: "CLOSED_PERMANENTLY" },
  ] };
  const ps = parseGooglePlaces(json, "restaurant", H.lat, H.lon, 1, 5); // Friday
  assert.equal(ps.length, 1);
  assert.equal(ps[0].rating, 4.7);
  assert.equal(ps[0].price, "€€");
  assert.equal(ps[0].hours, "12:00–01:00");
  assert.equal(todayLine(week, 0), "13:00–23:00"); // Sunday
  const body = googleNearbyBody(["cafe"], H.lat, H.lon, 1);
  assert.deepEqual(body.excludedTypes, lodgingTypes);
  assert.equal(body.locationRestriction.circle.radius, 1000);
  assert.equal(mergePlaces([[{ ...ps[0] }], [{ ...ps[0], kind: "bar" }]]).length, 1);
  assert.match(nearbyText(ps, 1, 12, "google"), /Google Maps.*\n.*★4\.7 \(812 reviews\), €€/);
});

test("other accommodation and the hotel's hide list are filtered (both sources)", async () => {
  const { filterPlaces, hideList, looksLikeLodging } = await import("../lib/tv-nearby-core.ts");
  for (const n of ["Hotel Kalypso", "Maria Rooms", "Anna Studios", "Villa Thea", "Ενοικιαζόμενα Δωμάτια Ελένη", "Ξενοδοχείο Αστέρι", "Sunset Apartments", "Pension Irini"]) assert.equal(looksLikeLodging(n), true, n);
  for (const n of ["Ταβέρνα Θάλασσα", "Café Roomba", "Studiolo Pizza"]) assert.equal(looksLikeLodging(n), false, n);
  const p = (name: string) => ({ name, kind: "restaurant" as const, meters: 100, walkMin: 2, cuisine: "", hours: "" });
  assert.deepEqual(filterPlaces([p("Ταβέρνα Α"), p("Maria Rooms"), p("Bar Κακό")], hideList("κακό, , x")).map((x) => x.name), ["Ταβέρνα Α"]);
  const osm = parseOverpass({ elements: [{ type: "node", lat: H.lat, lon: H.lon, tags: { amenity: "restaurant", tourism: "hotel", name: "Hotel Restaurant" } }] }, H.lat, H.lon, 1);
  assert.equal(osm.length, 0);
});

test("Google places carry map point, address, website, Maps link and the week; today's hours follow the day", async () => {
  const { parseGooglePlaces, withToday, googleGroups } = await import("../lib/tv-nearby-core.ts");
  const week = ["Δευτέρα: 09:00–21:00", "Τρίτη: 09:00–21:00", "Τετάρτη: 09:00–21:00", "Πέμπτη: 09:00–21:00", "Παρασκευή: 09:00–21:00", "Σάββατο: 10:00–14:00", "Κυριακή: Κλειστά"];
  const [p] = parseGooglePlaces({ places: [{ id: "abc", displayName: { text: "Φαρμακείο Πίσω Λιβαδιού" }, location: { latitude: H.lat + 0.002, longitude: H.lon }, primaryType: "pharmacy", types: ["pharmacy"], formattedAddress: "Πίσω Λιβάδι 844 00, Ελλάδα", websiteUri: "https://pharmacy.example", googleMapsUri: "https://maps.google.com/?cid=1", nationalPhoneNumber: "22840 41234", regularOpeningHours: { weekdayDescriptions: week }, businessStatus: "OPERATIONAL" }] }, "pharmacy", H.lat, H.lon, 2, 1);
  assert.equal(p.address, "Πίσω Λιβάδι 844 00");
  assert.equal(p.website, "https://pharmacy.example");
  assert.equal(p.mapsUrl, "https://maps.google.com/?cid=1");
  assert.equal(p.lat, H.lat + 0.002);
  assert.equal(p.hours, "09:00–21:00");
  assert.equal(withToday([p], 0)[0].hours, "Κλειστά");
  assert.equal(withToday([p], 6)[0].hours, "10:00–14:00");
  assert.equal(googleGroups.length, 12);
  assert.ok(googleGroups.some((g) => g.kind === "car_rental") && googleGroups.some((g) => g.kind === "health"));
});

test("walking-route places are told as routes, others as straight line", async () => {
  const p = { name: "Souvlaki Tzanis", kind: "fast_food" as const, cuisine: "", hours: "" };
  const t = nearbyText([{ ...p, meters: 980, walkMin: 13, routed: true }, { ...p, name: "Other", meters: 300, walkMin: 5 }], 2);
  assert.match(t, /Souvlaki Tzanis \(980 m walking route, 13 min on foot/);
  assert.match(t, /Other \(~300 m straight line, ~5 min walk/);
  assert.match(t, /always say both the distance and the walking time/);
});

test("map cards: places and beaches named in the reply, in order, without accents / case trouble", async () => {
  const { mentionedSpots, directionsUrl } = await import("../lib/tv-nearby-core.ts");
  const s = (name: string) => ({ name, icon: "📍", lat: 37, lon: 25, line: "", directions: directionsUrl({ lat: 37.04, lon: 25.25 }, { lat: 37, lon: 25 }, true) });
  const spots = [s("Ταβέρνα Θάλασσα"), s("Πούντα (μετά τον Λογαρά)"), s("Λογαράς"), s("Bar"), s("Café Λιμάνι")];
  const got = mentionedSpots("Σήμερα προτείνω τον ΛΟΓΑΡΑΣ και την πουντα, μετά φαγητό στην ταβερνα θαλασσα.", spots);
  assert.deepEqual(got.map((x) => x.name), ["Λογαράς", "Πούντα (μετά τον Λογαρά)", "Ταβέρνα Θάλασσα"]);
  assert.equal(mentionedSpots("ένα Bar εδώ", spots).length, 0); // names under 4 letters are ignored
  assert.equal(mentionedSpots("Café Λιμάνι, Λογαράς, Πούντα, Ταβέρνα Θάλασσα", spots, 2).length, 2);
  assert.match(spots[0].directions, /travelmode=walking$/);
});
