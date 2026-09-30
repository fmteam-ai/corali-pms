import assert from "node:assert/strict";
import test from "node:test";
import { splitGuestName, splitPhone } from "../lib/checkin-prefill.ts";

test("guest name splits into first and last", () => {
  assert.deepEqual(splitGuestName("Anna Maria Müller"), { firstName: "Anna Maria", lastName: "Müller" });
  assert.deepEqual(splitGuestName("  Γιώργος  "), { firstName: "Γιώργος", lastName: "" });
});

test("international phone splits into country and local number", () => {
  assert.deepEqual(splitPhone("+49 170 1234567"), { country: "DE", local: "170 1234567" });
  assert.deepEqual(splitPhone("+30 6912345678"), { country: "GR", local: "6912345678" });
  assert.deepEqual(splitPhone("0044 7700 900123"), { country: "GB", local: "7700 900123" });
  assert.equal(splitPhone("+1 416 555 0100", "CA").country, "CA");
  assert.deepEqual(splitPhone("6912345678", "GR"), { country: "GR", local: "6912345678" });
});

test("shared calling codes fall back to the main country", () => {
  assert.equal(splitPhone("+1 212 555 0100").country, "US");
  assert.equal(splitPhone("+44 7700 900123").country, "GB");
  assert.equal(splitPhone("+7 912 345 6789").country, "RU");
});
