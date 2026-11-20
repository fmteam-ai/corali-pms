import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeInfoSections } from "../lib/tv-info.ts";

test("«Important information» becomes «Information»; a title the hotel changed stays", () => {
  const saved = normalizeInfoSections([{ key: "important", icon: "❗", title: { en: "Important information", el: "Σημαντικές πληροφορίες" }, body: { en: "x" } }]);
  assert.equal(saved[0].title.en, "Information");
  assert.equal(saved[0].title.el, "Πληροφορίες");
  const own = normalizeInfoSections([{ key: "important", icon: "❗", title: { en: "House rules" }, body: { en: "x" } }]);
  assert.equal(own[0].title.en, "House rules");
});
