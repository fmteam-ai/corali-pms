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
test("pre-arrival goes 72 hours ahead, welcome on arrival day, pre-departure the evening before",()=>{
 const b={check_in:"2026-07-15",check_out:"2026-07-19",created_at:1},s={review_days_after_checkout:2,send_hour:10};
 assert.equal(new Date(scheduleFor("pre_arrival",b,s)).toISOString(),"2026-07-12T12:00:00.000Z"); // 15:00 Athens, 3 days before
 assert.equal(new Date(scheduleFor("welcome",b,s)).toISOString(),"2026-07-15T13:00:00.000Z");
 assert.equal(new Date(scheduleFor("pre_departure",b,{...s,pre_departure_hour:19})).toISOString(),"2026-07-18T16:00:00.000Z");
 const now=new Date("2026-07-15T10:00:00Z"),stay={status:"confirmed",check_in:"2026-07-15",check_out:"2026-07-19",balance_cents:0};
 assert.equal(eligible("welcome",stay,now),true);
 assert.equal(eligible("welcome",{...stay,check_in:"2026-07-14"},now),false);
 assert.equal(eligible("pre_departure",stay,now),false); // not checked in yet
 assert.equal(eligible("pre_departure",{...stay,status:"checked_in"},now),true);
 assert.equal(eligible("pre_departure",{...stay,status:"checked_in",check_out:"2026-07-15"},now),false);
 assert.equal(eligible("pre_arrival",{...stay,check_in:"2026-07-18"},now),true);
 assert.equal(eligible("pre_arrival",{...stay,status:"cancelled",check_in:"2026-07-18"},now),false);
 assert.equal(interpolate("{{arrival}}",{arrival:"Parikia port"}),"Parikia port");
});
test("WhatsApp template parameters follow the documented order",async()=>{
 const {whatsappVariables}=await import("../scripts/automation-core.mjs");
 const v={name:"Anna",reference:"CR-1",checkIn:"2026-07-15",checkOut:"2026-07-19",amount:"€10",link:"https://x",arrival:"a"};
 assert.deepEqual(whatsappVariables("pre_arrival",v),["Anna","2026-07-15","https://x"]);
 assert.deepEqual(whatsappVariables("pre_arrival",{...v,link:""}),["Anna","2026-07-15","-"]);
 assert.deepEqual(whatsappVariables("welcome",v),["Anna"]);
 assert.deepEqual(whatsappVariables("pre_departure",v),["Anna","2026-07-19"]);
 assert.deepEqual(whatsappVariables("review",v),["Anna","https://x"]);
});
test("review shield sends 4-5 stars to public sites and 1-3 stars to the private form",async()=>{
 const {reviewRoute}=await import("../lib/review.ts");
 assert.deepEqual([1,2,3,4,5].map(reviewRoute),["private","private","private","public","public"]);
 assert.equal(reviewRoute(0),null);assert.equal(reviewRoute(4.5),null);assert.equal(reviewRoute("5"),"public");
});
test("stored templates are completed with defaults for newly added events",async()=>{
 const {withDefaultTemplates}=await import("../lib/message-templates.ts");
 const custom={confirmation:{el:{subject:"Δικό μου",body:"Κείμενο {{reference}}",whatsappTemplate:"x"}}};
 const merged=withDefaultTemplates(custom);
 assert.equal(merged.confirmation.el.subject,"Δικό μου");
 assert.equal(merged.confirmation.en.subject,defaultTemplates.confirmation.en.subject);
 assert.ok(merged.pre_arrival.fr.body.includes("{{arrival}}"));
});
test("settings read as strings from BIGINT columns still schedule correctly",()=>{
 const b={check_in:"2026-09-24",check_out:"2026-09-27",created_at:1};
 assert.equal(scheduleFor("review",b,{review_days_after_checkout:"2",send_hour:"10"} as never),greekTime("2026-09-27",2,10));
 assert.equal(scheduleFor("checkin",b,{review_days_after_checkout:2,send_hour:"10",checkin_days_before:"3"} as never),greekTime("2026-09-24",-3,10));
});
