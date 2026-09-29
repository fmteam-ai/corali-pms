import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(os.tmpdir(), "corali-runtime-test-"));
try {
  const pms = path.join(directory, "pms.env");
  const booking = path.join(directory, "booking.env");
  const common = [
    "DATABASE_URL=postgresql://test:test@127.0.0.1:5432/corali",
    "DATABASE_SSL=false",
    "PMS_DOCUMENT_KEY=integration-document-key-longer-than-32-characters",
    "PMS_OWNER_ID=hotel-corali",
    "",
  ].join("\n");
  writeFileSync(pms, common, { mode: 0o600 });
  const preservedBookingSecret = "existing-booking-session-secret-longer-than-thirty-two-characters";
  writeFileSync(booking, `${common}SESSION_SECRET=${preservedBookingSecret}\n`, { mode: 0o600 });
  execFileSync(process.execPath, [
    "scripts/prepare-runtime-env.mjs",
    pms,
    booking,
    "https://pms.hotelcorali.gr",
    "https://booking.hotelcorali.gr",
  ], { cwd: process.cwd(), stdio: "pipe" });

  const pmsText = readFileSync(pms, "utf8");
  const bookingText = readFileSync(booking, "utf8");
  for (const text of [pmsText, bookingText]) {
    assert.match(text, /^NODE_ENV=production$/m);
    assert.match(text, /^PMS_ORIGIN=https:\/\/pms\.hotelcorali\.gr$/m);
    assert.match(text, /^BOOKING_ORIGIN=https:\/\/booking\.hotelcorali\.gr$/m);
    assert.match(text, /^PMS_DOCUMENT_KEY=integration-document-key-longer-than-32-characters$/m);
  }
  assert.match(pmsText, /^SESSION_SECRET=[A-Za-z0-9_-]{64}$/m);
  assert.match(pmsText, /^APP_ROLE=pms$/m);
  assert.match(bookingText, /^APP_ROLE=booking$/m);
  assert.match(bookingText, new RegExp(`^SESSION_SECRET=${preservedBookingSecret}$`, "m"));
  assert.equal(statSync(pms).mode & 0o777, 0o600);
  assert.equal(statSync(booking).mode & 0o777, 0o600);

  const mismatched = path.join(directory, "mismatched.env");
  writeFileSync(mismatched, common.replace(
    "integration-document-key-longer-than-32-characters",
    "different-document-key-longer-than-32-characters",
  ), { mode: 0o600 });
  const mismatchResult = spawnSync(process.execPath, [
    "scripts/prepare-runtime-env.mjs",
    pms,
    mismatched,
    "https://pms.hotelcorali.gr",
    "https://booking.hotelcorali.gr",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(mismatchResult.status, 0);
  assert.match(mismatchResult.stderr, /PMS_DOCUMENT_KEY values do not match/);

  const unsafeOriginResult = spawnSync(process.execPath, [
    "scripts/prepare-runtime-env.mjs",
    pms,
    booking,
    "http://pms.hotelcorali.gr",
    "https://booking.hotelcorali.gr",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(unsafeOriginResult.status, 0);
  assert.match(unsafeOriginResult.stderr, /must be an HTTPS origin/);
  console.log("Runtime environment repair, role separation and secret preservation: OK");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
