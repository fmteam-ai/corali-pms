import assert from "node:assert/strict";
import test from "node:test";
import { addDaysIso, defaultAlertKinds, isDesk, mondayOf, normalizeAlertKinds, normalizeModules, roleModules, shiftMinutes, shiftsOverlap, userModules, validTime, weekDays } from "../lib/staff-core.ts";

test("app sections come from the role plus the person's specialties", () => {
  assert.deepEqual(roleModules("housekeeping"), ["housekeeping"]);
  assert.deepEqual(roleModules("staff"), []);
  assert.deepEqual(userModules("staff", ['["maintenance","bogus"]', ["housekeeping"]]), ["housekeeping", "maintenance"]);
  assert.deepEqual(userModules("reception", []), ["housekeeping", "reception", "maintenance"]);
  assert.deepEqual(normalizeModules("not json"), []);
  assert.equal(isDesk("admin"), true);
  assert.equal(isDesk("staff"), false);
});

test("default phone alerts follow what the person does", () => {
  assert.deepEqual(defaultAlertKinds("staff", []), ["message", "shift"]);
  assert.deepEqual(defaultAlertKinds("housekeeping", ["housekeeping"]), ["message", "shift", "checkout", "assignment"]);
  assert.ok(defaultAlertKinds("reception", userModules("reception", [])).includes("tv_request"));
  assert.deepEqual(normalizeAlertKinds(["shift", "nope", "tv_request"]), ["shift", "tv_request"]);
});

test("shift times, overnight shifts and overlaps", () => {
  assert.equal(validTime("07:00"), true);
  assert.equal(validTime("24:00"), false);
  assert.equal(shiftMinutes("07:00", "15:00"), 480);
  assert.equal(shiftMinutes("23:00", "07:00"), 480);
  assert.equal(shiftMinutes("09:00", "09:00"), 0);
  assert.equal(shiftsOverlap({ start: "07:00", end: "15:00" }, { start: "15:00", end: "23:00" }), false);
  assert.equal(shiftsOverlap({ start: "07:00", end: "15:00" }, { start: "14:00", end: "18:00" }), true);
  assert.equal(shiftsOverlap({ start: "22:00", end: "06:00" }, { start: "23:00", end: "23:30" }), true);
});

test("weeks run Monday to Sunday", () => {
  assert.equal(mondayOf("2026-10-26"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(addDaysIso("2026-10-31", 1), "2026-11-01");
  assert.deepEqual(weekDays("2026-10-26").slice(-1), ["2026-11-01"]);
});
