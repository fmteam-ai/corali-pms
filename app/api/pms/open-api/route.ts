import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { API_SCOPES, WEBHOOK_EVENTS, createApiKey, createWebhook, deleteWebhook, openApiStatus, revokeApiKey, testWebhook, updateWebhook } from "@/lib/open-api";
import { assertTrustedOrigin } from "@/lib/security/origin";

const scopes = z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length);
const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);
const id = z.number().int().positive();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_key"), name: z.string().trim().min(1).max(80), scopes }),
  z.object({ action: z.literal("revoke_key"), id }),
  z.object({ action: z.literal("create_webhook"), url: z.string().trim().min(8).max(500), events }),
  z.object({ action: z.literal("update_webhook"), id, active: z.boolean().optional(), events: events.optional() }),
  z.object({ action: z.literal("delete_webhook"), id }),
  z.object({ action: z.literal("test_webhook"), id }),
]);

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await openApiStatus(u.ownerId)) });
}

/** PMS → API & webhooks. A new key or webhook secret is in this response only (never stored readable). */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const extra: Record<string, unknown> = {};
    if (x.action === "create_key") extra.key = await createApiKey(u.ownerId, String(u.id), x.name, [...new Set(x.scopes)]);
    else if (x.action === "revoke_key") await revokeApiKey(u.ownerId, x.id);
    else if (x.action === "create_webhook") {
      const r = await createWebhook(u.ownerId, String(u.id), x.url, [...new Set(x.events)]);
      if ("error" in r) return Response.json({ ok: false, error: r.error }, { status: 400 });
      extra.secret = r.secret;
    } else if (x.action === "update_webhook") await updateWebhook(u.ownerId, x.id, x);
    else if (x.action === "delete_webhook") await deleteWebhook(u.ownerId, x.id);
    else extra.test = await testWebhook(u.ownerId, x.id);
    return Response.json({ ok: true, ...extra, ...(await openApiStatus(u.ownerId)) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("open_api", handlePOST);
