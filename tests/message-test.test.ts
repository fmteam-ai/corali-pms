import assert from "node:assert/strict";
import test from "node:test";
import { metaDiagnosis, sampleValues, smtpDiagnosis, whatsappNumber } from "../lib/message-test.ts";

test("test sends: numbers, sample values and error diagnoses", () => {
  assert.equal(whatsappNumber("+30 694 123 4567"), "306941234567");
  assert.equal(whatsappNumber("6941"), null);
  assert.equal(sampleValues("https://book.example/").link, "https://book.example/book");
  assert.equal(smtpDiagnosis(Object.assign(new Error("x"), { code: "EAUTH", responseCode: 535 })).hint, "auth");
  assert.equal(smtpDiagnosis(Object.assign(new Error("x"), { code: "ECONNREFUSED" })).code, "SMTP_ECONNREFUSED");
  assert.equal(smtpDiagnosis(new Error("EMAIL_NOT_CONFIGURED")).hint, "not_configured");
  assert.equal(smtpDiagnosis({ responseCode: 553 }).hint, "rejected");
  const meta = metaDiagnosis(400, { error: { code: 131030, message: "Recipient phone number not in allowed list", error_data: { details: "Recipient not allowed" } } });
  assert.deepEqual(meta, { code: "WHATSAPP_131030", hint: "recipient_not_allowed", detail: "Recipient not allowed" });
  assert.equal(metaDiagnosis(401, {}).hint, "token");
  assert.equal(metaDiagnosis(404, { error: { code: 132001 } }).hint, "template");
});
