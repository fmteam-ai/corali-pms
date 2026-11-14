import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { renderTemplate, withDefaultTemplates } from "@/lib/message-templates";
import { sendEmail } from "@/lib/notifications/email";
import { allowAttempt } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { hashToken, newOpaqueToken } from "@/lib/security/tokens";
import { stayDate } from "../../../../../../scripts/email-brand-core.mjs";

const input = z.object({ channel: z.enum(["link", "email"]) });
const DAY = 86_400_000;

/**
 * «Αποστολή online check-in» from a reservation, for any booking (also Booking.com / Airbnb, where the guest gives
 * their own e-mail in the form): a new 7-day link (the previous one stops working) and the PMS «Online check-in»
 * message in the guest's language — e-mailed to the booking's address, or returned for WhatsApp / copying.
 */
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const { channel } = input.parse(await request.json());
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    const b = (await db().query(`SELECT id,reference,guest_name,guest_email,guest_phone,guest_language,check_in,check_out,status FROM bookings WHERE owner_id=$1 AND id=$2`, [u.ownerId, id])).rows[0];
    if (!b) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (["cancelled", "no_show", "checked_out"].includes(String(b.status))) return Response.json({ ok: false, error: "NOT_ACTIVE" }, { status: 409 });
    if (channel === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.guest_email ?? ""))) return Response.json({ ok: false, error: "NO_EMAIL" }, { status: 400 });
    if (channel === "email" && !(await allowAttempt(`checkin-send:${u.ownerId}:${id}`, 5, 60 * 60_000, 60 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

    const token = newOpaqueToken(), now = Date.now();
    await db().query(`UPDATE checkin_access_tokens SET status='revoked' WHERE owner_id=$1 AND booking_id=$2 AND status='active'`, [u.ownerId, id]);
    await db().query(`INSERT INTO checkin_access_tokens(owner_id,booking_id,token_hash,status,expires_at,created_by,created_at) VALUES($1,$2,$3,'active',$4,$5,$6)`, [u.ownerId, id, hashToken(token), now + 7 * DAY, String(u.id), now]);
    const lang = bookingLanguage(String(b.guest_language ?? "en"));
    const url = `${env().BOOKING_ORIGIN}/check-in?token=${token}&lang=${lang}`;

    const settings = (await db().query(`SELECT templates_json FROM message_automation_settings WHERE owner_id=$1`, [u.ownerId])).rows[0];
    let stored: unknown = {};
    try { stored = JSON.parse(String(settings?.templates_json ?? "{}")); } catch { stored = {}; }
    const template = withDefaultTemplates(stored).checkin[lang];
    const values = { name: String(b.guest_name ?? ""), reference: String(b.reference), checkIn: stayDate(b.check_in, lang), checkOut: stayDate(b.check_out, lang), link: url };
    const subject = renderTemplate(template.subject, values), text = renderTemplate(template.body, values);

    if (channel === "email") await sendEmail(String(b.guest_email), subject, text, { lang });
    const phone = String(b.guest_phone ?? "").replace(/\D/g, "").replace(/^00/, "");
    return Response.json({ ok: true, url, expiresAt: now + 7 * DAY, sentTo: channel === "email" ? String(b.guest_email) : null, text, whatsappUrl: phone.length >= 10 && phone.length <= 15 ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    return Response.json({ ok: false, error: e instanceof Error && /SMTP|EMAIL|MAIL/i.test(e.message) ? "EMAIL_FAILED" : "FAILED" }, { status: 500 });
  }
}

export const POST = audited("checkin_link", handlePOST);
