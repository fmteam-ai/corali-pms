import assert from "node:assert/strict";
import test from "node:test";
import { validReservationTransition } from "../lib/reservation-transition.ts";

test("reservation status changes follow the booking lifecycle", () => {
  assert.equal(validReservationTransition("confirmed", "check_in"), true);
  assert.equal(validReservationTransition("checked_in", "check_out"), true);
  assert.equal(validReservationTransition("confirmed", "cancel"), true);
  assert.equal(validReservationTransition("confirmed", "no_show"), true);
  assert.equal(validReservationTransition("no_show", "check_in"), false);
  assert.equal(validReservationTransition("cancelled", "confirm"), true);
  assert.equal(validReservationTransition("cancelled", "check_in"), false);
  assert.equal(validReservationTransition("confirmed", "check_out"), false);
  assert.equal(validReservationTransition("checked_out", "confirm"), false);
  assert.equal(validReservationTransition("checked_out", "move"), false);
});
