import assert from "node:assert/strict";
import test from "node:test";
import { parseWhatsAppWebhook, waDigits, waMessageText } from "../lib/whatsapp-inbox-core.ts";

const delivery = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "13025873741", phone_number_id: "1522646964254518" }, contacts: [{ wa_id: "306912345678", profile: { name: "Maria P." } }], messages, ...extra } }] }],
});

test("WhatsApp webhook: guest text messages with name, number and time", () => {
  const out = parseWhatsAppWebhook(delivery([{ from: "306912345678", id: "wamid.A1", timestamp: "1794700000", type: "text", text: { body: "  Τι ώρα είναι το check-in; " } }]));
  assert.deepEqual(out, [{ phoneNumberId: "1522646964254518", from: "306912345678", name: "Maria P.", id: "wamid.A1", createdAt: 1794700000000, text: "Τι ώρα είναι το check-in;" }]);
});

test("WhatsApp webhook: statuses, other objects and empty messages are ignored", () => {
  assert.deepEqual(parseWhatsAppWebhook(delivery([], { statuses: [{ id: "wamid.X", status: "read" }] })), []);
  assert.deepEqual(parseWhatsAppWebhook({ object: "page", entry: [] }), []);
  assert.deepEqual(parseWhatsAppWebhook(null), []);
  assert.deepEqual(parseWhatsAppWebhook(delivery([{ from: "30", id: "wamid.B", type: "text", text: { body: "   " } }])), []);
  assert.deepEqual(parseWhatsAppWebhook(delivery([{ id: "wamid.C", type: "text", text: { body: "hi" } }])), []);
});

test("WhatsApp messages other than text become readable labels", () => {
  assert.equal(waMessageText({ type: "image", image: { caption: "Η θέα!" } }), "[📷 Φωτογραφία — δείτε το στο WhatsApp Manager] Η θέα!");
  assert.equal(waMessageText({ type: "audio" }), "[🎤 Ηχητικό μήνυμα — δείτε το στο WhatsApp Manager]");
  assert.equal(waMessageText({ type: "document", document: { filename: "passport.pdf" } }), "[📄 Έγγραφο passport.pdf — δείτε το στο WhatsApp Manager]");
  assert.equal(waMessageText({ type: "location", location: { name: "Port", latitude: 37.08, longitude: 25.15 } }), "[📍 Τοποθεσία: Port] https://maps.google.com/?q=37.08,25.15");
  assert.equal(waMessageText({ type: "button", button: { text: "Yes" } }), "Yes");
  assert.equal(waMessageText({ type: "interactive", interactive: { button_reply: { title: "Late check-out" } } }), "Late check-out");
  assert.equal(waMessageText({ type: "reaction", reaction: { emoji: "👍" } }), "[👍]");
  assert.equal(waMessageText({ type: "unsupported" }), "[Μήνυμα τύπου «unsupported»]");
});

test("guest phones match WhatsApp numbers", () => {
  assert.equal(waDigits("+30 691 234 5678"), "306912345678");
  assert.equal(waDigits("0030 6912345678"), "306912345678");
  assert.equal(waDigits(null), "");
});
