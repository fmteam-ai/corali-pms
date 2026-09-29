import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { channelYield, compsetIndex, lastYear, median, onTheBooks, paceByMonth, paceCurve, variancePercent, type Stay } from "../lib/revenue-analytics.ts";
import { applyCompset, type Suggestion } from "../lib/pricing-suggestions.ts";
import { buildRateUrl, parseManualRates, parseRates } from "../scripts/rate-shopper-core.mjs";

const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
const stay = (check_in: string, check_out: string, total: number, created: string, extra: Partial<Stay> = {}): Stay => ({ check_in, check_out, total_cents: total, created_at: at(created), cancelled_at: null, status: "confirmed", channel: "direct", ...extra });

test("on-the-books counts overlapping nights, prorates revenue and honours cancellation time", () => {
  const stays = [
    stay("2026-07-30", "2026-08-03", 40000, "2026-03-01"), // 2 nights in July, 2 in August
    stay("2026-08-10", "2026-08-12", 30000, "2026-06-01", { channel: "booking.com" }),
    stay("2026-08-05", "2026-08-07", 20000, "2026-05-01", { status: "cancelled", cancelled_at: at("2026-07-01") }),
    stay("2026-08-20", "2026-08-21", 10000, "2026-05-01", { status: "cancelled", cancelled_at: null }),
  ];
  assert.deepEqual(onTheBooks(stays, "2026-08-01", "2026-09-01", at("2026-09-01")), { roomNights: 4, revenueCents: 50000, bookings: 2 });
  // On 15 June the cancelled stay was still booked, the June booking already existed.
  assert.deepEqual(onTheBooks(stays, "2026-08-01", "2026-09-01", at("2026-06-15")), { roomNights: 6, revenueCents: 70000, bookings: 3 });
  assert.deepEqual(onTheBooks(stays, "2026-08-01", "2026-09-01", at("2026-04-01")), { roomNights: 2, revenueCents: 20000, bookings: 1 });
});

test("pace compares with the same time last year and measures pickup", () => {
  const stays = [
    stay("2025-08-10", "2025-08-14", 40000, "2025-02-01"),
    stay("2025-08-20", "2025-08-22", 20000, "2025-07-01"),
    stay("2026-08-10", "2026-08-15", 60000, "2026-02-01"),
    stay("2026-08-01", "2026-08-03", 25000, "2026-05-25"),
  ];
  const [row] = paceByMonth(stays, ["2026-08"], at("2026-05-31"), 10);
  assert.equal(row.capacity, 310);
  assert.equal(row.otb.roomNights, 7);
  assert.equal(row.stly.roomNights, 4); // the July-2025 booking did not exist yet on 31 May 2025
  assert.equal(row.lyFinal.roomNights, 6);
  assert.equal(row.pickup7, 2);
  assert.equal(row.pickup30, 2);
  assert.equal(variancePercent(7, 4), 75);
  assert.equal(variancePercent(0, 0), 0);
  assert.equal(variancePercent(3, 0), null);
  const curve = paceCurve(stays, "2026-08-01", "2026-09-01", [90, 30, 0]);
  assert.deepEqual(curve, [{ lead: 90, thisYear: 5, lastYear: 4 }, { lead: 30, thisYear: 7, lastYear: 6 }, { lead: 0, thisYear: 7, lastYear: 6 }]);
  assert.equal(lastYear("2028-02-29"), "2027-02-28");
});

test("channel yield deducts commission and payment fees to show true net revenue", () => {
  const stays = [
    stay("2026-08-01", "2026-08-03", 20000, "2026-01-01"),
    stay("2026-08-01", "2026-08-05", 48000, "2026-01-01", { channel: "booking.com" }),
    stay("2026-08-01", "2026-08-02", 9000, "2026-01-01", { channel: "booking.com", status: "cancelled", cancelled_at: at("2026-02-01") }),
  ];
  const rows = channelYield(stays, "2026-08-01", "2026-09-01", { direct: { commissionPercent: 0, paymentFeePercent: 1.5 }, "booking.com": { commissionPercent: 15, paymentFeePercent: 0 } });
  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
  assert.equal(byChannel["booking.com"].commissionCents, 7200);
  assert.equal(byChannel["booking.com"].netCents, 40800);
  assert.equal(byChannel["booking.com"].netAdrCents, 10200);
  assert.equal(byChannel["booking.com"].grossAdrCents, 12000);
  assert.equal(byChannel.direct.feeCents, 300);
  assert.equal(byChannel.direct.netAdrCents, 9850);
  assert.equal(byChannel["booking.com"].costPercent, 15);
  assert.equal(Math.round(rows.reduce((a, r) => a + r.netShare, 0)), 100);
});

test("competitor index and its effect on pricing suggestions", () => {
  assert.equal(median([12000, 10000, 0, 14000]), 12000);
  assert.equal(median([10000, 12000]), 11000);
  assert.equal(median([]), null);
  assert.deepEqual(compsetIndex(13500, [12000, 10000, 14000]), { median: 12000, index: 113, position: "above" });
  assert.deepEqual(compsetIndex(10000, [12000]), { median: 12000, index: 83, position: "below" });
  assert.equal(compsetIndex(12000, []).index, null);
  const base: Suggestion = { roomType: "double", startsOn: "2026-08-01", endsOn: "2026-08-03", percent: 15, reason: "high_demand", averageOccupancy: 0.9 };
  assert.equal(applyCompset(base, 120).percent, 5);
  assert.equal(applyCompset(base, 85).percent, 20);
  assert.equal(applyCompset(base, 100).compsetAdjusted, false);
  assert.equal(applyCompset({ ...base, percent: -15, reason: "very_low_close_in" }, 80).percent, -8);
  assert.equal(applyCompset(base, null).percent, 15);
});

test("rate shopper parses API responses and manual entries", () => {
  assert.equal(buildRateUrl("https://api.example.com/r?h=1&from={from}&to={to}", { from: "2026-10-01", to: "2026-11-30" }), "https://api.example.com/r?h=1&from=2026-10-01&to=2026-11-30");
  assert.throws(() => buildRateUrl("http://insecure.example.com/{from}", { from: "x" }), /HTTPS_REQUIRED/);
  assert.deepEqual(parseRates({ rates: [{ date: "2026-10-01", rate: 145 }, { stay_date: "2026-10-02", price: "152.50" }, { date: "2026-10-03", sold_out: true }, { date: "2027-01-01", rate: 99 }, { date: "bad", rate: 1 }] }, "2026-10-01", "2026-11-30"), [
    { date: "2026-10-01", rateCents: 14500, soldOut: false },
    { date: "2026-10-02", rateCents: 15250, soldOut: false },
    { date: "2026-10-03", rateCents: null, soldOut: true },
  ]);
  assert.deepEqual(parseRates({ "2026-10-05": 130, note: "x" }, "2026-10-01", "2026-10-31"), [{ date: "2026-10-05", rateCents: 13000, soldOut: false }]);
  assert.deepEqual(parseManualRates("2026-10-01;145\n2026-10-02, 150,50\n2026-10-03 sold\nnonsense\n2026-10-04;-5"), [
    { date: "2026-10-01", rateCents: 14500, soldOut: false },
    { date: "2026-10-02", rateCents: 15050, soldOut: false },
    { date: "2026-10-03", rateCents: null, soldOut: true },
  ]);
});

test("bookings record when they were cancelled (for pace history)", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../server/postgres-schema.sql", import.meta.url), "utf8"));
    const id = (await db.query<{ id: number }>(`INSERT INTO bookings(owner_id,reference,guest_name,check_in,check_out,created_at) VALUES('h','R1','G','2026-08-01','2026-08-03',1) RETURNING id`)).rows[0].id;
    assert.equal((await db.query<{ cancelled_at: number | null }>(`SELECT cancelled_at FROM bookings WHERE id=$1`, [id])).rows[0].cancelled_at, null);
    await db.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [id]);
    const first = Number((await db.query<{ cancelled_at: number }>(`SELECT cancelled_at FROM bookings WHERE id=$1`, [id])).rows[0].cancelled_at);
    assert.ok(first > 1_700_000_000_000);
    await db.query(`UPDATE bookings SET status='cancelled',guest_name='G2' WHERE id=$1`, [id]);
    assert.equal(Number((await db.query<{ cancelled_at: number }>(`SELECT cancelled_at FROM bookings WHERE id=$1`, [id])).rows[0].cancelled_at), first);
    await db.query(`UPDATE bookings SET status='confirmed' WHERE id=$1`, [id]);
    assert.equal((await db.query<{ cancelled_at: number | null }>(`SELECT cancelled_at FROM bookings WHERE id=$1`, [id])).rows[0].cancelled_at, null);
  } finally {
    await db.close();
  }
});
