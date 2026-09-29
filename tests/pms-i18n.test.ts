import assert from "node:assert/strict";
import test from "node:test";
import { normalizePmsLang, pmsDictionaries, pmsStatus, pmsT } from "../lib/pms-i18n.ts";

test("every PMS key has a non-empty Greek and English text with the same placeholders", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const [key, greek] of Object.entries(pmsDictionaries.el)) {
    const english = pmsDictionaries.en[key as keyof typeof pmsDictionaries.en];
    assert.ok(greek.trim() && english?.trim(), key);
    assert.equal(placeholders(english), placeholders(greek), key);
  }
  assert.deepEqual(Object.keys(pmsDictionaries.en).sort(), Object.keys(pmsDictionaries.el).sort());
});

test("translator interpolates and falls back safely", () => {
  assert.equal(pmsT("en")("dash.welcome", { name: "Maria" }), "Welcome, Maria.");
  assert.equal(pmsT("el")("dash.welcome", { name: "Μαρία" }), "Καλώς ήρθατε, Μαρία.");
  assert.equal(pmsT("en")("dash.welcome"), "Welcome, {name}.");
  assert.equal(normalizePmsLang("en"), "en");
  assert.equal(normalizePmsLang("fr"), "el");
  assert.equal(normalizePmsLang(undefined), "el");
  assert.equal(pmsStatus("en", "checked_in"), "Checked in");
  assert.equal(pmsStatus("en", "legacy_state"), "legacy_state");
});
