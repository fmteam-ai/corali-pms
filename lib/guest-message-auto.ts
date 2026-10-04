// Automatic handling of a new guest message (runs after the response): when "AI automatic replies" is on and the
// question is simple and safe, the AI answers and reception is told; otherwise reception answers as usual.
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { draftGuestReply, mayAutoSend } from "@/lib/guest-message-ai";
import { emailConfigured, sendEmail } from "@/lib/notifications/email";
import { pushNotification } from "@/lib/pms-notifications";

const replySubject: Record<string, string> = { el: "Απάντηση από το Hotel Corali · {ref}", en: "Reply from Hotel Corali · {ref}", fr: "Réponse de l’Hotel Corali · {ref}", de: "Antwort vom Hotel Corali · {ref}", it: "Risposta dall’Hotel Corali · {ref}", es: "Respuesta de Hotel Corali · {ref}" };
const replyFooter: Record<string, string> = { el: "Μπορείτε να απαντήσετε από τη σελίδα «Η κράτησή μου»:", en: "You can reply from the “My booking” page:", fr: "Vous pouvez répondre depuis la page « Ma réservation » :", de: "Sie können auf der Seite „Meine Buchung“ antworten:", it: "Può rispondere dalla pagina «La mia prenotazione»:", es: "Puede responder desde la página «Mi reserva»:" };

/** Email the guest a copy of a hotel reply (manual or automatic), with the way back to "My booking". */
export async function emailGuestReply(ownerId: string, bookingId: number, body: string) {
  try {
    if (!(await emailConfigured())) return false;
    const b = (await db().query(`SELECT reference,guest_email,guest_language FROM bookings WHERE owner_id=$1 AND id=$2`, [ownerId, bookingId])).rows[0];
    if (!b?.guest_email) return false;
    const lang = bookingLanguage(b.guest_language);
    await sendEmail(String(b.guest_email), replySubject[lang].replace("{ref}", String(b.reference)), `${body}\n\n—\n${replyFooter[lang]} ${env().BOOKING_ORIGIN}/manage-booking?lang=${lang}`);
    return true;
  } catch (error) {
    console.error("Guest reply email failed", error);
    return false;
  }
}

/** After a guest writes: answer automatically when allowed and safe, else leave it to reception. */
export async function handleGuestMessage(ownerId: string, bookingId: number, guestText: string) {
  try {
    const on = (await db().query(`SELECT ai_auto_reply FROM message_automation_settings WHERE owner_id=$1`, [ownerId])).rows[0];
    if (Number(on?.ai_auto_reply ?? 0) !== 1) return;
    const draft = await draftGuestReply(ownerId, bookingId);
    const b = (await db().query(`SELECT reference,guest_name FROM bookings WHERE owner_id=$1 AND id=$2`, [ownerId, bookingId])).rows[0];
    if (!b) return;
    if (!mayAutoSend(draft, guestText)) {
      await pushNotification(db(), ownerId, { kind: "guest_message", titleEl: `Μήνυμα από ${b.guest_name} (${b.reference}) — χρειάζεται απάντηση από τη ρεσεψιόν`, titleEn: `Message from ${b.guest_name} (${b.reference}) — needs a reply from reception`, link: `/pms/messages?booking=${bookingId}` });
      return;
    }
    const now = Date.now();
    await db().query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at,ai_generated) VALUES($1,$2,'hotel',$3,$4,0,$4,1)`, [ownerId, bookingId, draft.reply.trim().slice(0, 4000), now]);
    await db().query(`UPDATE booking_messages SET read_at=COALESCE(read_at,$1) WHERE owner_id=$2 AND booking_id=$3 AND sender='guest'`, [now, ownerId, bookingId]);
    await pushNotification(db(), ownerId, { kind: "guest_message", titleEl: `🤖 Ο AI απάντησε στον/στην ${b.guest_name} (${b.reference}) — ελέγξτε την απάντηση`, titleEn: `🤖 The AI replied to ${b.guest_name} (${b.reference}) — please check the reply`, link: `/pms/messages?booking=${bookingId}` });
    await emailGuestReply(ownerId, bookingId, draft.reply.trim());
  } catch (error) {
    console.error("Automatic guest reply failed", error);
  }
}
