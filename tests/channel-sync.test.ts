import assert from "node:assert/strict";
import test from "node:test";
import { availabilityRanges, normalizeRevision, sellable } from "../scripts/channel-core.mjs";

test("availability is sent as compact date ranges", () => {
  assert.deepEqual(availabilityRanges([
    { date: "2026-10-03", available: 2 }, { date: "2026-10-01", available: 3 }, { date: "2026-10-02", available: 3 }, { date: "2026-10-05", available: 2 },
  ]), [
    { date_from: "2026-10-01", date_to: "2026-10-02", availability: 3 },
    { date_from: "2026-10-03", date_to: "2026-10-03", availability: 2 },
    { date_from: "2026-10-05", date_to: "2026-10-05", availability: 2 },
  ]);
  assert.equal(sellable(-2), 0);
});

test("Channex revisions become PMS reservations", () => {
  const r = normalizeRevision({ id: "rev-1", attributes: { booking_id: "b-9", status: "new", ota_name: "Booking.com", ota_reservation_code: "4711", currency: "eur", payment_collect: "property", amount: "450.00", arrival_date: "2026-10-10", departure_date: "2026-10-13",
    customer: { name: "Anna", surname: "Rossi", mail: "anna@example.com", phone: "+39", country: "IT", language: "it" },
    rooms: [{ room_type_id: "rt-double", amount: "450.00", checkin_date: "2026-10-10", checkout_date: "2026-10-13", occupancy: { adults: 2, children: 1 } }] } }, { "rt-double": "double" });
  assert.equal(r.channel, "booking.com");
  assert.equal(r.status, "new");
  assert.equal(r.guestName, "Anna Rossi");
  assert.deepEqual(r.rooms, [{ roomType: "double", externalRoomTypeId: "rt-double", checkIn: "2026-10-10", checkOut: "2026-10-13", adults: 2, children: 1, totalCents: 45000 }]);
  assert.equal(normalizeRevision({ id: "x", attributes: { status: "cancelled", ota_name: "Expedia", rooms: [] } }, {}).channel, "expedia");
  assert.equal(normalizeRevision({ id: "x", attributes: { status: "modified", ota_name: "Airbnb", rooms: [{ room_type_id: "unknown" }] } }, {}).rooms[0].roomType, null);
});

test("a modified OTA reservation updates the imported bookings in place", async () => {
  const { planRevision, feedHasMore } = await import("../scripts/channel-core.mjs");
  const a = { id: 5, status: "confirmed" }, b = { id: 9, status: "confirmed" }, gone = { id: 3, status: "cancelled" };
  // Same number of rooms: both updated, nothing cancelled or re-created (keeps room, folio, payments).
  let p = planRevision([b, gone, a], ["r1", "r2"]);
  assert.deepEqual(p.updates.map((x) => [x.booking.id, x.room]), [[5, "r1"], [9, "r2"]]);
  assert.deepEqual([p.inserts, p.cancels], [[], []]);
  // Guest added a room → insert; guest dropped a room → cancel the confirmed one, never a checked-in stay.
  p = planRevision([a], ["r1", "r2"]);
  assert.deepEqual([p.updates.length, p.inserts], [1, ["r2"]]);
  p = planRevision([{ id: 1, status: "checked_in" }, { id: 2, status: "confirmed" }, { id: 4, status: "checked_in" }], ["r1"]);
  assert.deepEqual(p.cancels.map((x) => x.id), [2]);
  // First import: everything is inserted.
  assert.deepEqual(planRevision([], ["r1"]).inserts, ["r1"]);
  // Feed: read the next page only when this one was full and something was acknowledged.
  assert.equal(feedHasMore({ total: 25 }, 10, true), true);
  assert.equal(feedHasMore({ total: 25 }, 10, false), false);
  assert.equal(feedHasMore({ total: 4 }, 4, true), false);
});

test("restrictions sent to Channex follow the booking-engine rules", async () => {
  const { computeRestrictions, restrictionRanges } = await import("../scripts/channel-core.mjs");
  const dates = ["2027-07-01", "2027-07-02", "2027-07-03", "2027-07-04", "2027-07-05"];
  const days = computeRestrictions({
    dates, roomType: "double", roomCodes: ["101", "102"],
    // Min stay 3 on arrival in July for doubles; 5 nights for apartments only.
    minStayRules: [{ id: 1, room_type: "double", starts_on: "2027-07-01", ends_on: "2027-07-31", min_nights: 3, active: 1 }, { id: 2, room_type: "apartment", starts_on: null, ends_on: null, min_nights: 5, active: 1 }],
    rateRules: [],
    restrictions: [
      // Stop sell on 2–3 July for all rooms.
      { starts_on: "2027-07-02", ends_on: "2027-07-03", minimum_stay: 1, stop_sell: 1, closed_arrival_weekdays: "[]", closed_departure_weekdays: "[]", room_codes: "[]", rate_plan_keys: "[]", active: 1 },
      // Only room 101 → not the whole room type: ignored for the OTAs.
      { starts_on: "2027-07-04", ends_on: "2027-07-05", minimum_stay: 7, stop_sell: 0, closed_arrival_weekdays: "[]", closed_departure_weekdays: "[]", room_codes: "[\"101\"]", rate_plan_keys: "[]", active: 1 },
      // Web-only plan → ignored. Sunday arrivals closed 4–5 July (2027-07-04 is a Sunday).
      { starts_on: "2027-07-01", ends_on: "2027-07-05", minimum_stay: 9, stop_sell: 1, closed_arrival_weekdays: "[]", closed_departure_weekdays: "[]", room_codes: "[]", rate_plan_keys: "[\"non_refundable\"]", active: 1 },
      { starts_on: "2027-07-04", ends_on: "2027-07-05", minimum_stay: 2, stop_sell: 0, closed_arrival_weekdays: "[0]", closed_departure_weekdays: "[]", room_codes: "[]", rate_plan_keys: "[]", active: 1 },
    ],
  });
  assert.deepEqual(days.map((d) => d.min_stay_arrival), [3, 3, 3, 3, 3]);
  assert.deepEqual(days.map((d) => d.stop_sell), [false, true, true, false, false]);
  assert.deepEqual(days.map((d) => d.min_stay_through), [1, 1, 1, 2, 2]);
  assert.deepEqual(days.map((d) => d.closed_to_arrival), [false, false, false, true, false]);
  assert.equal(restrictionRanges(days).length, 4);
  assert.deepEqual(restrictionRanges(days)[1], { date_from: "2027-07-02", date_to: "2027-07-03", min_stay_arrival: 3, min_stay_through: 1, stop_sell: true, closed_to_arrival: false, closed_to_departure: false });
  // A closed rate rule stops sales; a closed-to-departure on the last night closes the next day's departure.
  const r = computeRestrictions({ dates, roomType: "double", roomCodes: ["101"], minStayRules: [], restrictions: [], rateRules: [
    { id: 1, room_type: "double", room_codes: "[]", starts_on: "2027-07-01", ends_on: "2027-07-01", minimum_stay: null, maximum_stay: null, closed: 1, closed_to_arrival: 0, closed_to_departure: 0 },
    { id: 2, room_type: null, room_codes: "[]", starts_on: "2027-07-03", ends_on: "2027-07-03", minimum_stay: 4, maximum_stay: null, closed: 0, closed_to_arrival: 0, closed_to_departure: 1 },
  ] });
  assert.deepEqual(r.map((d) => [d.stop_sell, d.min_stay_through, d.closed_to_departure]), [[true, 1, false], [false, 1, false], [false, 4, false], [false, 1, true], [false, 1, false]]);
});
