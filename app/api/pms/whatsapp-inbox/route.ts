import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_GRAPH_VERSION } from "@/lib/meta-connect-core";
import { randomBytes } from "node:crypto";
import { providerCredentials, sealProviderSecrets } from "@/lib/provider-connections";
import { after } from "next/server";
import { allowAttempt } from "@/lib/request-limit";
import { runWhatsAppInboxSetup } from "../../../../scripts/whatsapp-inbox-worker.mjs";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

type GraphError = { message?: string; error_user_msg?: string };
const graph = async (url: string, init?: RequestInit) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: GraphError };
    return { ok: r.ok && !j.error, json: j };
  } catch {
    return { ok: false, json: { error: { message: "Η Meta δεν απάντησε (timeout)." } } as Record<string, unknown> & { error?: GraphError } };
  }
};
const metaMessage = (e?: GraphError) => (e?.error_user_msg || e?.message || "Άγνωστο σφάλμα της Meta").slice(0, 300);

async function setup(ownerId: string) {
  const wa = await providerCredentials(ownerId, "whatsapp");
  const appId = wa?.settings.appId ?? "", appSecret = wa?.secrets.appSecret ?? "", access = wa?.secrets.accessToken ?? "", waba = wa?.settings.businessAccountId ?? "";
  if (!wa?.active || !access || !/^\d{5,30}$/.test(waba)) return { error: "NOT_CONNECTED" as const };
  if (!/^\d{5,25}$/.test(appId) || !appSecret) return { error: "APP_REQUIRED" as const };
  return { wa, appId, appToken: `${appId}|${appSecret}`, access, waba, verifyToken: wa.secrets.verifyToken ?? "", base: `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}`, callback: `${env().BOOKING_ORIGIN}/api/webhooks/meta` };
}

/**
 * Asks the booking site the same question Meta asks when the webhook is saved (verify token + challenge), with the
 * token stored in the PMS: shows whether Meta could validate the callback, without revealing the token.
 */
async function callbackCheck(s: { callback: string; verifyToken: string }) {
  const challenge = String(Math.floor(Math.random() * 1e9));
  try {
    const r = await fetch(`${s.callback}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": s.verifyToken, "hub.challenge": challenge })}`, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Corali-PMS-webhook-check/1" } });
    const body = (await r.text().catch(() => "")).trim();
    return { ok: r.status === 200 && body === challenge, status: r.status, body: body === challenge ? "" : body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120) };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message.slice(0, 120) : "unreachable" };
  }
}

/** Whether Meta delivers guest WhatsApp messages to the PMS: the app's webhook and the WhatsApp account's subscription. */
async function status(s: Exclude<Awaited<ReturnType<typeof setup>>, { error: string }>) {
  const [subs, apps] = await Promise.all([
    graph(`${s.base}/${s.appId}/subscriptions?${new URLSearchParams({ access_token: s.appToken })}`),
    graph(`${s.base}/${s.waba}/subscribed_apps?${new URLSearchParams({ access_token: s.access })}`),
  ]);
  const hook = ((subs.json.data as { object?: string; callback_url?: string; active?: boolean; fields?: { name?: string }[] }[] | undefined) ?? []).find((x) => x.object === "whatsapp_business_account");
  const webhook = Boolean(hook?.active !== false && hook?.callback_url === s.callback && hook?.fields?.some((f) => f.name === "messages"));
  const subscribed = ((apps.json.data as { whatsapp_business_api_data?: { id?: string }; id?: string }[] | undefined) ?? []).some((x) => (x.whatsapp_business_api_data?.id ?? x.id) === s.appId);
  return { webhook, subscribed, callback: s.callback, otherCallback: hook?.callback_url && hook.callback_url !== s.callback ? hook.callback_url : null, readError: !subs.ok ? metaMessage(subs.json.error) : !apps.ok ? metaMessage(apps.json.error) : null };
}

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  const s = await setup(u.ownerId);
  if ("error" in s) return Response.json({ ok: true, ready: false, reason: s.error });
  const [st, check] = await Promise.all([status(s), callbackCheck(s)]);
  // The verify token only lets Meta confirm the callback URL (it opens nothing): shown to those who edit connections,
  // so it can be pasted into Meta → WhatsApp → Configuration exactly as stored.
  const verifyToken = can(u.role, "integrations.write", u.permissions) ? s.verifyToken : undefined;
  const setupState = { requestedAt: Number(s.wa.settings.inboxSetupRequestedAt || 0), doneAt: Number(s.wa.settings.inboxSetupDoneAt || 0), result: String(s.wa.settings.inboxSetupResult ?? "") };
  return Response.json({ ok: true, ready: true, ...st, callbackCheck: check, verifyToken, setup: setupState }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * «Ενεργοποίηση εισερχομένων»: points the Meta app's WhatsApp webhook at the PMS (Meta checks it at once with the
 * verify token) and subscribes the app to the hotel's WhatsApp account, so guest messages reach the PMS inbox.
 */
async function handlePOST(request: Request) {
  try {
    return await enableInbox(request);
  } catch (e) {
    // Never a bare failure: the panel shows what went wrong.
    console.error("WhatsApp inbox setup failed", e);
    return Response.json({ ok: false, error: "UNEXPECTED", detail: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) }, { status: 500 });
  }
}

async function enableInbox(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try { assertTrustedOrigin(request); } catch { return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }); }
  const s = await setup(u.ownerId);
  if ("error" in s) return Response.json({ ok: false, error: s.error }, { status: 400 });
  if (!(await allowAttempt(`wa-inbox:${u.ownerId}`, 10, 60 * 60_000, 30 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  // Meta accepts a verify token of at most 64 letters / digits / - _ (a long or pasted one is refused with #100):
  // replace it with a new one, so nothing has to be typed by hand.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s.verifyToken)) {
    const verifyToken = `corali-${randomBytes(18).toString("base64url")}`;
    await db().query(`UPDATE provider_connections SET secrets_encrypted=$3 WHERE owner_id=$1 AND provider_key=$2`, [u.ownerId, "whatsapp", sealProviderSecrets({ ...s.wa.secrets, verifyToken })]);
    s.verifyToken = verifyToken;
    s.wa.secrets.verifyToken = verifyToken;
  }
  // Meta checks the callback at once: say plainly when the booking site would not answer it.
  const check = await callbackCheck(s);
  if (!check.ok) return Response.json({ ok: false, error: "CALLBACK_FAILED", detail: `HTTP ${check.status || "—"}${check.body ? ` · ${check.body}` : ""}`, callbackCheck: check }, { status: 502 });
  // The calls to Meta run in the automation cron within a minute (scripts/whatsapp-inbox-worker.mjs), so this page
  // never waits on Meta (a long wait here was cut by the proxy with 502).
  const at = Date.now();
  await db().query(`UPDATE provider_connections SET settings_json=(settings_json::jsonb || $3::jsonb)::text WHERE owner_id=$1 AND provider_key=$2`, [u.ownerId, "whatsapp", JSON.stringify({ inboxSetupRequestedAt: String(at) })]);
  // Done by the PMS itself right after this answer (no cron needed); the automation cron, where it runs, is a fallback.
  const ownerId = u.ownerId;
  after(() => runWhatsAppInboxSetup({
    pool: db(), owner: ownerId, origin: env().BOOKING_ORIGIN,
    credentials: async (key) => { const c = await providerCredentials(ownerId, key as "whatsapp"); return c ? (c.active ? { settings: c.settings, secrets: c.secrets } : { disabled: true }) : null; },
  }).catch((e) => console.error("WhatsApp inbox setup failed", e)));
  return Response.json({ ok: true, queued: true, requestedAt: at });
}

export const POST = audited("whatsapp_inbox", handlePOST);
