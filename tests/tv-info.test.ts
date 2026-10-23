import assert from "node:assert/strict";
import test from "node:test";
import { defaultInfoSections, fillInfo, MAX_INFO_SECTIONS, normalizeInfoSections } from "../lib/tv-info.ts";
import { normalizeTvSettings } from "../lib/tv-core.ts";

test("welcome letter tabs are the default and every default has English and Greek", () => {
  assert.deepEqual(normalizeTvSettings({}).info.map((x) => x.key), ["checkin", "rates", "housekeeping", "wifi", "reception", "important", "checkout"]);
  for (const s of defaultInfoSections) assert.ok(s.title.en && s.title.el && s.body.en && s.body.el, s.key);
});

test("saved tabs are cleaned: limits, unique keys, an empty list stays empty", () => {
  assert.deepEqual(normalizeInfoSections([]), []);
  const many = Array.from({ length: 15 }, () => ({ key: "dup", icon: "", title: { en: "T", xx: "no" }, body: { en: "B".repeat(3000) } }));
  const out = normalizeInfoSections(many);
  assert.equal(out.length, MAX_INFO_SECTIONS);
  assert.equal(new Set(out.map((x) => x.key)).size, MAX_INFO_SECTIONS);
  assert.equal(out[0].icon, "ℹ️");
  assert.deepEqual(Object.keys(out[0].title), ["en"]);
  assert.equal(out[0].body.en?.length, 2500);
});

test("placeholders are filled from the TV settings", () => {
  assert.equal(fillInfo("In {checkIn}, out {checkOut}, {wifi} / {password}", { checkIn: "13:00", checkOut: "11:00", wifi: "Corali", password: "" }), "In 13:00, out 11:00, Corali / —");
});
