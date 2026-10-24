import assert from "node:assert/strict";
import test from "node:test";
import { athensTime, messageExpiry, messageText } from "../lib/tv-messages-core.ts";

test("Athens wall-clock time in summer and winter", () => {
  assert.equal(new Date(athensTime("2026-07-15", "11:00")).toISOString(), "2026-07-15T08:00:00.000Z");
  assert.equal(new Date(athensTime("2026-12-15", "11:00")).toISOString(), "2026-12-15T09:00:00.000Z");
});

test("TV message expiry", () => {
  const now = Date.parse("2026-07-15T07:00:00Z"); // 10:00 in Athens
  assert.equal(messageExpiry("1h", now, "2026-07-15", null, "11:00"), now + 3_600_000);
  assert.equal(messageExpiry("3h", now, "2026-07-15", null, "11:00"), now + 3 * 3_600_000);
  assert.equal(new Date(messageExpiry("tonight", now, "2026-07-15", null, "11:00")).toISOString(), "2026-07-15T20:59:00.000Z");
  assert.equal(new Date(messageExpiry("checkout", now, "2026-07-15", "2026-07-18", "11:00")).toISOString(), "2026-07-18T08:00:00.000Z");
  assert.equal(messageExpiry("checkout", now, "2026-07-15", null, "11:00"), messageExpiry("tonight", now, "2026-07-15", null, "11:00"), "empty room: until tonight");
  assert.equal(messageExpiry("checkout", now, "2026-07-15", "2027-07-18", "11:00"), now + 30 * 86_400_000, "capped at 30 days");
});

test("TV message language", () => {
  assert.equal(messageText({ el: "Γεια", en: "Hello" }, "el"), "Γεια");
  assert.equal(messageText({ el: "Γεια", en: "Hello" }, "de"), "Hello");
  assert.equal(messageText({ el: "Γεια" }, "fr"), "Γεια");
  assert.equal(messageText({ en: "Hello" }, "el"), "Hello");
});
