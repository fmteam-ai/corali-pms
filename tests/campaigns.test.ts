import assert from "node:assert/strict";
import test from "node:test";
import { audienceQuery, batchSize, campaignPresets, fill, normalizeAudience, normalizeContent, normalizePhone, pickContent, renderCampaignEmail, unsubscribeToken, validUnsubscribeToken, whatsappLanguage } from "../scripts/campaign-core.mjs";

test("content: trims, drops empty languages, falls back to English then Greek", () => {
  const c = normalizeContent({ el: { subject: " Γεια ", body: "Κείμενο" }, en: { subject: "", body: "" }, xx: { body: "no" } });
  assert.deepEqual(c, { el: { subject: "Γεια", body: "Κείμενο" } });
  assert.equal(pickContent(c, "de")?.body, "Κείμενο");
  assert.equal(pickContent({ en: { subject: "Hi", body: "EN" }, el: { subject: "", body: "EL" } }, "fr")?.body, "EN");
  assert.equal(pickContent({}, "en"), null);
});

test("audience filters are validated", () => {
  assert.deepEqual(normalizeAudience({ stayFrom: "2025-01-01", stayTo: "bad", countries: ["GR", "gr", "DE", "GR"], languages: ["el", "xx"], minStays: 99 }), { stayFrom: "2025-01-01", stayTo: "", countries: ["GR", "DE"], languages: ["el"], minStays: 10 });
  assert.equal(normalizeAudience(null).minStays, 1);
});

test("audience query binds every placeholder and keeps consent + unsubscribe checks", () => {
  for (const ch of ["email", "whatsapp"] as const) {
    const q = audienceQuery("hotel", { stayFrom: "2025-01-01", stayTo: "2025-12-31", countries: ["GR"], languages: ["el"], minStays: 2 }, ch, "2026-10-28");
    const max = Math.max(...[...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(max, q.params.length);
    assert.match(q.sql, /consent=1/);
    assert.match(q.sql, /marketing_unsubscribes/);
    assert.match(q.sql, /check_out<=\$2/);
    assert.match(q.sql, ch === "email" ? /email_marketing_opt_in/ : /whatsapp_opt_in/);
  }
});

test("first name fills {name}; empty name leaves no stray comma", () => {
  assert.equal(fill("Dear {name},", "Maria"), "Dear Maria,");
  assert.equal(fill("Dear {name},", ""), "Dear,");
});

test("e-mail: text + HTML with the unsubscribe link, escaped", () => {
  const m = renderCampaignEmail({ content: { en: { subject: "Hello {name}", body: "Hi {name} <b>\n\nhttps://booking.hotelcorali.gr" } }, lang: "en", name: "Anna Smith", unsubscribeUrl: "https://booking.example/unsubscribe?r=1&t=x", imageUrl: "https://booking.example/i.jpg" })!;
  assert.equal(m.subject, "Hello Anna");
  assert.match(m.text, /Unsubscribe: https:\/\/booking\.example\/unsubscribe\?r=1&t=x/);
  assert.match(m.html, /&lt;b&gt;/);
  assert.match(m.html, /href="https:\/\/booking\.example\/unsubscribe\?r=1&amp;t=x"/);
  assert.match(m.html, /<img src="https:\/\/booking\.example\/i\.jpg"/);
  assert.match(m.html, /<a href="https:\/\/booking\.hotelcorali\.gr"/);
});

test("unsubscribe token is per recipient and per secret", () => {
  const t = unsubscribeToken("s", 42);
  assert.equal(t.length, 32);
  assert.equal(validUnsubscribeToken("s", 42, t), true);
  assert.equal(validUnsubscribeToken("s", 43, t), false);
  assert.equal(validUnsubscribeToken("other", 42, t), false);
  assert.equal(validUnsubscribeToken("s", 42, "short"), false);
});

test("WhatsApp template language and phone numbers", () => {
  assert.equal(whatsappLanguage("el, en_US", "en"), "en_US");
  assert.equal(whatsappLanguage("el, en", "de"), "el");
  assert.equal(whatsappLanguage("", "el"), "");
  assert.equal(normalizePhone("+30 694 123 4567"), "306941234567");
  assert.equal(normalizePhone("123"), "");
});

test("rate per minute is limited; presets exist in six languages", () => {
  assert.equal(batchSize(0), 20);
  assert.equal(batchSize(500), 120);
  for (const p of Object.values(campaignPresets)) for (const l of ["el", "en", "fr", "de", "it", "es"] as const) { assert.ok(p[l].subject); assert.match(p[l].body, /\{name\}/); }
});
