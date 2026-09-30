import assert from "node:assert/strict";
import test from "node:test";
import { requiredMinStay, type MinStayRule } from "../lib/min-stay.ts";

const r = (x: Partial<MinStayRule>): MinStayRule => ({ id: 1, room_type: null, starts_on: null, ends_on: null, min_nights: 2, active: 1, updated_at: 1, ...x });

test("no rules: 1 night", () => assert.equal(requiredMinStay([], "2026-07-10", "double"), 1));

test("all-year value per category, category beats all rooms", () => {
  const rules = [r({ id: 1, min_nights: 2 }), r({ id: 2, room_type: "Suite", min_nights: 4 })];
  assert.equal(requiredMinStay(rules, "2026-07-10", "Suite"), 4);
  assert.equal(requiredMinStay(rules, "2026-07-10", "double"), 2);
});

test("period beats all-year, judged on the check-in date; shorter period wins", () => {
  const rules = [r({ id: 1, room_type: "double", min_nights: 2 }), r({ id: 2, room_type: "double", starts_on: "2026-07-01", ends_on: "2026-08-31", min_nights: 5 }), r({ id: 3, room_type: "double", starts_on: "2026-08-10", ends_on: "2026-08-20", min_nights: 7 })];
  assert.equal(requiredMinStay(rules, "2026-06-30", "double"), 2);
  assert.equal(requiredMinStay(rules, "2026-07-01", "double"), 5);
  assert.equal(requiredMinStay(rules, "2026-08-15", "double"), 7);
  assert.equal(requiredMinStay(rules, "2026-08-31", "double"), 5);
  assert.equal(requiredMinStay([r({ min_nights: 3, active: 0 })], "2026-07-10", "double"), 1, "inactive ignored");
});
