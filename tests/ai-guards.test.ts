import assert from "node:assert/strict";
import test from "node:test";
import { autoReplyBlocked } from "../lib/guest-message-rules.ts";
import { clampRecommendation, weeklyRows, type DayRow } from "../lib/pricing-ai-core.ts";

test("auto-reply guard sends money, changes, cancellations and complaints to reception", () => {
  for (const t of ["Can I get a refund?", "Θέλω να ακυρώσω την κράτηση", "I feel ill", "We lost a bag", "Μπορούμε να αλλάξουμε ημερομηνίες;", "The room was dirty", "Je voudrais annuler", "Wann wird meine Karte belastet?", "Quanto costa il prezzo?", "¿Puedo pagar en efectivo? quiero un descuento", "", "   "]) assert.equal(autoReplyBlocked(t), true, t);
  for (const t of ["What time is check-in? We will arrive late", "Τι ώρα είναι το check-in;", "Is there parking near the hotel?", "Πόσο απέχει η παραλία;", "Avez-vous le wifi ?"]) assert.equal(autoReplyBlocked(t), false, t);
});

const day = (date: string, roomType: string, occupied: number, extra: Partial<DayRow> = {}): DayRow => ({ date, roomType, total: 4, occupied, rateCents: 10000, lastYear: null, recent: 0, ...extra });

test("weekly rows aggregate occupancy, last year and competitor rates per category and week", () => {
  const days = [day("2026-07-01", "Double", 2, { lastYear: 4, recent: 1 }), day("2026-07-02", "Double", 4, { rateCents: 12000 }), day("2026-07-08", "Double", 0), day("2026-07-01", "Studio", 1, { total: 0 })];
  const comp = new Map([["2026-07-01", [9000, 15000]], ["2026-07-02", [11000]]]);
  const rows = weeklyRows("2026-07-01", days, comp);
  assert.equal(rows.length, 2); // Studio has no sellable rooms
  assert.deepEqual(rows[0], { roomType: "Double", startsOn: "2026-07-01", endsOn: "2026-07-07", rooms: 4, rateEur: 110, occupancy: 75, lastYearOccupancy: 100, recentBookings: 1, compMedianEur: 110, compMinEur: 90, compMaxEur: 150 });
  assert.equal(rows[1].startsOn, "2026-07-08");
  assert.equal(rows[1].compMedianEur, null);
});

test("AI price recommendations are clamped to ±35% and dropped for unknown categories or bad dates", () => {
  const weeks = weeklyRows("2026-07-01", [day("2026-07-01", "Double", 2), day("2026-07-08", "Double", 2, { rateCents: 12000 })], new Map());
  const base = { room_type: "Double", starts_on: "2026-07-01", ends_on: "2026-07-14", confidence: "medium" as const, reasoning: "" };
  assert.deepEqual([clampRecommendation({ ...base, recommended_rate_eur: 500 }, weeks)?.recommended_rate_eur, clampRecommendation({ ...base, recommended_rate_eur: 500 }, weeks)?.current_rate_eur], [149, 110]);
  assert.equal(clampRecommendation({ ...base, recommended_rate_eur: 10 }, weeks)?.recommended_rate_eur, 72);
  assert.equal(clampRecommendation({ ...base, recommended_rate_eur: 121.4 }, weeks)?.change_percent, 10);
  assert.equal(clampRecommendation({ ...base, room_type: "Suite", recommended_rate_eur: 120 }, weeks), null);
  assert.equal(clampRecommendation({ ...base, ends_on: "2026-06-30", recommended_rate_eur: 120 }, weeks), null);
  assert.equal(clampRecommendation({ ...base, starts_on: "July", recommended_rate_eur: 120 }, weeks), null);
});
