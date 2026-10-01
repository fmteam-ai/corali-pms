import assert from "node:assert/strict";
import test from "node:test";
import { detectTopics, faqAnswer } from "../lib/assistant-faq.ts";
import { defaultPolicyTexts } from "../lib/booking-policy.ts";

const text = { fallback: "FALLBACK", transfer: "TRANSFER", manage: "MANAGE", rooms: "ROOMS" };

test("detects topics in several languages", () => {
  assert.deepEqual(detectTopics("Can I cancel for free?"), ["cancel"]);
  assert.ok(detectTopics("Υπάρχει ασανσέρ;").includes("access"));
  assert.ok(detectTopics("Wann ist der Check-in?").includes("arrival"));
  assert.ok(detectTopics("¿Hay traslado desde el aeropuerto?").includes("transfer"));
});

test("answers from the policy paragraph in the guest's language", () => {
  const el = faqAnswer("Μέχρι πότε μπορώ να ακυρώσω;", defaultPolicyTexts.el, text);
  assert.match(el, /Ακυρώσεις/);
  const en = faqAnswer("What time is check-in?", defaultPolicyTexts.en, text);
  assert.match(en, /15:00/);
  assert.match(faqAnswer("Is there a lift? I have heavy luggage", defaultPolicyTexts.en, text), /50 steps/);
  assert.equal(faqAnswer("Do you have a transfer from the port?", defaultPolicyTexts.en, text), "TRANSFER");
  assert.equal(faqAnswer("Tell me a joke", defaultPolicyTexts.en, text), "FALLBACK");
});

test("answers price questions from the guest's current search", () => {
  const ctx = "Dates: 2026-10-04 to 2026-10-08 (4 nights)\nDouble: 3 available; Flexible total €380.00; Non-refundable total €342.00\nApartment: 2 available; Flexible total €480.00";
  assert.match(faqAnswer("How much is the double?", "", text, ctx), /^Double: 3 available/);
  assert.equal(faqAnswer("Πόσο κοστίζει;", "", text, ctx).split("\n").length, 2);
  assert.equal(faqAnswer("How much?", "", text, ""), "ROOMS");
});
