import assert from "node:assert/strict";
import test from "node:test";
import { nightlyPrice, seasonRuleFor, type SeasonRule } from "../lib/season-rates.ts";

const rule = (x: Partial<SeasonRule>): SeasonRule => ({ id: 1, room_type: null, room_codes: "[]", weekdays: "[]", starts_on: "2026-07-01", ends_on: "2026-08-31", price_cents: 15000, active: 1, updated_at: 1, ...x });

test("base rate outside any season", () => {
  assert.equal(nightlyPrice([rule({})], "2026-06-30", "Double", "101", 9000), 9000);
});

test("most specific target wins: rooms > type > all", () => {
  const rules = [rule({ id: 1, price_cents: 15000 }), rule({ id: 2, room_type: "Double", price_cents: 16000 }), rule({ id: 3, room_codes: '["101"]', price_cents: 20000 })];
  assert.equal(nightlyPrice(rules, "2026-07-10", "Double", "101", 9000), 20000);
  assert.equal(nightlyPrice(rules, "2026-07-10", "Double", "102", 9000), 16000);
  assert.equal(nightlyPrice(rules, "2026-07-10", "Suite", "201", 9000), 15000);
  assert.equal(nightlyPrice(rules, "2026-07-10", "Double", null, 9000), 16000, "room-type overview ignores single-room prices");
});

test("shorter period wins over a longer one at the same level; weekdays and inactive respected", () => {
  const rules = [rule({ id: 1, price_cents: 15000 }), rule({ id: 2, starts_on: "2026-08-10", ends_on: "2026-08-20", price_cents: 22000 })];
  assert.equal(nightlyPrice(rules, "2026-08-15", "Double", "101", 9000), 22000);
  assert.equal(nightlyPrice(rules, "2026-08-21", "Double", "101", 9000), 15000);
  // 2026-07-04 is a Saturday.
  const weekend = [rule({ id: 1, price_cents: 15000 }), rule({ id: 2, weekdays: "[5,6]", price_cents: 18000, starts_on: "2026-07-01", ends_on: "2026-07-31" })];
  assert.equal(nightlyPrice(weekend, "2026-07-04", "Double", "101", 9000), 18000);
  assert.equal(nightlyPrice(weekend, "2026-07-06", "Double", "101", 9000), 15000);
  assert.equal(seasonRuleFor([rule({ active: 0 })], "2026-07-10", "Double", "101"), null);
  assert.equal(seasonRuleFor([rule({ price_cents: null })], "2026-07-10", "Double", "101"), null, "restriction-only rows carry no price");
});

test("latest edit wins on a tie", () => {
  const rules = [rule({ id: 1, price_cents: 15000, updated_at: 5 }), rule({ id: 2, price_cents: 17000, updated_at: 9 })];
  assert.equal(nightlyPrice(rules, "2026-07-10", "Double", "101", 9000), 17000);
});
