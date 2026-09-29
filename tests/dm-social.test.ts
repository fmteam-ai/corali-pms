import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { availabilityReply, bookingDeepLink, monthFromWord, parseStayRequest } from "../lib/dm-availability.ts";
import { tiktokMessage, validTikTokSignature } from "../lib/social.ts";
import { recommendExtras } from "../lib/upsell.ts";

const today = "2026-09-29";

test("stay requests are read from DMs in all six languages", () => {
  assert.deepEqual(parseStayRequest("Hi, a room 15-18 August for 2 adults and 1 child?", today), { checkIn: "2027-08-15", checkOut: "2027-08-18", adults: 2, children: 1 });
  assert.deepEqual(parseStayRequest("Καλησπέρα, 15/8 έως 18/8 για 3 άτομα", today), { checkIn: "2027-08-15", checkOut: "2027-08-18", adults: 3, children: 0 });
  assert.deepEqual(parseStayRequest("Bonjour, du 3 au 7 juillet 2027 ?", today)?.checkIn, "2027-07-03");
  assert.deepEqual(parseStayRequest("Hallo, 2026-10-10 bis 2026-10-14", today)?.checkOut, "2026-10-14");
  assert.deepEqual(parseStayRequest("Ciao, 20 dicembre - 3 gennaio", today), { checkIn: "2026-12-20", checkOut: "2027-01-03", adults: 2, children: 0 });
  assert.deepEqual(parseStayRequest("Hola, del 5.5 al 9.5, 2 adultos", today)?.checkIn ?? parseStayRequest("Hola 5.5-9.5", today)?.checkIn, "2027-05-05");
  assert.equal(parseStayRequest("October 3-5", today)?.checkIn, "2026-10-03");
  assert.equal(parseStayRequest("hello, is breakfast included?", today), null);
  assert.equal(parseStayRequest("1/10 - 30/12", today), null); // longer than 30 nights
  assert.equal(parseStayRequest("31/2 - 3/3", today), null); // invalid date
  assert.equal(monthFromWord("Αυγούστου"), 8);
  assert.equal(monthFromWord("août"), 8);
  assert.equal(monthFromWord("Mär"), 3);
  assert.equal(monthFromWord("the"), null);
});

test("DM drafts quote live rooms with a prefilled booking link, or say sold out", () => {
  const req = { checkIn: "2027-08-15", checkOut: "2027-08-18", adults: 2, children: 0 };
  const reply = availabilityReply("Hi, 15-18 August?", req, [{ name: "Double Sea View", fromCents: 45000, available: 2 }, { name: "Family Apartment", fromCents: 60000, available: 1 }, { name: "Suite", fromCents: 80000, available: 0 }], "https://booking.hotelcorali.gr/book", "instagram");
  assert.match(reply, /3 nights, 2 guests/);
  assert.match(reply, /Double Sea View: from €450/);
  assert.doesNotMatch(reply, /Suite/);
  assert.match(reply, /checkIn=2027-08-15&checkOut=2027-08-18&adults=2&children=0&lang=en&utm_source=instagram&utm_medium=dm/);
  const el = availabilityReply("Γεια σας 15/8-18/8", req, [], "https://b/book", "facebook");
  assert.match(el, /είμαστε πλήρεις/);
  assert.equal(bookingDeepLink("https://b/book?x=1", req, "de", "tiktok"), "https://b/book?x=1&checkIn=2027-08-15&checkOut=2027-08-18&adults=2&children=0&lang=de&utm_source=tiktok&utm_medium=dm");
});

test("TikTok webhooks are signed and DMs are extracted", () => {
  const body = JSON.stringify({ event: "im.receive_msg", content: JSON.stringify({ from_user_id: "u1", message_id: "m1", create_time: 1790000000, message: { text: "Room 1-3 June?" } }) });
  const t = 1790000100, sig = createHmac("sha256", "secret").update(`${t}.${body}`).digest("hex");
  assert.equal(validTikTokSignature(body, `t=${t},s=${sig}`, "secret", t + 10), true);
  assert.equal(validTikTokSignature(body, `t=${t},s=${sig}`, "secret", t + 1000), false); // replay window
  assert.equal(validTikTokSignature(body + " ", `t=${t},s=${sig}`, "secret", t), false);
  assert.equal(validTikTokSignature(body, null, "secret", t), false);
  assert.deepEqual(tiktokMessage(JSON.parse(body)), { senderId: "u1", text: "Room 1-3 June?", id: "m1", at: 1790000000000 });
  assert.equal(tiktokMessage({ event: "video.publish" }), null);
  assert.equal(tiktokMessage({ event: "im.receive_msg", content: "{bad" }), null);
});

test("upsell ranks extras bought on earlier stays first and never suggests breakfast", () => {
  const extras = [{ id: 1, code: "BREAKFAST", name: "Breakfast" }, { id: 2, code: "BOAT", name: "Boat trip" }, { id: 3, code: "WINE", name: "Bottle of wine" }, { id: 4, code: "TRANSFER", name: "Port transfer" }];
  const ctx = { adults: 2, children: 0, nights: 5, checkIn: "2027-07-10", bookingDate: "2027-03-01" };
  assert.deepEqual(recommendExtras(extras, ctx).map((r) => r.id), [2, 3, 4]);
  const withHistory = recommendExtras(extras, ctx, 3, { purchasedIds: [4, 1], stays: 2 });
  assert.deepEqual(withHistory.map((r) => [r.id, r.reason]), [[4, "history"], [2, "long_stay"], [3, "couple"]]);
  assert.ok(!withHistory.some((r) => r.id === 1));
});
