import assert from "node:assert/strict";
import test from "node:test";
import { balanceChargeDays, calculatePayment, planPaymentTerms, type PaymentPolicy } from "../lib/payment-policy.ts";
import { dialCodes, flag, internationalPhone } from "../lib/dial-codes.ts";
import { fillPolicy, policyTextsFrom, defaultPolicyTexts } from "../lib/booking-policy.ts";

const general: PaymentPolicy = { fullPayment: false, depositPercent: 30, balanceDueDays: 5, fullPaymentWindowActive: true, fullPaymentDaysBeforeArrival: 7 };
const now = new Date("2026-09-29T10:00:00Z");

test("each rate plan can set its own deposit and balance timing", () => {
  const flexible = planPaymentTerms(general, { depositPercent: 20, balanceMode: "cancellation_deadline", balanceDaysBefore: null, fullPrepayment: false }, 14);
  assert.equal(flexible.autoChargeDays, 14);
  assert.deepEqual(calculatePayment(100000, "2026-12-01", flexible.policy, now), { mode: "deposit", payableNowCents: 20000, balanceCents: 80000, daysUntilArrival: 63 });
  // Arrival already inside the free-cancellation window: everything now.
  assert.equal(calculatePayment(100000, "2026-10-08", flexible.policy, now).payableNowCents, 100000);
  const nonRefundable = planPaymentTerms(general, { depositPercent: null, balanceMode: "general", balanceDaysBefore: null, fullPrepayment: true }, 14);
  assert.equal(calculatePayment(100000, "2026-12-01", nonRefundable.policy, now).payableNowCents, 100000);
  assert.equal(balanceChargeDays(nonRefundable), null);
  const atHotel = planPaymentTerms(general, { depositPercent: 50, balanceMode: "at_hotel", balanceDaysBefore: null, fullPrepayment: false }, 14);
  assert.equal(calculatePayment(100000, "2026-10-01", atHotel.policy, now).payableNowCents, 50000); // no window: balance at the hotel
  assert.equal(balanceChargeDays(atHotel), -1);
  const days = planPaymentTerms(general, { depositPercent: null, balanceMode: "days_before", balanceDaysBefore: 21, fullPrepayment: false }, 14);
  assert.equal(days.autoChargeDays, 21);
  assert.equal(days.policy.depositPercent, 30);
  const inherited = planPaymentTerms(general, null, 14);
  assert.equal(inherited.autoChargeDays, 7);
  assert.equal(planPaymentTerms({ ...general, fullPaymentWindowActive: false }, null, 14).atHotel, true);
});

test("guest phones get the international prefix for the chosen country", () => {
  assert.equal(internationalPhone("GR", "69 1234 5678"), "+30 6912345678");
  assert.equal(internationalPhone("DE", "0170 1234567"), "+49 1701234567");
  assert.equal(internationalPhone("IT", "06 1234567"), "+39 061234567"); // Italy keeps the leading zero
  assert.equal(internationalPhone("GB", "+44 7700 900123"), "+447700900123");
  assert.equal(internationalPhone("FR", "0033 6 12 34 56 78"), "+33612345678");
  assert.equal(dialCodes.GR, "30");
  assert.equal(flag("GR"), "🇬🇷");
});

test("policy texts default per language and fill plan details", () => {
  const texts = policyTextsFrom('{"el":"Δικό μας κείμενο","xx":"ignored"}');
  assert.equal(texts.el, "Δικό μας κείμενο");
  assert.equal(texts.de, defaultPolicyTexts.de);
  assert.equal(fillPolicy("{plan}: {cancellationDays} · {deposit} {balance}", { plan: "Flexible", cancellationDays: 14, deposit: "30%", balance: "later" }), "Flexible: 14 · 30% later");
});
