import { z } from "zod";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().optional(),
);
const optionalStripeSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().startsWith("sk_").optional(),
);
const optionalStripeWebhookSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().startsWith("whsec_").optional(),
);
const optionalEmail = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().email().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  DATABASE_SSL_CA: optionalText,
  SESSION_SECRET: z.string().min(32),
  PMS_ORIGIN: z.string().url(),
  BOOKING_ORIGIN: z.string().url(),
  PMS_OWNER_ID: z.string().min(3).default("hotel-corali"),
  PMS_DOCUMENT_KEY: z.string().min(32).optional(),
  APP_ROLE: z.enum(["pms", "booking"]).default("pms"),
  STRIPE_SECRET_KEY: optionalStripeSecret,
  STRIPE_WEBHOOK_SECRET: optionalStripeWebhookSecret,
  VIVA_CLIENT_ID: optionalText,
  VIVA_CLIENT_SECRET: optionalText,
  WHATSAPP_ACCESS_TOKEN: optionalText,
  WHATSAPP_PHONE_NUMBER_ID: optionalText,
  SMTP_HOST: optionalText,
  SMTP_PORT: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce.number().int().min(1).max(65535).default(587),
  ),
  SMTP_USERNAME: optionalText,
  SMTP_PASSWORD: optionalText,
  SMTP_FROM: optionalEmail,
  WHATSAPP_BIRTHDAY_TEMPLATE_EN: optionalText,
  WHATSAPP_BIRTHDAY_TEMPLATE_EL: optionalText,
  MYDATA_PROVIDER_TOKEN: optionalText,
  CHANNEL_MANAGER_API_KEY: optionalText,
  OPENAI_API_KEY: optionalText,
  ANTHROPIC_API_KEY: optionalText,
});

export type AppEnv = z.infer<typeof schema>;

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  return schema.parse(input);
}

let cached: AppEnv | undefined;

export function env(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

export function documentKey(): string {
  const value = env().PMS_DOCUMENT_KEY;
  if (!value) throw new Error("PMS_DOCUMENT_KEY_REQUIRED");
  return value;
}
