import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canApproveInspection } from "../lib/housekeeping.ts";
import { can, permissionMatrix } from "../lib/security/permissions.ts";

test("v185: a set second person approves; otherwise the manager / whoever has the permission — even their own cleaning", () => {
  // Second person set for the room (id 7); the housekeeper (id 3) cleaned it.
  assert.equal(canApproveInspection({ userId: 7, canInspect: false, cleanerId: 3, inspectorId: 7 }), true);
  assert.equal(canApproveInspection({ userId: 3, canInspect: false, cleanerId: 3, inspectorId: 7 }), false, "the housekeeper does not approve her own room");
  assert.equal(canApproveInspection({ userId: 5, canInspect: false, cleanerId: 3, inspectorId: 7 }), false, "another housekeeper does not approve it");
  assert.equal(canApproveInspection({ userId: 1, canInspect: true, cleanerId: 3, inspectorId: 7 }), true, "the manager can always approve");
  assert.equal(canApproveInspection({ userId: 7, canInspect: false, cleanerId: 7, inspectorId: 7 }), false, "the second person cannot approve what they cleaned");
  // No second person: only the permission decides — the manager may approve a room they cleaned (room 112 case).
  assert.equal(canApproveInspection({ userId: 1, canInspect: true, cleanerId: 1, inspectorId: null }), true);
  assert.equal(canApproveInspection({ userId: 5, canInspect: false, cleanerId: 3, inspectorId: null }), false);
});

test("v185: «Έγκριση» permission — owner and admin by default, can be given to anyone, shown in the user editor", () => {
  assert.equal(can("owner", "housekeeping.inspect"), true);
  assert.equal(can("admin", "housekeeping.inspect"), true);
  assert.equal(can("housekeeping", "housekeeping.inspect"), false);
  assert.equal(can("reception", "housekeeping.inspect"), false);
  assert.equal(can("housekeeping", "housekeeping.inspect", { "housekeeping.inspect": true }), true);
  assert.equal(permissionMatrix.find((m) => m.module === "housekeeping")?.cells.approve, "housekeeping.inspect");
});

test("v185: every approve path uses the same rule", () => {
  const route = readFileSync("app/api/pms/housekeeping/[id]/route.ts", "utf8");
  assert.match(route, /canApproveInspection\(\{ userId: u\.id, canInspect: can\(u\.role, "housekeeping\.inspect"/);
  assert.doesNotMatch(route, /review && Number\(r\.cleaned_by_staff_id\) === u\.id/);
  for (const f of ["app/pms/housekeeping/board.tsx", "lib/hk-mobile.ts", "app/api/pms/staff-app/route.ts"]) assert.match(readFileSync(f, "utf8"), /canApproveInspection\(/, f);
  assert.match(readFileSync("app/staff/desk-sections.tsx", "utf8"), /\{x\.canApprove && <>/);
});
