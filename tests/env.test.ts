import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../lib/env.ts";

test("runtime configuration accepts blank optional provider settings", () => {
  const parsed = parseEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/corali",
    DATABASE_SSL: "false",
    DATABASE_SSL_CA: "",
    SESSION_SECRET: "runtime-session-secret-longer-than-thirty-two-bytes",
    PMS_ORIGIN: "https://pms.hotelcorali.gr",
    BOOKING_ORIGIN: "https://booking.hotelcorali.gr",
    PMS_OWNER_ID: "hotel-corali",
    PMS_DOCUMENT_KEY: "runtime-document-key-longer-than-thirty-two-bytes",
    APP_ROLE: "pms",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    SMTP_PORT: "",
    SMTP_FROM: "",
    OPENAI_API_KEY: "",
    WHATSAPP_ACCESS_TOKEN: "",
  });

  assert.equal(parsed.STRIPE_SECRET_KEY, undefined);
  assert.equal(parsed.STRIPE_WEBHOOK_SECRET, undefined);
  assert.equal(parsed.SMTP_FROM, undefined);
  assert.equal(parsed.SMTP_PORT, 587);
  assert.equal(parsed.DATABASE_SSL_CA, undefined);
  assert.equal(parsed.OPENAI_API_KEY, undefined);
});

test("runtime configuration still rejects malformed non-empty provider settings", () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/corali",
    DATABASE_SSL: "false",
    SESSION_SECRET: "runtime-session-secret-longer-than-thirty-two-bytes",
    PMS_ORIGIN: "https://pms.hotelcorali.gr",
    BOOKING_ORIGIN: "https://booking.hotelcorali.gr",
    PMS_OWNER_ID: "hotel-corali",
    APP_ROLE: "pms",
  };

  assert.throws(() => parseEnv({ ...base, STRIPE_SECRET_KEY: "invalid" }));
  assert.throws(() => parseEnv({ ...base, SMTP_FROM: "not-an-email" }));
  assert.throws(() => parseEnv({ ...base, SMTP_PORT: "70000" }));
});
