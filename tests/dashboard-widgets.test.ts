import assert from "node:assert/strict";
import test from "node:test";
import { defaultLayout, moveWidget, normalizeLayout } from "../lib/dashboard-widgets.ts";
import { amenityIcon, amenityName } from "../lib/amenity-icons.ts";

test("saved dashboard layouts are validated and completed with new widgets", () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout);
  const saved = normalizeLayout(JSON.stringify([{ id: "forecast", size: 3, hidden: false }, { id: "forecast", size: 1 }, { id: "bogus", size: 2 }, { id: "sticky_notes", size: 9, hidden: true }]));
  assert.deepEqual(saved.slice(0, 2), [{ id: "forecast", size: 3, hidden: false }, { id: "sticky_notes", size: 2, hidden: true }]);
  assert.equal(saved.length, defaultLayout.length);
  assert.equal(new Set(saved.map((w) => w.id)).size, saved.length);
  assert.deepEqual(normalizeLayout("not json"), defaultLayout);
});

test("widgets move within bounds", () => {
  const moved = moveWidget(defaultLayout, "booking_search", -1);
  assert.deepEqual(moved.slice(0, 2).map((w) => w.id), ["booking_search", "sticky_notes"]);
  assert.equal(moveWidget(defaultLayout, "sticky_notes", -1), defaultLayout);
  assert.equal(moveWidget(defaultLayout, defaultLayout.at(-1)!.id, 1), defaultLayout);
});

test("room characteristics fall back to a default icon and English/Greek names", () => {
  assert.equal(amenityIcon("wifi"), "📶");
  assert.equal(amenityIcon("unknown"), "✨");
  assert.equal(amenityName({ el: "Κλιματισμός", en: "Air conditioning", de: "Klimaanlage" }, "de"), "Klimaanlage");
  assert.equal(amenityName({ el: "Κλιματισμός", en: "Air conditioning" }, "it"), "Air conditioning");
  assert.equal(amenityName({ el: "Κλιματισμός" }, "fr"), "Κλιματισμός");
});
