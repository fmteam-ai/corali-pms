import { db } from "@/lib/db";
import { providerFields, type ProviderKey } from "@/lib/provider-fields";
import { publicProvider } from "@/lib/provider-public";
export { publicProvider, validateProviderFields } from "@/lib/provider-public";
import { documentKey, env } from "@/lib/env";
import { decryptField, encryptField } from "@/lib/security/encryption";

export type ProviderRecord = { provider_key: ProviderKey; active: number; status: string; settings_json: string; secrets_encrypted: string; last_test_at: number | null; last_test_result: string | null };

export async function listProviders(ownerId: string) {
  const rows = await db().query<ProviderRecord>("SELECT provider_key,active,status,settings_json,secrets_encrypted,last_test_at,last_test_result FROM provider_connections WHERE owner_id=$1", [ownerId]);
  const byKey = new Map(rows.rows.map(row => [row.provider_key, publicProvider(row)]));
  return Object.entries(providerFields).map(([key, fields]) => byKey.get(key as ProviderKey) ?? {
    providerKey: key as ProviderKey, label: fields.label, active: false, status: "not_configured", settings: {},
    secretConfigured: {}, lastTestAt: null, lastTestResult: null,
  });
}

export async function providerCredentials(ownerId: string, providerKey: ProviderKey): Promise<{active: boolean; settings: Record<string,string>; secrets: Record<string,string>} | null> {
  const result = await db().query<ProviderRecord>("SELECT provider_key,active,status,settings_json,secrets_encrypted,last_test_at,last_test_result FROM provider_connections WHERE owner_id=$1 AND provider_key=$2", [ownerId,providerKey]);
  const row = result.rows[0];
  if (!row) return null;
  return { active: Boolean(row.active), settings: JSON.parse(row.settings_json), secrets: JSON.parse(decryptField(row.secrets_encrypted, documentKey())) };
}

export async function stripeCredentials(ownerId: string) {
  const configured = await providerCredentials(ownerId,"stripe");
  if (configured) return configured.active ? { secretKey: configured.secrets.secretKey, webhookSecret: configured.secrets.webhookSecret } : null;
  const legacy = env();
  return legacy.STRIPE_SECRET_KEY && legacy.STRIPE_WEBHOOK_SECRET ? { secretKey: legacy.STRIPE_SECRET_KEY, webhookSecret: legacy.STRIPE_WEBHOOK_SECRET } : null;
}

/** API key for the guest AI assistant: PMS → Integrations (Anthropic), else the ANTHROPIC_API_KEY environment variable. */
export async function anthropicApiKey(ownerId: string): Promise<string | null> {
  const configured = await providerCredentials(ownerId, "anthropic").catch(() => null);
  if (configured) return configured.active && configured.secrets.apiKey ? String(configured.secrets.apiKey) : null;
  return env().ANTHROPIC_API_KEY || null;
}

export function sealProviderSecrets(secrets: Record<string,string>) { return encryptField(JSON.stringify(secrets),documentKey()); }
export function unsealProviderSecrets(ciphertext: string) { return JSON.parse(decryptField(ciphertext,documentKey())) as Record<string,string>; }
