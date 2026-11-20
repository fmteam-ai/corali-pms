import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseRoom, guestRoomTexts, roomRequestProblem } from "../lib/guest-room-core.ts";

test("guest room: only a checked-in guest with a room; cleaning is refused while do not disturb is on", () => {
  assert.equal(canUseRoom({ status: "checked_in", room_id: 12 }), true);
  assert.equal(canUseRoom({ status: "confirmed", room_id: 12 }), false);
  assert.equal(canUseRoom({ status: "checked_in", room_id: null }), false);
  assert.equal(roomRequestProblem("cleaning", false, true), null);
  assert.equal(roomRequestProblem("cleaning", true, true), "DND_ON");
  assert.equal(roomRequestProblem("dnd", true, true), null);
  assert.equal(roomRequestProblem("dnd", false, false), "NOT_IN_HOUSE");
});

test("guest room texts exist in the six guest languages with the same keys", () => {
  const keys = Object.keys(guestRoomTexts.en).sort();
  for (const lang of ["el", "en", "fr", "de", "it", "es"] as const) assert.deepEqual(Object.keys(guestRoomTexts[lang]).sort(), keys);
});
