import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanToken, DEFAULT_GRAPH_VERSION, parsePhones, tokenExpiry, wabaIdsFromDebug, type WaPhone } from "@/lib/meta-connect-core";
import { providerCredentials, sealProviderSecrets } from "@/lib/provider-connections";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({
  appId: z.string().trim().regex(/^\d{5,25}$/).optional(),
  appSecret: z.string().trim().max(200).optional(),
  token: z.string().min(20).max(2000),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/).optional(),
});

const graph = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, json: j as Record<string, unknown> & { error?: { message?: string } } };
};

/**
 * Γρήγορη σύνδεση WhatsApp Business: a token from Graph API Explorer (60 days) or a System User token (permanent) →
 * the WhatsApp Business account and phone number it can use, found by the PMS; saved encrypted and switched on.
 * The app (App ID / secret) is the same Meta app as Facebook / Instagram unless given here.
 */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const [wa, meta] = await Promise.all([providerCredentials(u.ownerId, "whatsapp").catch(() => null), providerCredentials(u.ownerId, "meta").catch(() => null)]);
    const appId = x.appId || wa?.settings.appId || meta?.settings.appId || "";
    const appSecret = x.appSecret?.trim() || wa?.secrets.appSecret || meta?.secrets.appSecret || "";
    if (!appId || !appSecret) return Response.json({ ok: false, error: "APP_REQUIRED" }, { status: 400 });
    const base = `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}`, appToken = `${appId}|${appSecret}`;
    const pasted = cleanToken(x.token);
    // A short Explorer token becomes a 60-day one; a System User token is kept as it is (it does not expire).
    const first = await graph(`${base}/debug_token?${new URLSearchParams({ input_token: pasted, access_token: appToken })}`);
    if (!first.ok || !(first.json.data as { is_valid?: boolean } | undefined)?.is_valid) return Response.json({ ok: false, error: "TOKEN_INVALID", detail: String(first.json.error?.message ?? "").slice(0, 200) }, { status: 400 });
    let token = pasted, debug = first.json;
    if (tokenExpiry(first.json) > 0) {
      const ex = await graph(`${base}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: pasted })}`);
      if (ex.ok && typeof ex.json.access_token === "string") {
        token = ex.json.access_token;
        debug = (await graph(`${base}/debug_token?${new URLSearchParams({ input_token: token, access_token: appToken })}`)).json;
      }
    }
    // The WhatsApp accounts the token was granted, plus every account owned by the hotel's business portfolios (a token
    // granted for "all" accounts, or for an empty account made by an earlier attempt, still finds the right number).
    const wabas = new Set(wabaIdsFromDebug(debug));
    const businesses = (await graph(`${base}/me/businesses?${new URLSearchParams({ fields: "id,name", limit: "25", access_token: token })}`)).json.data;
    for (const b of Array.isArray(businesses) ? businesses as { id?: string }[] : []) {
      if (!b.id) continue;
      const owned = (await graph(`${base}/${b.id}/owned_whatsapp_business_accounts?${new URLSearchParams({ fields: "id", limit: "25", access_token: token })}`)).json.data;
      for (const w of Array.isArray(owned) ? owned as { id?: string }[] : []) if (w.id && /^\d{5,30}$/.test(w.id)) wabas.add(w.id);
    }
    if (!wabas.size) return Response.json({ ok: false, error: "NO_WHATSAPP" }, { status: 400 });
    const phones: WaPhone[] = [];
    let lastError = "";
    for (const w of wabas) {
      const r = await graph(`${base}/${w}/phone_numbers?${new URLSearchParams({ fields: "id,display_phone_number,verified_name", access_token: token })}`);
      if (!r.ok) lastError = String(r.json.error?.message ?? "").slice(0, 200);
      phones.push(...parsePhones(r.json, w));
    }
    if (!phones.length) return Response.json({ ok: false, error: "NO_PHONE", detail: [`λογαριασμοί WhatsApp: ${[...wabas].join(", ")}`, lastError].filter(Boolean).join(" · ") }, { status: 400 });
    const phone = x.phoneNumberId ? phones.find((p) => p.id === x.phoneNumberId) : phones.length === 1 ? phones[0] : null;
    if (!phone) return Response.json({ ok: false, error: "CHOOSE_PHONE", phones: phones.map((p) => ({ id: p.id, number: p.number, name: p.name })) });
    // A Cloud API number sends only once registered (6-digit two-step PIN, kept with the secrets). Done here so the
    // hotel never has to call the API by hand; a number not yet verified by SMS / call is reported instead.
    const info = (await graph(`${base}/${phone.id}?${new URLSearchParams({ fields: "status,code_verification_status,name_status", access_token: token })}`)).json as { status?: string; code_verification_status?: string; name_status?: string };
    const pin = wa?.secrets.twoStepPin || String(100000 + (randomBytes(4).readUInt32BE() % 900000));
    let registered = info.status === "CONNECTED";
    let registerError = "";
    if (!registered) {
      const reg = await graph(`${base}/${phone.id}/register`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
      registered = reg.ok && reg.json.success === true;
      if (!registered) registerError = String(reg.json.error?.message ?? "").slice(0, 200);
    }
    const expiresAt = tokenExpiry(debug);
    const settings = { ...(wa?.settings ?? {}), apiVersion: DEFAULT_GRAPH_VERSION, phoneNumberId: phone.id, businessAccountId: phone.wabaId, appId, tokenExpiresAt: String(expiresAt) };
    const secrets = { ...(wa?.secrets ?? {}), accessToken: token, appSecret, twoStepPin: pin, verifyToken: wa?.secrets.verifyToken || `corali-${randomBytes(9).toString("base64url")}` };
    const now = Date.now();
    await db().query(
      `INSERT INTO provider_connections(owner_id,provider_key,active,status,settings_json,secrets_encrypted,updated_by,updated_at,last_test_at,last_test_result)
       VALUES($1,'whatsapp',1,'verified',$2,$3,$4,$5,$5,'passed')
       ON CONFLICT(owner_id,provider_key) DO UPDATE SET active=1,status='verified',settings_json=$2,secrets_encrypted=$3,updated_by=$4,updated_at=$5,last_test_at=$5,last_test_result='passed'`,
      [u.ownerId, JSON.stringify(settings), sealProviderSecrets(secrets), String(u.id), now],
    );
    await db().query("INSERT INTO provider_connection_audit(owner_id,provider_key,actor_id,action,created_at) VALUES($1,'whatsapp',$2,'quick_connect',$3)", [u.ownerId, String(u.id), now]);
    return Response.json({ ok: true, phone: { number: phone.number, name: phone.name }, expiresAt, registered, registerError, nameStatus: String(info.name_status ?? ""), codeVerified: info.code_verification_status !== "NOT_VERIFIED" });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("WhatsApp quick connect failed", e);
    return Response.json({ ok: false, error: "FAILED" }, { status: 502 });
  }
}

export const POST = audited("provider_connections", handlePOST);
