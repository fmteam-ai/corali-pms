import { z } from "zod";
export const providerFields = {
  stripe: { label: "Stripe", settings: ["publishableKey"], secrets: ["secretKey", "webhookSecret"] },
  viva: { label: "Viva.com", settings: ["environment", "merchantId", "sourceCode"], secrets: ["clientId", "clientSecret"] },
  whatsapp: { label: "WhatsApp Business", settings: ["apiVersion", "phoneNumberId", "businessAccountId"], secrets: ["accessToken", "verifyToken", "appSecret"] },
  smtp: { label: "Email / SMTP", settings: ["host", "port", "username", "from"], secrets: ["password"] },
  mydata: { label: "ΑΑΔΕ / myDATA", settings: ["environment", "issuerVat", "branch", "receiptSeries", "invoiceSeries", "accommodationVatCategory", "extrasVatCategory", "climateTaxCategory"], secrets: ["username", "subscriptionKey", "providerToken"] },
  meta: { label: "Facebook / Instagram", settings: ["appId", "pageId"], secrets: ["appSecret", "pageAccessToken"] },
  tiktok: { label: "TikTok", settings: ["clientKey"], secrets: ["clientSecret", "accessToken"] },
  channelManager: { label: "Channel Manager", settings: ["propertyCode", "providerName"], secrets: ["apiKey"] },
  openai: { label: "OpenAI", settings: [], secrets: ["apiKey"] },
} as const;
export type ProviderKey = keyof typeof providerFields;
export const providerKeySchema = z.enum(Object.keys(providerFields) as [ProviderKey, ...ProviderKey[]]);
