import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { addUnsubscribe, campaignFailures, cancelCampaign, duplicateCampaign, listCampaigns, listUnsubscribes, previewAudience, removeCampaign, removeUnsubscribe, saveCampaign, scheduleCampaign, setCampaignImage, testCampaignEmail } from "@/lib/campaigns";
import { emailConfigured } from "@/lib/notifications/email";
import { smtpDiagnosis } from "@/lib/message-test";
import { providerCredentials } from "@/lib/provider-connections";
import { allowAttempt } from "@/lib/request-limit";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { campaignPresets } from "../../../../scripts/campaign-core.mjs";

const id = z.number().int().positive();
const lang = z.enum(["el", "en", "fr", "de", "it", "es"]);
const campaign = z.object({
  name: z.string().trim().min(1).max(120), sendEmail: z.boolean(), sendWhatsapp: z.boolean(), audience: z.record(z.string(), z.unknown()), content: z.record(z.string(), z.unknown()),
  whatsappTemplate: z.string().trim().max(120).regex(/^$|^[a-z0-9_]+$/).default(""), whatsappLanguages: z.string().trim().max(60).default(""), ratePerMinute: z.number().int().min(1).max(120).default(20),
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: id.optional(), campaign }),
  z.object({ action: z.literal("duplicate"), id }),
  z.object({ action: z.literal("remove"), id }),
  z.object({ action: z.literal("image"), id, image: z.string().max(12_000_000).nullable() }),
  z.object({ action: z.literal("preview"), audience: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("test"), id, to: z.email().max(200), lang }),
  z.object({ action: z.literal("schedule"), id, at: z.number().int().positive().nullable() }),
  z.object({ action: z.literal("cancel"), id }),
  z.object({ action: z.literal("failures"), id }),
  z.object({ action: z.literal("unsub_add"), channel: z.enum(["email", "whatsapp"]), address: z.string().trim().min(3).max(200) }),
  z.object({ action: z.literal("unsub_remove"), channel: z.enum(["email", "whatsapp"]), address: z.string().trim().min(3).max(200) }),
]);

async function state(ownerId: string) {
  const wa = await providerCredentials(ownerId, "whatsapp");
  return { campaigns: await listCampaigns(ownerId), unsubscribes: await listUnsubscribes(ownerId), presets: campaignPresets, emailReady: await emailConfigured(), whatsappReady: Boolean(wa?.active) };
}

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await state(u.ownerId)) });
}

/** PMS → Bulk messages: drafts, audience preview, test e-mail, schedule / cancel, unsubscribe list. */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  if (!can(u.role, "integrations.write", u.permissions)) return forbidden(u, "integrations.write");
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const extra: Record<string, unknown> = {};
    if (x.action === "preview") return Response.json({ ok: true, preview: await previewAudience(u.ownerId, x.audience) });
    if (x.action === "failures") return Response.json({ ok: true, failures: await campaignFailures(u.ownerId, x.id) });
    if (x.action === "test") {
      if (!(await allowAttempt(`campaign-test:${u.ownerId}`, 15, 10 * 60_000, 10 * 60_000))) return Response.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 });
      try { await testCampaignEmail(u.ownerId, x.id, x.to, x.lang); return Response.json({ ok: true }); } catch (e) {
        if (e instanceof Error && ["NOT_FOUND", "NO_CONTENT", "EMAIL_NOT_CONFIGURED"].includes(e.message)) return Response.json({ ok: false, error: e.message });
        const d = smtpDiagnosis(e);
        return Response.json({ ok: false, error: d.code, hint: d.hint });
      }
    }
    if (x.action === "save") extra.id = await saveCampaign(u.ownerId, u.id, x.campaign, x.id);
    else if (x.action === "duplicate") extra.id = await duplicateCampaign(u.ownerId, u.id, x.id);
    else if (x.action === "remove") await removeCampaign(u.ownerId, x.id);
    else if (x.action === "image") await setCampaignImage(u.ownerId, x.id, x.image);
    else if (x.action === "schedule") await scheduleCampaign(u.ownerId, x.id, x.at ?? Date.now());
    else if (x.action === "cancel") await cancelCampaign(u.ownerId, x.id);
    else if (x.action === "unsub_add") await addUnsubscribe(u.ownerId, x.channel, x.address);
    else await removeUnsubscribe(u.ownerId, x.channel, x.address);
    return Response.json({ ok: true, ...extra, ...(await state(u.ownerId)) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : ["NOT_FOUND", "NOT_DRAFT", "NOT_RUNNING", "NO_CHANNEL", "NO_CONTENT", "WHATSAPP_NO_TEMPLATE", "INVALID_ADDRESS"].includes(m) ? m : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("campaigns", handlePOST);
