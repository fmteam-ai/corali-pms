import assert from "node:assert/strict";
import test from "node:test";
import { beachesForWind, compass, defaultBeaches, normalizeBeaches, windyDay } from "../lib/tv-beaches.ts";
import { normalizeTvSettings } from "../lib/tv-core.ts";

test("wind degrees become one of 8 directions", () => {
  assert.equal(compass(0), "N");
  assert.equal(compass(350), "N");
  assert.equal(compass(23), "NE");
  assert.equal(compass(45), "NE");
  assert.equal(compass(180), "S");
  assert.equal(compass(-45), "NW");
  assert.equal(compass(315), "NW");
});

test("on a north wind the sheltered beaches come first, nearest first", () => {
  const r = beachesForWind(defaultBeaches, "N");
  assert.ok(r.sheltered.length > 0 && r.exposed.length > 0);
  assert.ok(r.sheltered.every((b) => b.sheltered.includes("N")));
  assert.ok(r.exposed.some((b) => b.name === "Χρυσή Ακτή"));
  assert.deepEqual(r.sheltered.map((b) => b.minutes), [...r.sheltered.map((b) => b.minutes)].sort((a, b) => a - b));
  assert.equal(windyDay(5), true);
  assert.equal(windyDay(3), false);
});

test("the hotel's beach list is cleaned; missing list → defaults", () => {
  assert.equal(normalizeTvSettings({}).beaches.length, defaultBeaches.length);
  const b = normalizeBeaches([{ name: "  Λογαράς ", minutes: 5.4, sheltered: ["N", "X", "NW"], note: "ok" }, { name: "" }]);
  assert.deepEqual(b, [{ name: "Λογαράς", minutes: 5, km: 1, sheltered: ["N", "NW"], note: "ok" }]);
  assert.deepEqual(normalizeBeaches([]), []);
});

test("the rest of Paros can be added without duplicates; beach mode defaults to all", async () => {
  const { missingParosBeaches, parosBeaches, MAX_BEACHES } = await import("../lib/tv-beaches.ts");
  const added = missingParosBeaches([{ name: "Λογαράς", minutes: 5, km: 1, sheltered: ["N"], note: "" }]);
  assert.equal(added.some((b) => b.name === "Λογαράς"), false);
  assert.equal(added.length, defaultBeaches.length - 1 + parosBeaches.length);
  assert.ok(defaultBeaches.length + parosBeaches.length <= MAX_BEACHES);
  assert.equal(missingParosBeaches(added.concat([{ name: "λογαράς", minutes: 5, km: 1, sheltered: [], note: "" }])).length, 0);
  assert.equal(normalizeTvSettings({}).beachMode, "all");
  assert.equal(normalizeTvSettings({ beachMode: "near" }).beachMode, "near");
});

test("a saved list without km takes the indicative distance of known beaches", () => {
  assert.equal(normalizeBeaches([{ name: "Λογαράς", minutes: 5, sheltered: ["N"] }])[0].km, 1);
  assert.equal(normalizeBeaches([{ name: "Άγνωστη", minutes: 5, sheltered: [] }])[0].km, 0);
  assert.equal(normalizeBeaches([{ name: "Λογαράς", minutes: 5, km: 1.5, sheltered: [] }])[0].km, 1.5);
});
