import assert from "node:assert/strict";
import test from "node:test";
import { encryptField } from "../lib/security/encryption.ts";
import { publicProvider, validateProviderFields } from "../lib/provider-public.ts";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.SESSION_SECRET ??= "unit-test-session-secret-longer-than-thirty-two-bytes";
process.env.PMS_DOCUMENT_KEY ??= "unit-test-document-key-longer-than-thirty-two-bytes";
process.env.PMS_ORIGIN ??= "https://pms.hotelcorali.gr";
process.env.BOOKING_ORIGIN ??= "https://booking.hotelcorali.gr";

test("provider API view never contains secret values", () => {
  const key=process.env.PMS_DOCUMENT_KEY!;
  const view=publicProvider({provider_key:"stripe",active:1,status:"configured",settings_json:JSON.stringify({publishableKey:"pk_test_example"}),secrets_encrypted:encryptField(JSON.stringify({secretKey:"sk_test_private",webhookSecret:"whsec_private"}),key),last_test_at:null,last_test_result:null});
  assert.equal(view.secretConfigured.secretKey,true);
  assert.equal(JSON.stringify(view).includes("sk_test_private"),false);
  assert.equal(JSON.stringify(view).includes("whsec_private"),false);
});

test("provider forms reject unknown fields and invalid Stripe secrets", () => {
  assert.throws(()=>validateProviderFields("stripe",{unexpected:"value"},{secretKey:"sk_test_private"}),/INVALID_FIELDS/);
  assert.throws(()=>validateProviderFields("stripe",{}, {secretKey:"invalid"}),/INVALID_FIELDS/);
});
