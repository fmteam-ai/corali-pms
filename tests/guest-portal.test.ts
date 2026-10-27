import assert from "node:assert/strict";
import test from "node:test";
import { announcementVisible, appointmentSlots, endTime, guestCanCancel, isOpen, pick, portalTexts, slotFree, stayDays } from "../lib/guest-portal-core.ts";

test("guest portal: opening hours, also past midnight", () => {
  assert.equal(isOpen("10:00", "23:00", "09:59"), false);
  assert.equal(isOpen("10:00", "23:00", "10:00"), true);
  assert.equal(isOpen("10:00", "23:00", "23:00"), false);
  assert.equal(isOpen("18:00", "02:00", "01:30"), true);
  assert.equal(isOpen("18:00", "02:00", "12:00"), false);
  assert.equal(isOpen("00:00", "00:00", "04:00"), true);
});

test("guest portal: appointment slots fit the hours and respect capacity", () => {
  assert.deepEqual(appointmentSlots("10:00", "12:00", 60), ["10:00", "10:30", "11:00"]);
  assert.deepEqual(appointmentSlots("10:15", "11:30", 30), ["10:30", "11:00"]);
  assert.equal(endTime("10:30", 50), "11:20");
  const booked = [{ start: "10:00", end: "11:00" }];
  assert.equal(slotFree("10:30", 60, booked, 1), false);
  assert.equal(slotFree("11:00", 60, booked, 1), true);
  assert.equal(slotFree("10:30", 60, booked, 2), true);
});

test("guest portal: guests can undo an order for 10 minutes and an appointment until 2 hours before", () => {
  const now = Date.parse("2026-07-10T10:00:00Z");
  assert.equal(guestCanCancel({ status: "placed", mode: "order", createdAt: now - 5 * 60_000, date: null, time: null }, now, "2026-07-10", "13:00"), true);
  assert.equal(guestCanCancel({ status: "placed", mode: "order", createdAt: now - 11 * 60_000, date: null, time: null }, now, "2026-07-10", "13:00"), false);
  assert.equal(guestCanCancel({ status: "done", mode: "order", createdAt: now, date: null, time: null }, now, "2026-07-10", "13:00"), false);
  assert.equal(guestCanCancel({ status: "placed", mode: "appointment", createdAt: 0, date: "2026-07-10", time: "15:00" }, now, "2026-07-10", "13:00"), true);
  assert.equal(guestCanCancel({ status: "placed", mode: "appointment", createdAt: 0, date: "2026-07-10", time: "14:30" }, now, "2026-07-10", "13:00"), false);
  assert.equal(guestCanCancel({ status: "placed", mode: "appointment", createdAt: 0, date: "2026-07-11", time: "09:00" }, now, "2026-07-10", "23:00"), true);
});

test("guest portal: stay days start today (or on arrival) and end on departure", () => {
  assert.deepEqual(stayDays("2026-07-08", "2026-07-11", "2026-07-10"), ["2026-07-10", "2026-07-11"]);
  assert.deepEqual(stayDays("2026-07-12", "2026-07-13", "2026-07-10"), ["2026-07-12", "2026-07-13"]);
});

test("guest portal: messages show in their window, personal ones only to their booking", () => {
  const now = 1_000_000_000;
  assert.equal(announcementVisible({ startsAt: now - 1, endsAt: null, bookingId: null, deletedAt: null }, 5, now), true);
  assert.equal(announcementVisible({ startsAt: now + 1, endsAt: null, bookingId: null, deletedAt: null }, 5, now), false);
  assert.equal(announcementVisible({ startsAt: now - 10, endsAt: now - 1, bookingId: null, deletedAt: null }, 5, now), false);
  assert.equal(announcementVisible({ startsAt: now - 8 * 86_400_000, endsAt: null, bookingId: null, deletedAt: null }, 5, now), false);
  assert.equal(announcementVisible({ startsAt: now - 1, endsAt: null, bookingId: 6, deletedAt: null }, 5, now), false);
  assert.equal(announcementVisible({ startsAt: now - 1, endsAt: null, bookingId: 5, deletedAt: null }, 5, now), true);
  assert.equal(announcementVisible({ startsAt: now - 1, endsAt: null, bookingId: null, deletedAt: now }, 5, now), false);
});

test("guest portal: Greek for Greek guests, English otherwise, texts in six languages", () => {
  assert.equal(pick("Μπαρ", "Bar", "el"), "Μπαρ");
  assert.equal(pick("Μπαρ", "Bar", "de"), "Bar");
  assert.equal(pick("Μπαρ", "", "fr"), "Μπαρ");
  const keys = Object.keys(portalTexts.el);
  for (const l of ["en", "fr", "de", "it", "es"] as const) for (const k of keys) assert.ok(portalTexts[l][k as keyof typeof portalTexts.el], `${l}.${k}`);
});
