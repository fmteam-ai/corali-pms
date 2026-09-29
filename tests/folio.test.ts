import assert from "node:assert/strict";
import test from "node:test";
import {refundAllowed,signedFolioAmount} from "../lib/folio.ts";
test("refund never exceeds payments after earlier refunds",()=>{
 assert.equal(refundAllowed(4000,5000),true);
 assert.equal(refundAllowed(5001,5000),false);
 assert.equal(refundAllowed(1,0),false);
 assert.equal(refundAllowed(-1,5000),false);
 assert.equal(signedFolioAmount("payment",4000),-4000);
 assert.equal(signedFolioAmount("refund",2000),2000);
 assert.throws(()=>signedFolioAmount("charge",0));
});

import { evenNights, impliedInitialPayment, reconcileNights, stayDates, summarizeFolio } from "../lib/folio.ts";

test("discounts are credits and adjustments are debits", () => {
  assert.equal(signedFolioAmount("discount", 1500), -1500);
  assert.equal(signedFolioAmount("adjustment", 1500), 1500);
});

test("nightly rates split a total without losing cents", () => {
  const nights = evenNights(10001, "2026-09-29", "2026-10-02");
  assert.deepEqual(nights.map((n) => n.amount_cents), [3334, 3334, 3333]);
  assert.deepEqual(nights.map((n) => n.stay_date), ["2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.deepEqual(evenNights(5000, "2026-10-02", "2026-10-02"), []);
  assert.deepEqual(stayDates("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01"]);
});

test("folio summary groups categories and payers", () => {
  const s = summarizeFolio(
    [{ stay_date: "2026-09-29", amount_cents: 10000, payer: "company" }, { stay_date: "2026-09-30", amount_cents: 8000, payer: "guest" }],
    [
      { entry_type: "charge", category: "extra", amount_cents: 2000, payer: "guest" },
      { entry_type: "charge", category: "tax", amount_cents: 400, payer: "guest" },
      { entry_type: "discount", category: "other", amount_cents: -1000, payer: "guest" },
      { entry_type: "adjustment", category: "other", amount_cents: 300, payer: "agency" },
      { entry_type: "payment", category: "other", amount_cents: -5000, payer: "guest" },
      { entry_type: "refund", category: "other", amount_cents: 1000, payer: "guest" },
      { entry_type: "payment", category: "other", amount_cents: -10000, payer: "company" },
    ],
  );
  assert.equal(s.accommodation, 18000);
  assert.equal(s.extras, 2000);
  assert.equal(s.taxes, 400);
  assert.equal(s.discounts, 1000);
  assert.equal(s.adjustments, 300);
  assert.equal(s.charges, 19700);
  assert.equal(s.payments, 15000);
  assert.equal(s.refunds, 1000);
  assert.equal(s.balance, 5700);
  assert.deepEqual(s.byPayer.company, { charges: 10000, paid: 10000, balance: 0 });
  assert.deepEqual(s.byPayer.guest, { charges: 9400, paid: 4000, balance: 5400 });
  assert.deepEqual(s.byPayer.agency, { charges: 300, paid: 0, balance: 300 });
  assert.equal(s.byPayer.guest.balance + s.byPayer.company.balance + s.byPayer.agency.balance, s.balance);
});

test("moving a stay keeps nightly rates and payers in order", () => {
  const current = [
    { stay_date: "2026-09-29", amount_cents: 10000, original_cents: 8000, payer: "guest" },
    { stay_date: "2026-09-30", amount_cents: 9000, original_cents: 9000, payer: "company" },
  ];
  assert.deepEqual(reconcileNights(current, "2026-10-05", "2026-10-07").map((n) => [n.stay_date, n.amount_cents, n.payer]), [["2026-10-05", 10000, "guest"], ["2026-10-06", 9000, "company"]]);
  assert.deepEqual(reconcileNights(current, "2026-10-05", "2026-10-08").map((n) => n.amount_cents), [10000, 9000, 9000]);
  assert.deepEqual(reconcileNights(current, "2026-10-05", "2026-10-06").map((n) => n.amount_cents), [10000]);
  assert.deepEqual(reconcileNights([], "2026-10-05", "2026-10-06"), []);
});

test("legacy bookings recover the payment taken at booking time", () => {
  assert.equal(impliedInitialPayment(40000, 15000, []), 25000);
  assert.equal(impliedInitialPayment(40000, 0, [-10000]), 30000);
  assert.equal(impliedInitialPayment(40000, 50000, []), 0);
  assert.equal(impliedInitialPayment(40000, 42000, [2000]), 0);
});
