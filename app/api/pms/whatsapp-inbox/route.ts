import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { DEFAULT_GRAPH_VERSION } from "@/lib/meta-connect-core";
import { providerCredentials } from "@/lib/provider-connections";
import { allowAttempt } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";

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
  if (!/^\d{5,25}$/.test(appId) || !appSecret || !wa.secrets.verifyToken) return { error: "APP_REQUIRED" as const };
  return { wa, appId, appToken: `${appId}|${appSecret}`, access, waba, verifyToken: wa.secrets.verifyToken, base: `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}`, callback: `${env().BOOKING_ORIGIN}/api/webhooks/meta` };
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
  return Response.json({ ok: true, ready: true, ...(await status(s)) });
}

/**
 * «Ενεργοποίηση εισερχομένων»: points the Meta app's WhatsApp webhook at the PMS (Meta checks it at once with the
 * verify token) and subscribes the app to the hotel's WhatsApp account, so guest messages reach the PMS inbox.
 */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try { assertTrustedOrigin(request); } catch { return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }); }
  const s = await setup(u.ownerId);
  if ("error" in s) return Response.json({ ok: false, error: s.error }, { status: 400 });
  if (!(await allowAttempt(`wa-inbox:${u.ownerId}`, 10, 60 * 60_000, 30 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  const hook = await graph(`${s.base}/${s.appId}/subscriptions`, { method: "POST", body: new URLSearchParams({ object: "whatsapp_business_account", callback_url: s.callback, verify_token: s.verifyToken, fields: "messages", include_values: "true", access_token: s.appToken }) });
  if (!hook.ok) return Response.json({ ok: false, error: "WEBHOOK_FAILED", detail: metaMessage(hook.json.error) }, { status: 502 });
  const sub = await graph(`${s.base}/${s.waba}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${s.access}` } });
  if (!sub.ok) return Response.json({ ok: false, error: "SUBSCRIBE_FAILED", detail: metaMessage(sub.json.error) }, { status: 502 });
  return Response.json({ ok: true, ...(await status(s)) });
}

export const POST = audited("whatsapp_inbox", handlePOST);
