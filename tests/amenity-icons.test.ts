import assert from "node:assert/strict";
import test from "node:test";
import { amenityDefaults, amenityIcons, standardAmenities } from "../lib/amenity-icons.ts";

test("every icon except the generic one has a default name in all six languages", () => {
  for (const key of Object.keys(amenityIcons)) {
    if (key === "sparkles") continue;
    const names = amenityDefaults[key];
    assert.ok(names, key);
    for (const lang of ["el", "en", "fr", "de", "it", "es"] as const) assert.ok(names[lang].trim().length >= 2, `${key}.${lang}`);
  }
  for (const key of standardAmenities) assert.ok(amenityIcons[key], key);
});
