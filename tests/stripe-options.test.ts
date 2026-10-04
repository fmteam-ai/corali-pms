import assert from "node:assert/strict";
import test from "node:test";
import { bookingCheckoutParams, checkoutSecured, parseMetadata, parseNote, stripeOptions, stripeOptionsProblem } from "../lib/stripe-options.ts";

test("Stripe options default safely and validate", () => {
  const d = stripeOptions(null);
  assert.deepEqual([d.paymentType, d.submitType, d.automaticMethods, d.futureUsage, d.extendedAuth, d.companyName, d.imageUrl], ["capture", "book", true, false, false, "Hotel Corali", null]);
  const o = stripeOptions({ paymentType: "authorization", submitType: "pay", automaticMethods: "no", extendedAuth: "yes", imageUrl: "javascript:alert(1)", checkoutNote: '{"el":"Γεια","xx":"no"}' });
  assert.deepEqual([o.paymentType, o.submitType, o.automaticMethods, o.extendedAuth, o.imageUrl], ["authorization", "pay", false, true, null]);
  assert.deepEqual(o.checkoutNote, { el: "Γεια" });
  assert.deepEqual(parseNote("not json"), {});
  assert.equal(stripeOptionsProblem({ paymentType: "steal" }), "paymentType");
  assert.equal(stripeOptionsProblem({ imageUrl: "http://x.gr/a.png" }), "imageUrl");
  assert.equal(stripeOptionsProblem({ checkoutNote: "[1]" }), "checkoutNote");
  assert.equal(stripeOptionsProblem({ paymentType: "off_session", futureUsage: "yes", imageUrl: "https://www.hotelcorali.gr/logo.png" }), null);
});

test("metadata never overrides the PMS's own keys", () => {
  assert.deepEqual(parseMetadata("source=website\nOwner_ID=evil; booking_session_id=1; bad key=x; channel = direct"), { source: "website", channel: "direct" });
});

test("checkout parameters per payment type", () => {
  const capture = bookingCheckoutParams(stripeOptions({}), false);
  assert.deepEqual(capture, { submit_type: "book", payment_intent_data: {} });
  const hold = bookingCheckoutParams(stripeOptions({ paymentType: "authorization", extendedAuth: "yes", automaticMethods: "no" }), true);
  assert.deepEqual(hold.payment_intent_data, { capture_method: "manual", setup_future_usage: "off_session" });
  assert.deepEqual(hold.payment_method_options, { card: { request_extended_authorization: "if_available" } });
  assert.deepEqual(hold.payment_method_types, ["card"]);
  assert.equal(hold.customer_creation, "always");
  assert.equal(bookingCheckoutParams(stripeOptions({ paymentType: "capture", extendedAuth: "yes" }), false).payment_method_options, undefined, "extended authorization only with holds");
});

test("which completed checkouts secure a booking", () => {
  assert.equal(checkoutSecured({ mode: "payment", payment_status: "paid" }, "succeeded", null), "paid");
  assert.equal(checkoutSecured({ mode: "payment", payment_status: "unpaid" }, "requires_capture", null), "authorized");
  assert.equal(checkoutSecured({ mode: "setup", status: "complete", payment_status: "no_payment_required" }, null, "succeeded"), "card_saved");
  assert.equal(checkoutSecured({ mode: "payment", payment_status: "unpaid" }, "requires_payment_method", null), null);
  assert.equal(checkoutSecured({ mode: "setup", status: "complete" }, null, "requires_action"), null);
});

test("card processing fee on the reservation total", async () => {
  const { cardFeeCents, parseFee } = await import("../lib/stripe-options.ts");
  const pct = parseFee({ feeMode: "charge", feeValue: "2.48", feeType: "percent" });
  assert.deepEqual(pct, { mode: "charge", type: "percent", value: 2.48 });
  assert.equal(cardFeeCents(22400, pct), 556);
  assert.equal(cardFeeCents(22400, parseFee({ feeMode: "discount", feeValue: "1,5", feeType: "fixed" })), -150);
  assert.equal(cardFeeCents(22400, parseFee({ feeMode: "charge", feeValue: "", feeType: "percent" })), 0);
  assert.equal(cardFeeCents(22400, parseFee({ feeMode: "none", feeValue: "3" })), 0);
  assert.equal(stripeOptionsProblem({ feeMode: "charge", feeValue: "25", feeType: "percent" }), "feeValue");
  assert.equal(stripeOptionsProblem({ feeMode: "charge", feeValue: "2.48", feeType: "percent" }), null);
});
