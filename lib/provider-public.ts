import { stripeOptionsProblem } from "./stripe-options.ts";
import { documentKey } from "./env.ts";
import { decryptField } from "./security/encryption.ts";
import { providerFields, type ProviderKey } from "./provider-fields.ts";
import type { ProviderRecord } from "./provider-connections.ts";

export function publicProvider(record: ProviderRecord) {
  const fields = providerFields[record.provider_key];
  const secrets = JSON.parse(decryptField(record.secrets_encrypted, documentKey())) as Record<string, string>;
  const settings = JSON.parse(record.settings_json) as Record<string, string>;
  return { providerKey: record.provider_key, label: fields.label, active: Boolean(record.active), status: record.status,
    settings, secretConfigured: Object.fromEntries(fields.secrets.map(key => [key, Boolean(secrets[key])])),
    lastTestAt: record.last_test_at, lastTestResult: record.last_test_result };
}

export function validateProviderFields(key: ProviderKey, settings: Record<string,string>, secrets: Record<string,string>) {
  const fields = providerFields[key];
  const allowedSettings = new Set<string>(fields.settings);
  const allowedSecrets = new Set<string>(fields.secrets);
  if (Object.keys(settings).some(field => !allowedSettings.has(field)) || Object.keys(secrets).some(field => !allowedSecrets.has(field))) throw new Error("INVALID_FIELDS");
  if (Object.entries(settings).some(([field, value]) => typeof value !== "string" || value.length > (field === "checkoutNote" ? 4500 : 500)) || Object.values(secrets).some(value => typeof value !== "string" || value.length > 4000)) throw new Error("INVALID_FIELDS");
  if (key === "stripe" && ((secrets.secretKey && !/^sk_(test|live)_/.test(secrets.secretKey)) || (secrets.webhookSecret && !secrets.webhookSecret.startsWith("whsec_")))) throw new Error("INVALID_FIELDS");
  if (key === "stripe" && stripeOptionsProblem(settings)) throw new Error("INVALID_FIELDS");
  if (key === "smtp" && settings.port && (!/^\d+$/.test(settings.port) || Number(settings.port) < 1 || Number(settings.port) > 65535)) throw new Error("INVALID_FIELDS");
  if (key === "viva" && settings.environment && !["demo","live"].includes(settings.environment)) throw new Error("INVALID_FIELDS");
  if (key === "mydata" && ((settings.environment && !["dev","prod"].includes(settings.environment)) || (settings.issuerVat && !/^\d{9}$/.test(settings.issuerVat)) || [settings.branch,settings.accommodationVatCategory,settings.extrasVatCategory,settings.climateTaxCategory].some(value => value && !/^\d{1,3}$/.test(value)) || [settings.receiptSeries,settings.invoiceSeries].some(value => value && !/^[A-Za-z0-9Α-Ωα-ω-]{1,20}$/.test(value)))) throw new Error("INVALID_FIELDS");
  if (key === "whatsapp" && settings.apiVersion && !/^v\d+\.\d+$/.test(settings.apiVersion)) throw new Error("INVALID_FIELDS");
  if (key === "whatsapp" && [settings.businessAccountId,settings.phoneNumberId].some(value => value && !/^\d{5,30}$/.test(value))) throw new Error("INVALID_FIELDS");
}
