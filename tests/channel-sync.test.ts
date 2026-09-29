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
