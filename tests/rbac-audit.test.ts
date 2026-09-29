import assert from "node:assert/strict";
import test from "node:test";
import { can, permissionKeys, permissionMatrix, roleDefault } from "../lib/security/permissions.ts";
import { auditActionName, clientAddress, redactForAudit } from "../lib/audit-redact.ts";
import { changedFields } from "../lib/audit-diff.ts";

test("role defaults follow the specification", () => {
  for (const key of permissionKeys) {
    assert.equal(can("owner", key), true, `owner ${key}`);
    assert.equal(can("admin", key), true, `manager ${key}`);
  }
  // Reception: reservations, front desk, CRM, basic billing, housekeeping view.
  for (const key of ["reservations.create", "reservations.edit", "reservations.delete", "folios.write", "housekeeping.read", "pricing.read"] as const) assert.equal(can("reception", key), true, key);
  for (const key of ["housekeeping.write", "pricing.edit", "rooms.edit", "reports.read", "integrations.read", "users.manage", "audit.read"] as const) assert.equal(can("reception", key), false, key);
  // Housekeeping: only cleaning.
  assert.deepEqual(permissionKeys.filter((k) => can("housekeeping", k)), ["dashboard.read", "rooms.read", "housekeeping.read", "housekeeping.write"]);
  // Read-only: views and non-financial reports only.
  for (const key of permissionKeys) {
    const allowed = can("readonly", key);
    if (allowed) assert.match(key, /\.read$/, key);
  }
  assert.equal(can("readonly", "reports.read"), true);
  assert.equal(can("readonly", "reports.financial"), false);
  assert.equal(can("readonly", "folios.read"), false);
  assert.equal(can("readonly", "integrations.read"), false);
});

test("overrides and legacy write parents apply to delete", () => {
  assert.equal(can("reception", "reservations.delete", { "reservations.write": false }), false);
  assert.equal(can("reception", "reservations.delete", { "reservations.write": false, "reservations.delete": true }), true);
  assert.equal(can("readonly", "reports.financial", { "reports.financial": true }), true);
  assert.equal(can("admin", "users.manage", { "users.manage": false }), false);
  assert.equal(roleDefault("reception", "folios.write"), true);
});

test("the permission matrix only references known permissions", () => {
  const known = new Set<string>(permissionKeys);
  for (const row of permissionMatrix) for (const key of Object.values(row.cells)) assert.ok(known.has(key!), `${row.module} ${key}`);
});

test("audit payloads redact credentials and identity documents", () => {
  const out = redactForAudit({ username: "maria", password: "hunter2hunter2", nested: { secretKey: "sk_live_x", webhookSecret: "whsec", documentNumber: "AB123" }, totpCode: "123456", note: "x".repeat(2100), list: [{ apiKey: "k" }] }) as Record<string, unknown>;
  assert.equal(out.username, "maria");
  assert.equal(out.password, "[redacted]");
  assert.equal(out.totpCode, "[redacted]");
  assert.deepEqual(out.nested, { secretKey: "[redacted]", webhookSecret: "[redacted]", documentNumber: "[redacted]" });
  assert.deepEqual(out.list, [{ apiKey: "[redacted]" }]);
  assert.equal(String(out.note).length, 2001);
  assert.equal(redactForAudit({ password: "" }) instanceof Object, true);
});

test("client address and action names", () => {
  assert.equal(clientAddress("203.0.113.7, 10.0.0.1", "10.0.0.1"), "203.0.113.7");
  assert.equal(clientAddress(null, " 198.51.100.2 "), "198.51.100.2");
  assert.equal(clientAddress(null, null), "");
  assert.equal(auditActionName("PATCH", { action: "move" }), "move");
  assert.equal(auditActionName("POST", { kind: "base_rate" }), "post:base_rate");
  assert.equal(auditActionName("PUT", null), "put");
});

test("changed fields compare before and after images", () => {
  assert.deepEqual(changedFields({ base_rate_cents: 8000, code: "101" }, { base_rate_cents: 9000, code: "101" }), [{ field: "base_rate_cents", before: 8000, after: 9000 }]);
  assert.deepEqual(changedFields(null, { name: "x" }), [{ field: "name", before: null, after: "x" }]);
  assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), []);
});
