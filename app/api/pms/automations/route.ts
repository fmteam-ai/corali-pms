import { audited } from "@/lib/audit";
import { automationSnapshot } from "@/lib/audit-snapshots";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { bookingLanguages } from "@/lib/booking-i18n";
import { messageEvents, requiredVariables, withDefaultTemplates, type MessageEvent } from "@/lib/message-templates";

const template = z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(4000), whatsappTemplate: z.string().trim().max(120).regex(/^[a-z0-9_]*$/) });
const localized = z.object({ el: template, en: template, fr: template, de: template, it: template, es: template });
const templates = z.object(Object.fromEntries(messageEvents.map((e) => [e, localized])) as Record<MessageEvent, typeof localized>);
const eventFlags = z.object(Object.fromEntries(messageEvents.map((e) => [e, z.boolean()])) as Record<MessageEvent, z.ZodBoolean>);
const publicUrl = z.union([z.url().startsWith("https://"), z.literal("")]);
const hour = z.number().int().min(0).max(23);
const input = z.object({
  enabled: z.boolean(), emailEnabled: z.boolean(), whatsappEnabled: z.boolean(),
  checkinDaysBefore: z.number().int().min(1).max(30), balanceDaysBeforeCheckout: z.number().int().min(0).max(30), reviewDaysAfterCheckout: z.number().int().min(1).max(30),
  sendHour: hour, preArrivalHour: hour.default(15), welcomeHour: hour.default(16), preDepartureHour: hour.default(18),
  reviewUrl: publicUrl, tripadvisorUrl: publicUrl.default(""),
  events: eventFlags, templates,
});

const defaultEvents: Record<MessageEvent, boolean> = { confirmation: true, pre_arrival: true, checkin: true, welcome: true, balance: true, pre_departure: true, review: false };

export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  const [row, history] = await Promise.all([
    db().query(`SELECT * FROM message_automation_settings WHERE owner_id=$1`, [u.ownerId]),
    db().query(`SELECT d.id,d.event_key,d.channel,d.scheduled_at,d.status,d.attempts,d.last_error,d.sent_at,b.reference FROM message_deliveries d JOIN bookings b ON b.id=d.booking_id AND b.owner_id=d.owner_id WHERE d.owner_id=$1 ORDER BY d.id DESC LIMIT 100`, [u.ownerId]),
  ]);
  const s = row.rows[0];
  const parse = (v: string, fallback: unknown) => { try { return JSON.parse(v); } catch { return fallback; } };
  const settings = s
    ? {
        enabled: Boolean(Number(s.enabled)), emailEnabled: Boolean(Number(s.email_enabled)), whatsappEnabled: Boolean(Number(s.whatsapp_enabled)),
        checkinDaysBefore: Number(s.checkin_days_before), balanceDaysBeforeCheckout: Number(s.balance_days_before_checkout), reviewDaysAfterCheckout: Number(s.review_days_after_checkout),
        sendHour: Number(s.send_hour), preArrivalHour: Number(s.pre_arrival_hour ?? 15), welcomeHour: Number(s.welcome_hour ?? 16), preDepartureHour: Number(s.pre_departure_hour ?? 18),
        reviewUrl: s.review_url, tripadvisorUrl: s.tripadvisor_url ?? "",
        events: { ...defaultEvents, ...parse(s.events_json, {}) }, templates: withDefaultTemplates(parse(s.templates_json, {})),
      }
    : { enabled: false, emailEnabled: true, whatsappEnabled: false, checkinDaysBefore: 3, balanceDaysBeforeCheckout: 1, reviewDaysAfterCheckout: 2, sendHour: 10, preArrivalHour: 15, welcomeHour: 16, preDepartureHour: 18, reviewUrl: "", tripadvisorUrl: "", events: defaultEvents, templates: withDefaultTemplates({}) };
  return Response.json({ ok: true, settings, history: history.rows });
}

async function handlePUT(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const i = input.parse(await request.json());
    if (i.enabled && !i.emailEnabled && !i.whatsappEnabled) throw Error("CHANNEL_REQUIRED");
    if (i.enabled && i.events.review && !i.reviewUrl && !i.tripadvisorUrl) throw Error("REVIEW_URL_REQUIRED");
    for (const event of messageEvents) for (const lang of bookingLanguages) for (const variable of requiredVariables(event)) if (!i.templates[event][lang].body.includes(`{{${variable}}}`)) throw Error(`MISSING_${variable.toUpperCase()}_${event}_${lang}`);
    if (i.enabled && i.whatsappEnabled) for (const event of messageEvents) if (i.events[event]) for (const lang of bookingLanguages) if (!i.templates[event][lang].whatsappTemplate) throw Error(`WHATSAPP_TEMPLATE_REQUIRED_${event}_${lang}`);
    await db().query(
      `INSERT INTO message_automation_settings(owner_id,enabled,email_enabled,whatsapp_enabled,checkin_days_before,balance_days_before_checkout,review_days_after_checkout,send_hour,review_url,events_json,templates_json,updated_at,tripadvisor_url,pre_arrival_hour,welcome_hour,pre_departure_hour)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(owner_id) DO UPDATE SET enabled=$2,email_enabled=$3,whatsapp_enabled=$4,checkin_days_before=$5,balance_days_before_checkout=$6,review_days_after_checkout=$7,send_hour=$8,review_url=$9,events_json=$10,templates_json=$11,updated_at=$12,tripadvisor_url=$13,pre_arrival_hour=$14,welcome_hour=$15,pre_departure_hour=$16`,
      [u.ownerId, i.enabled ? 1 : 0, i.emailEnabled ? 1 : 0, i.whatsappEnabled ? 1 : 0, i.checkinDaysBefore, i.balanceDaysBeforeCheckout, i.reviewDaysAfterCheckout, i.sendHour, i.reviewUrl, JSON.stringify(i.events), JSON.stringify(i.templates), Date.now(), i.tripadvisorUrl, i.preArrivalHour, i.welcomeHour, i.preDepartureHour],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : e instanceof Error ? e.message : "SAVE_FAILED" }, { status: 400 });
  }
}

async function handlePATCH(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const { id } = z.object({ id: z.number().int().positive() }).parse(await request.json());
    const r = await db().query(`UPDATE message_deliveries SET status='pending',attempts=0,updated_at=$1,last_error=NULL WHERE owner_id=$2 AND id=$3 AND status='failed' RETURNING id`, [Date.now(), u.ownerId, id]);
    return Response.json({ ok: Boolean(r.rowCount) }, { status: r.rowCount ? 200 : 404 });
  } catch {
    return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }
}

export const PUT = audited("automation_settings", handlePUT, { snapshot: automationSnapshot });
export const PATCH = audited("automation_settings", handlePATCH, { snapshot: automationSnapshot });
