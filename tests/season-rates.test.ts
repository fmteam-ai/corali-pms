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

test("bulk price update: the new price is final for those nights; older rules are kept around it", async () => {
  const { bulkPricePlan } = await import("../lib/season-rates.ts");
  const rooms: Record<string, string> = { "101": "Double", "102": "Double", "201": "Suite" };
  const existing: SeasonRule[] = [
    { id: 1, room_type: "Double", room_codes: "[]", weekdays: "[]", starts_on: "2026-05-01", ends_on: "2026-09-30", price_cents: 10000, active: 1, updated_at: 1 },
    { id: 2, room_type: "Double", room_codes: "[]", weekdays: "[]", starts_on: "2026-08-01", ends_on: "2026-08-31", price_cents: 15000, active: 1, updated_at: 1 },
    { id: 3, room_type: null, room_codes: '["101","201"]', weekdays: "[]", starts_on: "2026-07-01", ends_on: "2026-07-31", price_cents: 13000, active: 1, updated_at: 1 },
    { id: 4, room_type: "Suite", room_codes: "[]", weekdays: "[]", starts_on: "2026-01-01", ends_on: "2026-12-31", price_cents: 30000, active: 1, updated_at: 1 },
  ];
  const plan = bulkPricePlan(existing, { roomTypes: ["Double"], roomCodes: [], codesOfTypes: ["101", "102"] }, "2026-07-15", "2026-08-15", [], 12000, "Bulk");
  assert.deepEqual(plan.deleteIds.sort(), [1, 2, 3]);
  const after: SeasonRule[] = [...existing.filter((r) => !plan.deleteIds.includes(Number(r.id))), ...plan.inserts.map((r, i) => ({ ...r, id: 100 + i, room_codes: JSON.stringify(r.room_codes), weekdays: JSON.stringify(r.weekdays), updated_at: 2 }))];
  const price = (date: string, code: string) => nightlyPrice(after, date, rooms[code], code, 5000);
  assert.equal(price("2026-07-20", "101"), 12000, "room rule of the category is overridden");
  assert.equal(price("2026-08-10", "102"), 12000, "shorter August rule is overridden inside the period");
  assert.equal(price("2026-08-20", "102"), 15000, "August rule kept after the period");
  assert.equal(price("2026-07-10", "101"), 13000, "room rule kept before the period");
  assert.equal(price("2026-07-20", "201"), 13000, "other rooms of a split room rule keep it");
  assert.equal(price("2026-06-01", "102"), 10000);
  assert.equal(price("2026-07-20", "201") , 13000);
  // Only weekends: weekdays keep the old price.
  const wk = bulkPricePlan(existing.slice(0, 1), { roomTypes: ["Double"], roomCodes: [], codesOfTypes: ["101", "102"] }, "2026-06-01", "2026-06-30", [5, 6], 14000, "Weekends");
  const after2: SeasonRule[] = wk.inserts.map((r, i) => ({ ...r, id: 200 + i, room_codes: JSON.stringify(r.room_codes), weekdays: JSON.stringify(r.weekdays), updated_at: 2 }));
  assert.equal(nightlyPrice(after2, "2026-06-05", "Double", "101", 5000), 14000, "Friday");
  assert.equal(nightlyPrice(after2, "2026-06-03", "Double", "101", 5000), 10000, "Wednesday keeps the old price");
  assert.equal(nightlyPrice(after2, "2026-07-03", "Double", "101", 5000), 10000, "after the period");
});
