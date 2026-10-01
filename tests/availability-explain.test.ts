import assert from "node:assert/strict";
import test from "node:test";
import { explainAvailability, type ExplainRoom } from "../lib/availability-explain.ts";

const room = (x: Partial<ExplainRoom>): ExplainRoom => ({ id: 1, code: "101", room_type: "double", category: "Deluxe Double Room", capacity: 2, active: 1, operational_status: "available", base_rate_cents: 10000, ...x });
const base = { checkIn: "2026-10-04", checkOut: "2026-10-10", adults: 2, children: 0, rooms: 1, bookings: [], holds: [], rateRules: [], restrictions: [], minStay: [] };

test("explains room-level blocks", () => {
  const r = explainAvailability({ ...base, roomList: [room({}), room({ id: 2, code: "102", active: 0 }), room({ id: 3, code: "103", operational_status: "out_of_order" }), room({ id: 4, code: "104", capacity: 1 }), room({ id: 5, code: "105" }), room({ id: 6, code: "106" })], bookings: [{ room_id: 5, reference: "CR-1", check_in: "2026-10-03", check_out: "2026-10-06" }], holds: [6] });
  assert.deepEqual(r.map((x) => [x.code, x.offered, x.reasons.map((y) => y.code).join(",")]), [["101", true, ""], ["102", false, "inactive"], ["103", false, "out_of_order"], ["104", false, "capacity"], ["105", false, "booked"], ["106", false, "payment_hold"]]);
});

test("explains category-level blocks: minimum stay, no price, not enough rooms, merged cards", () => {
  const minStay = explainAvailability({ ...base, roomList: [room({})], minStay: [{ id: 1, room_type: "double", starts_on: null, ends_on: null, min_nights: 7 }] });
  assert.equal(minStay[0].reasons[0].code, "min_stay");
  assert.equal(explainAvailability({ ...base, roomList: [room({ base_rate_cents: 0 })] })[0].reasons[0].code, "no_price");
  assert.equal(explainAvailability({ ...base, rooms: 2, adults: 4, roomList: [room({})] })[0].reasons[0].code, "not_enough");
  const merged = explainAvailability({ ...base, roomList: [room({}), room({ id: 2, code: "102", category: "Superior Double" })] });
  assert.equal(merged[1].card, "Deluxe Double Room", "same room type: shown under the first room's category");
});
