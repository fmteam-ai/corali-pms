import assert from "node:assert/strict";
import test from "node:test";
import { canUse, nextStatuses, offerInput, offerOpen, priceOrder, sortPartners } from "../lib/partners-core.ts";
import { matchPassCode, passCode, passQr, PASS_WINDOW_MS, verifyPassQr } from "../lib/guest-pass-core.ts";

const menu = [{ id: 1, name: "Burger", priceCents: 1000, active: true }, { id: 2, name: "Beer", priceCents: 450, active: true }, { id: 3, name: "Old", priceCents: 100, active: false }];
const offer = { id: 7, discountPercent: 10, code: "CORALI10", startsOn: "2026-10-01", endsOn: "2026-10-31", status: "approved", maxUses: 1, timeFrom: "", timeTo: "" };

test("priceOrder prices from the catalogue and merges lines", () => {
  const r = priceOrder(menu, [{ id: 1, qty: 2 }, { id: 2, qty: 1 }, { id: 1, qty: 1 }], [], "", "2026-10-28", 10);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.lines.length, 2);
  assert.equal(r.subtotalCents, 3450);
  assert.equal(r.totalCents, 3450);
  assert.equal(r.commissionCents, 345);
});

test("priceOrder rejects inactive or unknown items", () => {
  assert.deepEqual(priceOrder(menu, [{ id: 3, qty: 1 }], [], "", "2026-10-28", 0), { ok: false, error: "ITEM" });
  assert.deepEqual(priceOrder(menu, [{ id: 99, qty: 1 }], [], "", "2026-10-28", 0), { ok: false, error: "ITEM" });
});

test("priceOrder applies an approved current code, case-insensitive", () => {
  const r = priceOrder(menu, [{ id: 1, qty: 2 }], [offer], "corali10", "2026-10-28", 5);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.discountCents, 200);
  assert.equal(r.totalCents, 1800);
  assert.equal(r.commissionCents, 90);
  assert.equal(r.offerId, 7);
});

test("priceOrder: wrong, expired, pending or out-of-hours codes fail", () => {
  assert.deepEqual(priceOrder(menu, [{ id: 1, qty: 1 }], [offer], "NOPE", "2026-10-28", 0), { ok: false, error: "CODE" });
  assert.deepEqual(priceOrder(menu, [{ id: 1, qty: 1 }], [offer], "CORALI10", "2026-11-01", 0), { ok: false, error: "CODE" });
  assert.deepEqual(priceOrder(menu, [{ id: 1, qty: 1 }], [{ ...offer, status: "pending" }], "CORALI10", "2026-10-28", 0), { ok: false, error: "CODE" });
  assert.deepEqual(priceOrder(menu, [{ id: 1, qty: 1 }], [{ ...offer, timeFrom: "18:00", timeTo: "20:00" }], "CORALI10", "2026-10-28", 0, {}, "12:00"), { ok: false, error: "CODE" });
  assert.equal(priceOrder(menu, [{ id: 1, qty: 1 }], [{ ...offer, timeFrom: "18:00", timeTo: "20:00" }], "CORALI10", "2026-10-28", 0, {}, "19:15").ok, true);
});

test("priceOrder enforces uses per booking", () => {
  assert.deepEqual(priceOrder(menu, [{ id: 1, qty: 1 }], [offer], "CORALI10", "2026-10-28", 0, { 7: 1 }), { ok: false, error: "USED" });
  assert.equal(priceOrder(menu, [{ id: 1, qty: 1 }], [{ ...offer, maxUses: 3 }], "CORALI10", "2026-10-28", 0, { 7: 2 }).ok, true);
  assert.equal(priceOrder(menu, [{ id: 1, qty: 1 }], [{ ...offer, maxUses: null }], "CORALI10", "2026-10-28", 0, { 7: 40 }).ok, true);
});

test("canUse: once, N times, unlimited", () => {
  assert.equal(canUse(1, 0), true);
  assert.equal(canUse(1, 1), false);
  assert.equal(canUse(3, 2), true);
  assert.equal(canUse(null, 999), true);
});

test("offerOpen: date range and daily hours, also across midnight", () => {
  const o = { startsOn: "2026-10-10", endsOn: "2026-10-20" };
  assert.equal(offerOpen(o, "2026-10-09", "12:00"), false);
  assert.equal(offerOpen(o, "2026-10-10", "00:00"), true);
  assert.equal(offerOpen(o, "2026-10-20", "23:59"), true);
  const happy = { ...o, timeFrom: "17:00", timeTo: "19:00" };
  assert.equal(offerOpen(happy, "2026-10-15", "16:59"), false);
  assert.equal(offerOpen(happy, "2026-10-15", "17:00"), true);
  assert.equal(offerOpen(happy, "2026-10-15", "19:00"), false);
  const night = { ...o, timeFrom: "22:00", timeTo: "02:00" };
  assert.equal(offerOpen(night, "2026-10-15", "23:30"), true);
  assert.equal(offerOpen(night, "2026-10-15", "01:30"), true);
  assert.equal(offerOpen(night, "2026-10-15", "12:00"), false);
});

test("offerInput: code needs a discount, hours both or neither, dates in order", () => {
  const base = { titleEl: "−10%", startsOn: "2026-10-01", endsOn: "2026-10-31", discountPercent: 10 };
  assert.equal(offerInput.safeParse(base).success, true);
  assert.equal(offerInput.parse(base).maxUses, 1);
  assert.equal(offerInput.parse(base).guestsOnly, true);
  assert.equal(offerInput.safeParse({ ...base, discountPercent: null, code: "ABC" }).success, false);
  assert.equal(offerInput.safeParse({ ...base, timeFrom: "18:00" }).success, false);
  assert.equal(offerInput.safeParse({ ...base, endsOn: "2026-09-30" }).success, false);
  assert.equal(offerInput.safeParse({ ...base, maxUses: null }).success, true);
  assert.equal(offerInput.parse({ ...base, code: "corali-10" }).code, "CORALI-10");
});

test("sortPartners: hotel-guest offers first, best discount first", () => {
  const list = sortPartners([
    { name: "Zeta", sortOrder: 0, guestDiscount: null },
    { name: "Alpha", sortOrder: 0, guestDiscount: null },
    { name: "Bar", sortOrder: 5, guestDiscount: 10 },
    { name: "Cafe", sortOrder: 9, guestDiscount: 20 },
    { name: "Free drink", sortOrder: 0, guestDiscount: 0 },
  ]);
  assert.deepEqual(list.map((p) => p.name), ["Cafe", "Bar", "Free drink", "Alpha", "Zeta"]);
});

test("nextStatuses: only allowed steps", () => {
  assert.deepEqual(nextStatuses("placed"), ["accepted", "declined"]);
  assert.deepEqual(nextStatuses("accepted"), ["ready", "completed", "cancelled"]);
  assert.deepEqual(nextStatuses("completed"), []);
  assert.deepEqual(nextStatuses("declined"), []);
});

test("guest pass: QR verifies for this and the previous minute only", () => {
  const now = 1_790_000_000_000;
  const qr = passQr("s3cret", 42, now);
  assert.equal(verifyPassQr("s3cret", qr, now), 42);
  assert.equal(verifyPassQr("s3cret", qr, now + PASS_WINDOW_MS), 42);
  assert.equal(verifyPassQr("s3cret", qr, now + 2 * PASS_WINDOW_MS), null);
  assert.equal(verifyPassQr("other", qr, now), null);
  assert.equal(verifyPassQr("s3cret", qr.replace(":42:", ":43:"), now), null);
  assert.equal(verifyPassQr("s3cret", "garbage", now), null);
});

test("guest pass: 6-digit code matches its booking, expires after two minutes", () => {
  const now = 1_790_000_000_000;
  const code = passCode("s3cret", 42, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(matchPassCode("s3cret", code, [7, 42, 99], now), 42);
  assert.equal(matchPassCode("s3cret", code, [7, 42], now + PASS_WINDOW_MS), 42);
  assert.equal(matchPassCode("s3cret", code, [42], now + 2 * PASS_WINDOW_MS), null);
  assert.equal(matchPassCode("s3cret", "12ab56", [42], now), null);
});
