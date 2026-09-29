import {test} from "node:test";
import assert from "node:assert/strict";
import {greekTime,scheduleFor,eligible,interpolate} from "../scripts/automation-core.mjs";
import {assertBalanceCheckout} from "../lib/balance-payment.ts";
import {bookingLanguages} from "../lib/booking-i18n.ts";
import {defaultTemplates,messageEvents,requiredVariables,renderTemplate} from "../lib/message-templates.ts";
test("Athens schedule respects winter and summer offsets",()=>{
 assert.equal(new Date(greekTime("2026-01-15",-3,10)).toISOString(),"2026-01-12T08:00:00.000Z");
 assert.equal(new Date(greekTime("2026-07-15",-3,10)).toISOString(),"2026-07-12T07:00:00.000Z");
 assert.equal(scheduleFor("review",{check_out:"2026-07-15",check_in:"2026-07-12",created_at:1},{review_days_after_checkout:2,send_hour:10}),greekTime("2026-07-15",2,10));
});
test("only eligible bookings receive balance or review messages",()=>{
 const now=new Date("2026-09-28T14:00:00Z"),booking={status:"confirmed",check_in:"2026-09-29",check_out:"2026-10-01",balance_cents:1500};
 assert.equal(eligible("balance",booking,now),true);assert.equal(eligible("balance",{...booking,balance_cents:0},now),false);assert.equal(eligible("review",booking,now),false);assert.equal(eligible("checkin",{...booking,checkin_submitted:true},now),false);assert.equal(eligible("review",{...booking,status:"checked_out",check_out:"2026-09-26"},now),true);
});
test("templates in six languages retain mandatory amount and links",()=>{
 for(const event of messageEvents)for(const lang of bookingLanguages){const body=defaultTemplates[event][lang].body;for(const variable of requiredVariables(event))assert.ok(body.includes(`{{${variable}}}`));assert.ok(defaultTemplates[event][lang].subject)}
 assert.equal(renderTemplate("{{amount}} · {{link}}",{amount:"10,00 €",link:"https://booking.example/pay"}),"10,00 € · https://booking.example/pay");
 assert.equal(interpolate("{{reference}}",{reference:"CR-123"}),"CR-123");
});
test("Stripe balance payment must match current amount, owner and pending link",()=>{
 assert.doesNotThrow(()=>assertBalanceCheckout(12500,12500,"checkout_pending","hotel-corali","hotel-corali"));
 for(const [amount,balance,status,owner,expected] of [[12500,12000,"checkout_pending","hotel-corali","hotel-corali"],[12500,12500,"paid","hotel-corali","hotel-corali"],[12500,12500,"checkout_pending","other","hotel-corali"]] as const)assert.throws(()=>assertBalanceCheckout(amount,balance,status,owner,expected));
});
