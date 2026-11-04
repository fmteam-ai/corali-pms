import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { cleanToken, parseAccounts, pickPage, validGraphVersion } from "@/lib/meta-connect-core";
import { providerCredentials, sealProviderSecrets } from "@/lib/provider-connections";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({
  appId: z.string().trim().regex(/^\d{5,25}$/).optional(),
  appSecret: z.string().trim().max(200).optional(),
  userToken: z.string().min(20).max(2000),
  pageId: z.string().trim().regex(/^\d{5,25}$/).optional(),
});

const graph = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, json: j as Record<string, unknown> & { error?: { message?: string } } };
};

/**
 * Γρήγορη σύνδεση Facebook / Instagram: short user token → 60-day token (app secret) → the Page's token, which then
 * does not expire, its id and the linked Instagram account; the Page is subscribed to the app's message webhook and
 * everything is saved and switched on. The tokens never leave the server.
 */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const saved = await providerCredentials(u.ownerId, "meta").catch(() => null);
    const appId = x.appId || saved?.settings.appId || "";
    const appSecret = x.appSecret?.trim() || saved?.secrets.appSecret || "";
    if (!appId || !appSecret) return Response.json({ ok: false, error: "APP_REQUIRED" }, { status: 400 });
    const version = validGraphVersion(saved?.settings.graphVersion ?? "");
    const base = `https://graph.facebook.com/${version}`;
    const ex = await graph(`${base}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: cleanToken(x.userToken) })}`);
    const longToken = typeof ex.json.access_token === "string" ? ex.json.access_token : "";
    if (!ex.ok || !longToken) return Response.json({ ok: false, error: "TOKEN_INVALID", detail: String(ex.json.error?.message ?? "").slice(0, 200) }, { status: 400 });
    const acc = await graph(`${base}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", access_token: longToken })}`);
    const pages = parseAccounts(acc.json);
    if (!pages.length) return Response.json({ ok: false, error: "NO_PAGES", detail: String(acc.json.error?.message ?? "").slice(0, 200) }, { status: 400 });
    const page = pickPage(pages, x.pageId);
    if (!page) return Response.json({ ok: false, error: "CHOOSE_PAGE", pages: pages.map((p) => ({ id: p.id, name: p.name })) });
    // Messages from Messenger (and Instagram through the Page) reach the PMS webhook once the Page is subscribed.
    const sub = await graph(`${base}/${page.id}/subscribed_apps`, { method: "POST", body: new URLSearchParams({ subscribed_fields: "messages,messaging_postbacks", access_token: page.accessToken }) });
    const verifyToken = saved?.secrets.verifyToken || `corali-${randomBytes(9).toString("base64url")}`;
    const settings = { ...(saved?.settings ?? {}), appId, pageId: page.id, instagramAccountId: page.instagramId, graphVersion: version };
    const secrets = { ...(saved?.secrets ?? {}), appSecret, pageAccessToken: page.accessToken, verifyToken };
    const now = Date.now();
    await db().query(
      `INSERT INTO provider_connections(owner_id,provider_key,active,status,settings_json,secrets_encrypted,updated_by,updated_at,last_test_at,last_test_result)
       VALUES($1,'meta',1,'verified',$2,$3,$4,$5,$5,'passed')
       ON CONFLICT(owner_id,provider_key) DO UPDATE SET active=1,status='verified',settings_json=$2,secrets_encrypted=$3,updated_by=$4,updated_at=$5,last_test_at=$5,last_test_result='passed'`,
      [u.ownerId, JSON.stringify(settings), sealProviderSecrets(secrets), String(u.id), now],
    );
    await db().query("INSERT INTO provider_connection_audit(owner_id,provider_key,actor_id,action,created_at) VALUES($1,'meta',$2,'quick_connect',$3)", [u.ownerId, String(u.id), now]);
    return Response.json({ ok: true, page: { id: page.id, name: page.name }, instagram: page.instagramId ? { id: page.instagramId, username: page.instagramName } : null, subscribed: sub.ok && sub.json.success === true, verifyToken, webhookUrl: `${env().BOOKING_ORIGIN.replace(/\/$/, "")}/api/webhooks/meta` });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    console.error("Meta quick connect failed", e);
    return Response.json({ ok: false, error: "FAILED" }, { status: 502 });
  }
}

export const POST = audited("provider_connections", handlePOST);
