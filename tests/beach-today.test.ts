import { test } from "node:test";
import assert from "node:assert/strict";
import { beachesToday, beachTodayTexts, defaultBeaches } from "../lib/tv-beaches.ts";

test("beaches today: on a meltemi day (≥5 Bf from the north) the nearest beaches sheltered from the north", () => {
  const r = beachesToday(defaultBeaches, 6, 0);
  assert.equal(r.windy, true);
  assert.equal(r.dir, "N");
  assert.equal(r.beaches.length, 3);
  assert.ok(r.beaches.every((b) => b.sheltered.includes("N")));
  assert.ok(!r.beaches.some((b) => b.name === "Χρυσή Ακτή"));
  assert.deepEqual(r.beaches.map((b) => b.minutes), [...r.beaches.map((b) => b.minutes)].sort((a, b) => a - b));
});

test("beaches today: light wind → the three nearest; no direction → not windy; «near» keeps sheltered beaches within 30′", () => {
  const calm = beachesToday(defaultBeaches, 3, 0);
  assert.equal(calm.windy, false);
  assert.deepEqual(calm.beaches.map((b) => b.name), ["Λογαράς", "Πίσω Λιβάδι", "Πούντα (μετά τον Λογαρά)"]);
  assert.equal(beachesToday(defaultBeaches, 7, null).windy, false);
  assert.ok(beachesToday(defaultBeaches, 6, 0, "near").beaches.every((b) => b.minutes <= 30));
  for (const l of ["el", "en", "fr", "de", "it", "es"] as const) assert.match(beachTodayTexts[l].windy, /\{b\}.*\{dir\}/);
});

test("beach names for guests who do not read Greek: Latin letters, bracketed note left out", async () => {
  const { beachName } = await import("../lib/tv-beaches.ts");
  assert.equal(beachName("Πίσω Λιβάδι", "en"), "Piso Livadi");
  assert.equal(beachName("Λογαράς", "de"), "Logaras");
  assert.equal(beachName("Πούντα (μετά τον Λογαρά)", "en"), "Pounta");
  assert.equal(beachName("Χρυσή Ακτή", "fr"), "Chrysi Akti");
  assert.equal(beachName("Κολυμπήθρες", "it"), "Kolympithres");
  assert.equal(beachName("Φάραγγας", "es"), "Farangas");
  assert.equal(beachName("Πίσω Λιβάδι", "el"), "Πίσω Λιβάδι");
  assert.equal(beachName("Golden Beach", "en"), "Golden Beach");
});
