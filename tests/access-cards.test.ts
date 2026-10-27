import assert from "node:assert/strict";
import test from "node:test";
import { accessDecision, athensMs, bookingValidity, cardEmail, cardState, cardTexts, dueToIssue, effectiveCard, normalizeCardSettings } from "../scripts/access-card-core.mjs";
import { crc32, zipStore } from "../lib/zip-store.ts";

const settings = normalizeCardSettings({ enabled: true });

test("access card: valid from check-in time to 11:00 on the departure day, Athens time", () => {
  const v = bookingValidity("2026-07-10", "2026-07-13", settings);
  assert.equal(new Date(v.from).toISOString(), "2026-07-10T11:00:00.000Z"); // 14:00 summer time
  assert.equal(new Date(v.until).toISOString(), "2026-07-13T08:00:00.000Z"); // 11:00 summer time
  assert.equal(new Date(athensMs("2026-12-01", "11:00")).toISOString(), "2026-12-01T09:00:00.000Z"); // winter time
});

test("access card: sent the day before arrival from the sending time, late bookings at once", () => {
  const b = { status: "confirmed", check_in: "2026-07-11", check_out: "2026-07-14" };
  assert.equal(dueToIssue(b, "2026-07-10", "09:59", settings), false);
  assert.equal(dueToIssue(b, "2026-07-10", "10:00", settings), true);
  assert.equal(dueToIssue(b, "2026-07-09", "18:00", settings), false);
  assert.equal(dueToIssue({ ...b, check_in: "2026-07-10" }, "2026-07-10", "08:00", settings), true);
  assert.equal(dueToIssue({ ...b, check_in: "2026-07-08", check_out: "2026-07-10" }, "2026-07-10", "11:30", settings), false);
  assert.equal(dueToIssue({ ...b, status: "cancelled" }, "2026-07-10", "12:00", settings), false);
});

test("access card: states and door decisions", () => {
  const card = { status: "active", validFrom: 1000, validUntil: 2000, roomCode: "102", zones: ["gym"] };
  assert.equal(cardState(card, 999), "scheduled");
  assert.equal(cardState(card, 1500), "active");
  assert.equal(cardState(card, 2000), "expired");
  assert.equal(cardState({ ...card, status: "revoked" }, 1500), "revoked");
  assert.deepEqual(accessDecision(card, { zone: "room", room: "102" }, 1500), { allow: true, reason: "OK" });
  assert.equal(accessDecision(card, { zone: "room", room: "103" }, 1500).reason, "WRONG_ROOM");
  assert.equal(accessDecision(card, { zone: "gym" }, 1500).allow, true);
  assert.equal(accessDecision(card, { zone: "pool" }, 1500).reason, "ZONE_NOT_ALLOWED");
  assert.equal(accessDecision(card, { zone: "gym" }, 2500).reason, "EXPIRED");
  assert.equal(accessDecision(card, { zone: "gym" }, 500).reason, "NOT_YET_VALID");
  assert.equal(accessDecision(null, { zone: "gym" }, 1500).reason, "UNKNOWN_CARD");
});

test("access card: a booking card follows its booking unless reception set the end", () => {
  const row = { kind: "booking", booking_id: 7, status: "active", valid_from: 1, valid_until: 2, until_locked: 0, check_in: "2026-07-10", check_out: "2026-07-15", booking_status: "checked_in", booking_room_code: "201", card_room_code: "102" };
  const e = effectiveCard(row, settings);
  assert.equal(e.validUntil, bookingValidity("2026-07-10", "2026-07-15", settings).until);
  assert.equal(e.roomCode, "201");
  assert.equal(effectiveCard({ ...row, until_locked: 1 }, settings).validUntil, 2);
  assert.equal(effectiveCard({ ...row, booking_status: "cancelled" }, settings).status, "revoked");
  assert.equal(effectiveCard({ ...row, kind: "manual", booking_id: null }, settings).roomCode, "102");
});

test("access card: settings, zones and e-mail texts in six languages", () => {
  assert.equal(normalizeCardSettings(null).enabled, false);
  assert.deepEqual(normalizeCardSettings({}).zones.map((z) => z.key), ["gym"]);
  assert.deepEqual(normalizeCardSettings({ zones: [{ key: "room", nameEl: "x" }, { key: "pool", nameEl: "Πισίνα" }, { key: "Bad Key", nameEl: "y" }] }).zones.map((z) => z.key), ["pool"]);
  for (const l of ["el", "en", "fr", "de", "it", "es"] as const) for (const k of Object.keys(cardTexts.en)) assert.ok(cardTexts[l][k as keyof typeof cardTexts.en], `${l}.${k}`);
  const m = cardEmail("el", { name: "Γιώργος", link: "https://x/card/abc", from: Date.parse("2026-07-10T11:00:00Z"), until: Date.parse("2026-07-13T08:00:00Z"), room: "102" });
  assert.match(m.body, /Γιώργος/); assert.match(m.body, /https:\/\/x\/card\/abc/); assert.match(m.body, /11:00/); assert.match(m.body, /Δωμάτιο 102/);
});

test("zip store: valid local headers, CRC and central directory", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const z = zipStore([{ name: "a.txt", data: Buffer.from("hello") }, { name: "b.json", data: Buffer.from("{}") }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  assert.equal(z.readUInt16LE(end + 10), 2);
});

test("cms: DER encoding and a self-verifying certificate request", async () => {
  const { der, newKeyAndCsr } = await import("../lib/cms.ts");
  const { createPrivateKey, createPublicKey, verify } = await import("node:crypto");
  assert.equal(der.oid("1.2.840.113549.1.7.2").toString("hex"), "06092a864886f70d010702");
  assert.equal(der.int(128).toString("hex"), "02020080");
  assert.equal(der.setOf(Buffer.from([2]), Buffer.from([1])).toString("hex"), "31020102");
  const { privateKeyPem, csrPem } = newKeyAndCsr("pass.gr.hotelcorali.key", "info@hotelcorali.gr");
  const csr = Buffer.from(csrPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  // CertificationRequest ::= SEQUENCE { info, algorithm, BIT STRING signature }: the signature checks out with the key.
  const head = (at: number) => { let n = csr[at + 1], start = at + 2; if (n & 0x80) { const k = n & 0x7f; n = 0; for (let i = 0; i < k; i++) n = (n << 8) | csr[at + 2 + i]; start += k; } return { start, end: start + n }; };
  const outer = head(0), info = head(outer.start), alg = head(info.end), sig = head(alg.end);
  const ok = verify("sha256", csr.subarray(outer.start, info.end), createPublicKey(createPrivateKey(privateKeyPem)), csr.subarray(sig.start + 1, sig.end));
  assert.equal(ok, true);
});
