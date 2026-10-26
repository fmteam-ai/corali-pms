import assert from "node:assert/strict";
import test from "node:test";
import { emptyPrefs, hasPrefs, mergePrefs, normalizePrefs, prefLines } from "../lib/guest-prefs-core.ts";

test("preferences are cleaned: only known choices, valid times, short texts", () => {
  const p = normalizePrefs('{"pillow":"firm","bed":"king","arrivalTime":"25:00","drink":"  Assyrtiko   Santorini ","extraPillows":true,"babyCot":"yes"}');
  assert.equal(p.pillow, "firm");
  assert.equal(p.bed, "");
  assert.equal(p.arrivalTime, "");
  assert.equal(p.drink, "Assyrtiko Santorini");
  assert.equal(p.extraPillows, true);
  assert.equal(p.babyCot, false);
  assert.deepEqual(normalizePrefs("not json"), emptyPrefs);
  assert.equal(hasPrefs(emptyPrefs), false);
});

test("automatic capture adds to what is known and never erases it", () => {
  const old = normalizePrefs({ pillow: "soft", drink: "Malagousia" });
  const next = mergePrefs(old, { extraBlankets: true, pillow: "", arrivalTime: "15:30" });
  assert.equal(next.pillow, "soft");
  assert.equal(next.extraBlankets, true);
  assert.equal(next.arrivalTime, "15:30");
  assert.equal(next.drink, "Malagousia");
});

test("lines for staff: housekeeping sees only what prepares the room", () => {
  const p = normalizePrefs({ pillow: "hypoallergenic", floor: "quiet", babyCot: true, drink: "Ouzo", arrivalTime: "14:00" });
  assert.deepEqual(prefLines(p, "el", { allergies: "γύρη" }, true), ["Αντιαλλεργικό μαξιλάρι", "Παιδικό κρεβάτι", "⚠ Αλλεργίες: γύρη"]);
  assert.deepEqual(prefLines(p, "en", { dietary: "vegan" }), ["Hypoallergenic pillow", "Baby cot", "Quiet room", "Arrives 14:00", "Favourite drink: Ouzo", "Diet: vegan"]);
});
