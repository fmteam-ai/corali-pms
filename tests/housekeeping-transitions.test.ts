import assert from "node:assert/strict";
import test from "node:test";
import { checklistLabels, checklistProgress, housekeepingChecklist, nextHousekeepingStatus, roomStatusAfter, validChecklist, validHousekeepingTransition } from "../lib/housekeeping.ts";

test("housekeeping only follows the cleaning and second-review sequence", () => {
  assert.equal(validHousekeepingTransition("todo", "complete"), false);
  assert.equal(validHousekeepingTransition("todo", "approve"), false);
  assert.equal(validHousekeepingTransition("todo", "start"), true);
  assert.equal(validHousekeepingTransition("in_progress", "complete"), true);
  assert.equal(validHousekeepingTransition("cleaned", "approve"), true);
  assert.equal(validHousekeepingTransition("ready", "reject"), false);
  assert.equal(validHousekeepingTransition("in_progress", "report_issue"), true);
});

test("severe damage needs a repair and a second sign-off to return to service", () => {
  assert.equal(nextHousekeepingStatus("in_progress", "report_issue", true), "out_of_order");
  assert.equal(roomStatusAfter("in_progress", "report_issue", true), "out_of_order");
  assert.equal(nextHousekeepingStatus("in_progress", "report_issue", false), "in_progress");
  assert.equal(roomStatusAfter("in_progress", "report_issue", false), null);
  assert.equal(validHousekeepingTransition("out_of_order", "approve"), false, "no direct approval of an out-of-order room");
  assert.equal(validHousekeepingTransition("out_of_order", "start"), false);
  assert.equal(validHousekeepingTransition("out_of_order", "repair_done"), true);
  assert.equal(nextHousekeepingStatus("out_of_order", "repair_done"), "repaired");
  assert.equal(validHousekeepingTransition("repaired", "approve"), true);
  assert.equal(nextHousekeepingStatus("repaired", "approve"), "ready");
  assert.equal(roomStatusAfter("repaired", "approve"), "dirty");
  assert.equal(nextHousekeepingStatus("repaired", "reject"), "out_of_order");
  assert.equal(roomStatusAfter("cleaned", "approve"), "clean");
  assert.equal(nextHousekeepingStatus("cleaned", "reject"), "in_progress");
});

test("the checklist has the twelve specified points in both languages", () => {
  assert.equal(housekeepingChecklist.length, 12);
  for (const lang of ["el", "en"] as const) assert.deepEqual(Object.keys(checklistLabels[lang]), [...housekeepingChecklist]);
  const all = Object.fromEntries(housekeepingChecklist.map((k) => [k, true]));
  assert.equal(validChecklist(all), true);
  assert.equal(validChecklist({ ...all, tv: false }), false);
  assert.equal(checklistProgress({ bed_linens: true, tv: true, unknown: true }), 2);
});
