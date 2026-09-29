import assert from "node:assert/strict";
import test from "node:test";
import {assertStripeCheckoutMatches,stripeCheckoutIsPaid} from "../lib/stripe-fulfillment.ts";
const booking={id:42,owner_id:"hotel-corali",token:"opaque",status:"payment_pending",payment_gateway:"stripe",payable_cents:5000};
const session={mode:"payment",payment_status:"paid",currency:"eur",amount_total:5000,metadata:{owner_id:"hotel-corali",booking_session_id:"42",token:"opaque"}};
test("Stripe fulfillment needs a paid session matching the original hold",()=>{
  assert.equal(stripeCheckoutIsPaid(session),true);
  assert.doesNotThrow(()=>assertStripeCheckoutMatches(session,booking));
  assert.throws(()=>assertStripeCheckoutMatches({...session,payment_status:"unpaid"},booking),/PAYMENT_NOT_CONFIRMED/);
  assert.throws(()=>assertStripeCheckoutMatches({...session,amount_total:4000},booking),/PAYMENT_AMOUNT_MISMATCH/);
  assert.throws(()=>assertStripeCheckoutMatches({...session,metadata:{...session.metadata,token:"wrong"}},booking),/PAYMENT_METADATA_MISMATCH/);
  assert.throws(()=>assertStripeCheckoutMatches(session,{...booking,status:"cancelled"}),/INVALID_BOOKING_STATE/);
});

test("multi-room allocation preserves every cent of charge and payment",async()=>{
  const {splitCents}=await import("../lib/stripe-fulfillment.ts");
  const charges=splitCents(10001,3),payments=splitCents(3001,3);
  assert.deepEqual(charges,[3334,3334,3333]);
  assert.deepEqual(payments,[1001,1000,1000]);
  assert.equal(charges.reduce((a,b)=>a+b,0),10001);
  assert.equal(payments.reduce((a,b)=>a+b,0),3001);
});
