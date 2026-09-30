import assert from "node:assert/strict";
import test from "node:test";
import { chargeMode, isClimateFee } from "../lib/climate-fee.ts";

test("climate fee is recognised in any case or language and charged per room per night", () => {
  for (const name of ["Τέλος Ανθεκτικότητας στην Κλιματική Κρίση", "ΤΕΛΟΣ ΑΝΘΕΚΤΙΚΟΤΗΤΑΣ", "Climate Crisis Resilience Fee", "Taxe de résilience"]) {
    assert.equal(chargeMode({ name, calculation_mode: "per_booking" }), "per_room_night", name);
  }
  assert.equal(isClimateFee({ name: "Fee", name_translations_json: '{"el":"Τέλος κλιματικής κρίσης"}' }), true);
  assert.equal(isClimateFee({ category: "climate_tax", name: "x" }), true);
  assert.equal(chargeMode({ name: "Cleaning fee", calculation_mode: "per_booking" }), "per_booking");
});
