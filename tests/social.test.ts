import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { canApprove, postTransition, validMetaSignature } from "../lib/social.ts";
import { detectLanguage, suggestedReply } from "../lib/social-reply.ts";

test("posts need explicit approval before publishing", () => {
  assert.equal(postTransition("draft", "submit"), "pending_approval");
  assert.equal(postTransition("pending_approval", "approve"), "approved");
  assert.equal(postTransition("pending_approval", "reject"), "rejected");
  assert.equal(postTransition("draft", "approve"), null, "cannot approve a draft directly");
  assert.equal(postTransition("published", "edit"), null);
  assert.equal(postTransition("approved", "withdraw"), "draft");
  assert.equal(canApprove(3, 3, "admin"), false, "authors cannot approve their own post");
  assert.equal(canApprove(3, 4, "admin"), true);
  assert.equal(canApprove(1, 1, "owner"), true);
});

test("Meta webhooks are verified and replies are localized", () => {
  const body = '{"object":"page"}';
  const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(validMetaSignature(body, sig, "secret"), true);
  assert.equal(validMetaSignature(body, sig, "other"), false);
  assert.equal(validMetaSignature(body, null, "secret"), false);
  assert.equal(detectLanguage("Καλησπέρα, έχετε δωμάτιο;"), "el");
  assert.equal(detectLanguage("Hallo, habt ihr ein Zimmer frei?"), "de");
  assert.equal(detectLanguage("Hi there"), "en");
  const reply = suggestedReply("Bonjour, une chambre pour 2?", "https://booking.hotelcorali.gr/book", "instagram");
  assert.match(reply, /^Bonjour/);
  assert.match(reply, /book\?lang=fr&utm_source=instagram&utm_medium=dm/);
});
