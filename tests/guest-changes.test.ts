import assert from "node:assert/strict";
import test from "node:test";
import { guestChangePolicy, validNewStay } from "../lib/guest-changes.ts";

const base = { status: "confirmed", checkIn: "2026-10-20", today: "2026-10-01", ratePlanKey: "flexible", cancellationDays: 7, totalCents: 50000, balanceCents: 35000 };

test("refundable rate before the deadline: free cancellation with refund of what was paid, dates can change", () => {
  const p = guestChangePolicy(base);
  assert.equal(p.deadline, "2026-10-13");
  assert.deepEqual([p.freeCancellation, p.refundCents, p.canChangeDates, p.canCancel], [true, 15000, true, true]);
  assert.equal(guestChangePolicy({ ...base, today: "2026-10-13" }).freeCancellation, true, "deadline day still free");
});

test("after the deadline or non-refundable: cancel without refund, no online date change", () => {
  const late = guestChangePolicy({ ...base, today: "2026-10-14" });
  assert.deepEqual([late.freeCancellation, late.refundCents, late.canChangeDates, late.canCancel], [false, 0, false, true]);
  const nr = guestChangePolicy({ ...base, ratePlanKey: "non_refundable", balanceCents: 0 });
  assert.deepEqual([nr.nonRefundable, nr.refundCents, nr.canChangeDates, nr.paidCents], [true, 0, false, 50000]);
});

test("cancelled, checked-in or past bookings cannot be changed online", () => {
  assert.equal(guestChangePolicy({ ...base, status: "cancelled" }).blocked, "not_confirmed");
  assert.equal(guestChangePolicy({ ...base, today: "2026-10-21" }).blocked, "arrival_passed");
  assert.equal(guestChangePolicy({ ...base, status: "checked_in" }).canCancel, false);
});

test("new stay validation", () => {
  assert.equal(validNewStay("2026-10-21", "2026-10-25", "2026-10-01"), true);
  assert.equal(validNewStay("2026-09-30", "2026-10-02", "2026-10-01"), false);
  assert.equal(validNewStay("2026-10-21", "2026-10-21", "2026-10-01"), false);
  assert.equal(validNewStay("2026-10-01", "2026-11-15", "2026-10-01"), false);
});
