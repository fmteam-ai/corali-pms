import assert from "node:assert/strict";
import test from "node:test";
import { hkChanges, roomDayKind, roomHasWork, type HkSnapshot } from "../lib/hk-mobile-core.ts";
import { routeForRole } from "../lib/app-role.ts";

test("each room gets one kind for the day; departures + arrivals are turnovers", () => {
  assert.equal(roomDayKind({ departure: true, arrival: true, stayover: false }), "turnover");
  assert.equal(roomDayKind({ departure: true, arrival: false, stayover: false }), "departure");
  assert.equal(roomDayKind({ departure: false, arrival: true, stayover: false }), "arrival");
  assert.equal(roomDayKind({ departure: false, arrival: false, stayover: true }), "stayover");
  assert.equal(roomDayKind({ departure: false, arrival: false, stayover: false }), "vacant");
  assert.equal(roomHasWork({ kind: "vacant", taskOpen: false, notices: 0, due: 0 }), false);
  assert.equal(roomHasWork({ kind: "vacant", taskOpen: false, notices: 1, due: 0 }), true);
});

test("the phone rings for new messages to me, guests who just left and new assignments, not on the first load", () => {
  const a: HkSnapshot = { rooms: [{ code: "101", departed: false, task: null }, { code: "102", departed: false, task: { id: 5, assignedToMe: true } }], messages: [{ id: 1, mine: false }] };
  assert.deepEqual(hkChanges(null, a), { messages: 0, departed: [], tasks: [] });
  const b: HkSnapshot = { rooms: [{ code: "101", departed: true, task: { id: 9, assignedToMe: true } }, { code: "102", departed: false, task: { id: 5, assignedToMe: true } }], messages: [{ id: 2, mine: true }, { id: 3, mine: false }, { id: 1, mine: false }] };
  assert.deepEqual(hkChanges(a, b), { messages: 1, departed: ["101"], tasks: ["101"] });
  assert.deepEqual(hkChanges(b, b), { messages: 0, departed: [], tasks: [] });
});

test("the phone page lives on the PMS host only", () => {
  assert.deepEqual(routeForRole("pms", "/hk"), { action: "allow" });
  assert.deepEqual(routeForRole("booking", "/hk"), { action: "redirect", destination: "/book" });
  assert.deepEqual(routeForRole("pms", "/staff"), { action: "allow" });
  assert.deepEqual(routeForRole("booking", "/staff"), { action: "redirect", destination: "/book" });
});
