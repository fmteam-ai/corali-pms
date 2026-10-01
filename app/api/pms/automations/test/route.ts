import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { bookingLanguages } from "@/lib/booking-i18n";
import { messageEvents, renderTemplate, withDefaultTemplates } from "@/lib/message-templates";
import { metaDiagnosis, sampleValues, smtpDiagnosis, whatsappNumber } from "@/lib/message-test";
import { sendEmail } from "@/lib/notifications/email";
import { providerCredentials } from "@/lib/provider-connections";
import { allowAttempt } from "@/lib/request-limit";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { whatsappVariables } from "../../../../../scripts/automation-core.mjs";

// Test send from PMS → Automated messages: proves SMTP / WhatsApp work with the saved credentials and templates.
// A failed send is a result, not a server error: it is answered with 200 + ok:false, because hosting proxies (cPanel,
// Cloudflare) replace 5xx bodies with their own page and the diagnosis would be lost.
const input = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), to: z.email().max(200), event: z.enum(messageEvents), lang: z.enum(bookingLanguages) }),
  z.object({ channel: z.literal("whatsapp"), to: z.string().trim().min(8).max(24), mode: z.enum(["hello_world", "event"]), event: z.enum(messageEvents), lang: z.enum(bookingLanguages) }),
]);

async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  if (!can(u.role, "integrations.write", u.permissions)) return forbidden(u, "integrations.write");
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (!(await allowAttempt(`automation-test:${u.ownerId}`, 10, 10 * 60_000, 10 * 60_000))) return Response.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 });
    const row = (await db().query(`SELECT templates_json FROM message_automation_settings WHERE owner_id=$1`, [u.ownerId])).rows[0];
    let stored: unknown = null;
    try { stored = JSON.parse(String(row?.templates_json ?? "{}")); } catch { stored = null; }
    const templates = withDefaultTemplates(stored);
    const values = sampleValues(env().BOOKING_ORIGIN);
    if (x.channel === "email") {
      const t = templates[x.event][x.lang];
      const smtp = await providerCredentials(u.ownerId, "smtp");
      const server = smtp ? `${smtp.settings.host}:${smtp.settings.port || 587}` : env().SMTP_HOST ? `${env().SMTP_HOST}:${env().SMTP_PORT}` : null;
      try {
        await sendEmail(x.to, `[TEST] ${renderTemplate(t.subject, values)}`, `*** Test message from Hotel Corali PMS — sample booking data, not a real reservation. ***\n\n${renderTemplate(t.body, values)}`);
        return Response.json({ ok: true, channel: "email", server });
      } catch (e) {
        const d = smtpDiagnosis(e);
        return Response.json({ ok: false, error: d.code, hint: d.hint, server });
      }
    }
    const to = whatsappNumber(x.to);
    if (!to) return Response.json({ ok: false, error: "INVALID_WHATSAPP_NUMBER", hint: "number" }, { status: 400 });
    const c = await providerCredentials(u.ownerId, "whatsapp");
    if (c && !c.active) return Response.json({ ok: false, error: "WHATSAPP_DISABLED", hint: "not_configured" }, { status: 400 });
    const access = c ? c.secrets.accessToken : env().WHATSAPP_ACCESS_TOKEN, phoneId = c ? c.settings.phoneNumberId : env().WHATSAPP_PHONE_NUMBER_ID, api = c?.settings.apiVersion || "v22.0";
    if (!access || !phoneId || !/^v\d+\.\d+$/.test(api)) return Response.json({ ok: false, error: "WHATSAPP_NOT_CONFIGURED", hint: "not_configured" }, { status: 400 });
    const name = x.mode === "hello_world" ? "hello_world" : templates[x.event][x.lang].whatsappTemplate;
    if (!name) return Response.json({ ok: false, error: "WHATSAPP_NO_TEMPLATE", hint: "no_template" }, { status: 400 });
    const template = x.mode === "hello_world" ? { name, language: { code: "en_US" } } : { name, language: { code: x.lang }, components: [{ type: "body", parameters: whatsappVariables(x.event, values).map((text) => ({ type: "text", text })) }] };
    const response = await fetch(`https://graph.facebook.com/${api}/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template }), signal: AbortSignal.timeout(12_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const d = metaDiagnosis(response.status, body);
      return Response.json({ ok: false, error: d.code, hint: d.hint, detail: d.detail, template: name });
    }
    return Response.json({ ok: true, channel: "whatsapp", template: name, messageId: String((body as { messages?: { id?: string }[] }).messages?.[0]?.id ?? "accepted") });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (e instanceof Error && e.name === "TimeoutError") return Response.json({ ok: false, error: "WHATSAPP_TIMEOUT", hint: "connection" });
    return Response.json({ ok: false, error: "TEST_FAILED" }, { status: 500 });
  }
}

export const POST = audited("automation_test", handlePOST);
