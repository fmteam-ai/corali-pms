import assert from "node:assert/strict";
import test from "node:test";
import { addDays, barSpan, hasUnpaidBalance, heldRoomIds, hotelToday, housekeepingState, isIsoDate, tapeStatus, tapeStatusColors } from "../lib/tape-chart.ts";

test("reservation colours follow the specification", () => {
  const today = "2026-09-29";
  assert.equal(tapeStatus("confirmed", "2026-10-02", today), "confirmed");
  assert.equal(tapeStatus("confirmed", today, today), "check_in_due");
  assert.equal(tapeStatus("confirmed", "2026-09-27", today), "check_in_due");
  assert.equal(tapeStatus("checked_in", "2026-09-27", today), "checked_in");
  assert.equal(tapeStatus("checked_out", "2026-09-20", today), "checked_out");
  assert.equal(tapeStatus("cancelled", "2026-10-02", today), "cancelled");
  assert.equal(tapeStatus("no_show", "2026-09-20", today), "cancelled");
  assert.equal(tapeStatus("payment_pending", "2026-10-02", today), "tentative");
  assert.deepEqual(tapeStatusColors, { confirmed: "#2196F3", check_in_due: "#FF9800", checked_in: "#4CAF50", checked_out: "#9E9E9E", cancelled: "#F44336", tentative: "#9C27B0" });
});

test("unpaid balance alert ignores cancelled stays", () => {
  assert.equal(hasUnpaidBalance("confirmed", 5000), true);
  assert.equal(hasUnpaidBalance("checked_out", 1), true);
  assert.equal(hasUnpaidBalance("confirmed", 0), false);
  assert.equal(hasUnpaidBalance("cancelled", 5000), false);
});

test("housekeeping overlay derives the five room states", () => {
  assert.equal(housekeepingState("available", null), "clean");
  assert.equal(housekeepingState("clean", null), "clean");
  assert.equal(housekeepingState("dirty", null), "dirty");
  assert.equal(housekeepingState("available", "todo"), "dirty");
  assert.equal(housekeepingState("dirty", "in_progress"), "cleaning");
  assert.equal(housekeepingState("dirty", "cleaned"), "inspection_pending");
  assert.equal(housekeepingState("out_of_order", "todo"), "out_of_order");
  assert.equal(housekeepingState("available", "out_of_order"), "out_of_order");
});

test("bars are clipped to the visible window", () => {
  const start = "2026-09-29";
  assert.deepEqual(barSpan("2026-09-29", "2026-10-02", start, 31), { offset: 0, length: 3, clippedStart: false, clippedEnd: false });
  assert.deepEqual(barSpan("2026-09-25", "2026-10-01", start, 31), { offset: 0, length: 2, clippedStart: true, clippedEnd: false });
  assert.deepEqual(barSpan("2026-10-28", "2026-11-05", start, 31), { offset: 29, length: 2, clippedStart: false, clippedEnd: true });
  assert.equal(barSpan("2026-09-20", "2026-09-29", start, 31), null);
  assert.equal(barSpan("2026-10-30", "2026-11-02", start, 31), null);
});

test("date helpers", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("29/09/2026"), false);
  assert.equal(hotelToday(new Date("2026-09-29T21:30:00Z")), "2026-09-30");
  assert.equal(hotelToday(new Date("2026-01-15T21:30:00Z")), "2026-01-15");
});

test("held room ids tolerate legacy JSON", () => {
  assert.deepEqual(heldRoomIds("[3,5]"), [3, 5]);
  assert.deepEqual(heldRoomIds([{ roomId: 7 }]), [7]);
  assert.deepEqual(heldRoomIds("null"), []);
  assert.deepEqual(heldRoomIds("not json"), []);
  assert.deepEqual(heldRoomIds(["x", -1, 0]), []);
});
