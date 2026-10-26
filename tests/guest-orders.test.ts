import assert from "node:assert/strict";
import test from "node:test";
import { extraQuantity, lateCheckoutCents, orderWindow } from "../lib/guest-orders-core.ts";

test("service quantities follow the pricing mode", () => {
  assert.equal(extraQuantity("per_night", 4, 2), 4);
  assert.equal(extraQuantity("per_person", 4, 3), 3);
  assert.equal(extraQuantity("per_stay", 4, 3), 1);
});

test("late check-out is half an average night", () => {
  assert.equal(lateCheckoutCents(60000, 4), 7500);
  assert.equal(lateCheckoutCents(0, 3), 0);
});

test("what can still be ordered", () => {
  assert.deepEqual(orderWindow("confirmed", "2026-07-10", "2026-07-14", "2026-07-01"), { extras: true, lateCheckout: true, upgrade: true });
  assert.deepEqual(orderWindow("checked_in", "2026-07-10", "2026-07-14", "2026-07-12"), { extras: true, lateCheckout: true, upgrade: false });
  assert.deepEqual(orderWindow("checked_out", "2026-07-10", "2026-07-14", "2026-07-14"), { extras: false, lateCheckout: false, upgrade: false });
  assert.deepEqual(orderWindow("confirmed", "2026-07-10", "2026-07-14", "2026-07-15"), { extras: false, lateCheckout: false, upgrade: false });
});
