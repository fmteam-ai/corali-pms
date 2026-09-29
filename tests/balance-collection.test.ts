import assert from "node:assert/strict";
import test from "node:test";
import { attemptAllowed, balanceChargeForm, collectionDue } from "../scripts/balance-collection-core.mjs";

const policy = { active: true, days: 7 };
const booking = { status: "confirmed", balance_cents: 30000, check_in: "2026-10-06" };

test("balance is collected inside the configured window only", () => {
  assert.equal(collectionDue(booking, policy, "2026-09-29"), true, "exactly 7 days before");
  assert.equal(collectionDue(booking, policy, "2026-09-28"), false, "8 days before");
  assert.equal(collectionDue(booking, policy, "2026-10-06"), true, "arrival day");
  assert.equal(collectionDue(booking, policy, "2026-10-07"), false, "after arrival");
  assert.equal(collectionDue({ ...booking, balance_cents: 0 }, policy, "2026-10-01"), false);
  assert.equal(collectionDue({ ...booking, status: "cancelled" }, policy, "2026-10-01"), false);
  assert.equal(collectionDue(booking, { active: false, days: 7 }, "2026-10-01"), false, "switched off in the PMS");
  assert.equal(collectionDue(booking, { active: true, days: 3 }, "2026-10-01"), false, "configurable days");
});

test("charge attempts are limited and spaced", () => {
  const now = Date.parse("2026-10-01T10:00:00Z");
  assert.equal(attemptAllowed([], now), true);
  assert.equal(attemptAllowed([{ status: "failed", created_at: now - 3_600_000 }], now), false, "wait 24h after a failure");
  assert.equal(attemptAllowed([{ status: "failed", created_at: now - 25 * 3_600_000 }], now), true);
  assert.equal(attemptAllowed([{ status: "failed", created_at: 0 }, { status: "failed", created_at: 0 }, { status: "failed", created_at: 0 }], now), false, "three failures max");
  assert.equal(attemptAllowed([{ status: "succeeded", created_at: 0 }], now), false);
  const form = balanceChargeForm({ id: 7, reference: "CR-1", payment_customer_ref: "cus_1", payment_method_ref: "pm_1" }, 30000);
  assert.equal(form.get("off_session"), "true");
  assert.equal(form.get("amount"), "30000");
  assert.equal(form.get("metadata[kind]"), "balance_auto");
});
