import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { can, parsePermissions } from "../lib/security/permissions.ts";
import { hashPassword, verifyPassword } from "../lib/security/password.ts";
import { hashToken, newOpaqueToken } from "../lib/security/tokens.ts";
import { verifyTotp } from "../lib/security/totp.ts";
import { housekeepingChecklist, validChecklist } from "../lib/housekeeping.ts";
import { calculatePayment, type PaymentPolicy } from "../lib/payment-policy.ts";
import { assertTrustedOrigin } from "../lib/security/origin.ts";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.SESSION_SECRET ??= "unit-test-session-secret-longer-than-thirty-two-bytes";
process.env.PMS_DOCUMENT_KEY ??= "unit-test-document-key-longer-than-thirty-two-bytes";
process.env.PMS_ORIGIN ??= "https://pms.hotelcorali.gr";
process.env.BOOKING_ORIGIN ??= "https://booking.hotelcorali.gr";
process.env.APP_ROLE ??= "pms";

test("role permissions deny writes for readonly and isolate housekeeping", () => {
  assert.equal(can("readonly", "reservations.read"), true);
  assert.equal(can("readonly", "reservations.write"), false);
  assert.equal(can("readonly", "dashboard.write"), false);
  assert.equal(can("reception", "dashboard.write"), true);
  assert.equal(can("housekeeping", "housekeeping.write"), true);
  assert.equal(can("housekeeping", "folios.read"), false);
  assert.equal(can("reception", "users.manage"), false);
  assert.equal(can("owner", "users.manage"), true);
});

test("permission overrides accept only known boolean values", () => {
  assert.deepEqual(parsePermissions('{"rooms.write":true,"users.manage":"yes","unknown":true}'), { "rooms.write": true });
});

test("opaque session tokens are random and hashes are deterministic", () => {
  const first = newOpaqueToken();
  const second = newOpaqueToken();
  assert.notEqual(first, second);
  assert.equal(hashToken(first), hashToken(first));
  assert.notEqual(hashToken(first), hashToken(second));
});

test("passwords use Argon2 and reject an incorrect password", async () => {
  const digest = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword(digest, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(digest, "incorrect password"), false);
});

test("TOTP accepts a current code and rejects malformed input", () => {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({ secret, digits: 6, period: 30 });
  assert.equal(verifyTotp(secret.base32, totp.generate()), true);
  assert.equal(verifyTotp(secret.base32, "12x456"), false);
});

test("housekeeping completion requires every checklist item", () => {
  const complete = Object.fromEntries(housekeepingChecklist.map((item) => [item, true]));
  assert.equal(validChecklist(complete), true);
  complete[housekeepingChecklist[0]] = false;
  assert.equal(validChecklist(complete), false);
});

test("full payment window includes exactly seven days before arrival", () => {
  const policy: PaymentPolicy = { fullPayment: false, depositPercent: 30, balanceDueDays: 5, fullPaymentWindowActive: true, fullPaymentDaysBeforeArrival: 7 };
  assert.deepEqual(calculatePayment(100_00, "2026-10-08", policy, new Date("2026-10-01T18:00:00Z")), { mode: "full", payableNowCents: 100_00, balanceCents: 0, daysUntilArrival: 7 });
  assert.deepEqual(calculatePayment(100_00, "2026-10-09", policy, new Date("2026-10-01T18:00:00Z")), { mode: "deposit", payableNowCents: 30_00, balanceCents: 70_00, daysUntilArrival: 8 });
});

test("disabled full payment window falls back to configured deposit", () => {
  const policy: PaymentPolicy = { fullPayment: false, depositPercent: 40, balanceDueDays: 5, fullPaymentWindowActive: false, fullPaymentDaysBeforeArrival: 7 };
  assert.equal(calculatePayment(250_00, "2026-10-20", policy, new Date("2026-10-01T00:00:00Z")).payableNowCents, 100_00);
});

test("CSRF origin and Fetch Metadata checks fail closed while allowing Hotel Corali subdomains", () => {
  const request = (headers: Record<string, string>) => new Request("https://pms.hotelcorali.gr/api/pms/dashboard", { method: "POST", headers });

  assert.doesNotThrow(() => assertTrustedOrigin(request({ Origin: "https://pms.hotelcorali.gr", "Sec-Fetch-Site": "same-origin" })));
  assert.doesNotThrow(() => assertTrustedOrigin(request({ Origin: "https://booking.hotelcorali.gr", "Sec-Fetch-Site": "same-site" })));
  assert.doesNotThrow(() => assertTrustedOrigin(request({ "Sec-Fetch-Site": "same-origin" })));
  assert.doesNotThrow(() => assertTrustedOrigin(request({ "Sec-Fetch-Site": "same-site" })));

  const rejectedHeaders: Array<Record<string, string>> = [
    {},
    { Origin: "null" },
    { Origin: "https://evil.example", "Sec-Fetch-Site": "same-site" },
    { Origin: "https://pms.hotelcorali.gr", "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "none" },
  ];
  for (const headers of rejectedHeaders) {
    assert.throws(() => assertTrustedOrigin(request(headers)), /UNTRUSTED_ORIGIN/);
  }
});

test("every state-changing PMS and auth route invokes the CSRF guard", () => {
  const roots = [path.join(process.cwd(), "app/api/pms"), path.join(process.cwd(), "app/api/auth")];
  const visit = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? visit(target) : entry.name === "route.ts" ? [target] : [];
  });
  const unguarded = roots.flatMap(visit).filter((file) => {
    const source = fs.readFileSync(file, "utf8");
    return /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source) && !source.includes("assertTrustedOrigin(");
  });
  assert.deepEqual(unguarded, []);
});

test("granular create and edit permissions honor legacy write overrides", () => {
  assert.equal(can("reception", "reservations.create", {"reservations.write":false}), false);
  assert.equal(can("reception", "reservations.edit", {"reservations.write":false}), false);
  assert.equal(can("reception", "reservations.create", {"reservations.write":false,"reservations.create":true}), true);
  assert.equal(can("reception", "reservations.edit", {"reservations.write":false,"reservations.create":true}), false);
  assert.equal(can("readonly", "rooms.create"), false);
  assert.equal(can("readonly", "pricing.edit"), false);
});
