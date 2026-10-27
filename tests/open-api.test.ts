import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { bookingEvent, folioEvent, parseApiKey, retryDelayMs, sameHash, signWebhook, webhookUrlProblem } from "../scripts/open-api-core.mjs";

test("API keys are recognised only in the corali_<id>_<secret> form", () => {
  const key = `corali_ab12cd34_${"x".repeat(43)}`;
  assert.deepEqual(parseApiKey(`Bearer ${key}`), { key, prefix: "ab12cd34" });
  assert.deepEqual(parseApiKey(key), { key, prefix: "ab12cd34" });
  assert.equal(parseApiKey("Bearer corali_short_x"), null);
  assert.equal(parseApiKey(`Basic ${key}`), null);
  assert.equal(parseApiKey(null), null);
  assert.equal(sameHash("abc", "abc"), true);
  assert.equal(sameHash("abc", "abd"), false);
  assert.equal(sameHash("abc", "abcd"), false);
});

test("booking changes map to webhook events", () => {
  const cur = (status: string, fingerprint = "f1") => ({ status, fingerprint });
  assert.equal(bookingEvent(null, cur("confirmed")), "booking.created");
  assert.equal(bookingEvent(null, cur("cancelled")), null);
  assert.equal(bookingEvent(cur("confirmed"), cur("confirmed")), null);
  assert.equal(bookingEvent(cur("confirmed"), cur("confirmed", "f2")), "booking.updated");
  assert.equal(bookingEvent(cur("confirmed"), cur("cancelled")), "booking.cancelled");
  assert.equal(bookingEvent(cur("confirmed"), cur("no_show")), "booking.cancelled");
  assert.equal(bookingEvent(cur("confirmed"), cur("checked_in")), "booking.checked_in");
  assert.equal(bookingEvent(cur("checked_in"), cur("checked_out")), "booking.checked_out");
  assert.equal(folioEvent("charge"), "folio.charge");
  assert.equal(folioEvent("payment"), "folio.payment");
  assert.equal(folioEvent("discount"), null);
});

test("webhook signature is HMAC-SHA256 of t.body", () => {
  const body = '{"event":"ping"}', sig = signWebhook("whsec_test", body, 1_767_225_600_000);
  assert.equal(sig, `t=1767225600,v1=${createHmac("sha256", "whsec_test").update(`1767225600.${body}`).digest("hex")}`);
});

test("retries back off and stop after 10 tries; webhook addresses must be https", () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(4), 3_600_000);
  assert.equal(retryDelayMs(5), 3 * 3_600_000);
  assert.equal(retryDelayMs(10), null);
  assert.equal(webhookUrlProblem("https://pos.example.com/hook"), null);
  assert.equal(webhookUrlProblem("http://pos.example.com/hook"), "HTTPS");
  assert.equal(webhookUrlProblem("http://127.0.0.1:4555/hook"), null);
  assert.equal(webhookUrlProblem("https://user:pw@pos.example.com/"), "URL");
  assert.equal(webhookUrlProblem("not a url"), "URL");
});
