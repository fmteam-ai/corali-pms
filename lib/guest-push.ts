// Web Push to guests who added "My booking" to their home screen (guest app): replies and messages from the hotel,
// order updates and hotel news / offers. Subscriptions belong to a booking and end after check-out.
import webpush from "web-push";
import { after } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { vapidPublicKey } from "@/lib/staff-push";

export { vapidPublicKey };
type Push = { title: string; body: string; tag: string; url?: string };

async function vapid(ownerId: string) {
  await vapidPublicKey(ownerId); // creates the hotel's keys on first use
  return (await db().query(`SELECT public_key,private_key FROM push_vapid WHERE owner_id=$1`, [ownerId])).rows[0] as { public_key: string; private_key: string };
}

/** Send to the subscriptions of some bookings; text per subscription language. Never throws. */
export async function sendGuestPush(ownerId: string, bookingIds: number[], make: (lang: string) => Push): Promise<number> {
  try {
    if (!bookingIds.length) return 0;
    const subs = (await db().query(
      `SELECT s.id,s.endpoint,s.p256dh,s.auth,s.lang FROM guest_push_subscriptions s JOIN bookings b ON b.owner_id=s.owner_id AND b.id=s.booking_id
        WHERE s.owner_id=$1 AND s.booking_id=ANY($2::bigint[]) AND b.status IN ('confirmed','checked_in')`,
      [ownerId, bookingIds],
    )).rows;
    if (!subs.length) return 0;
    const keys = await vapid(ownerId);
    const subject = env().BOOKING_ORIGIN.startsWith("https://") ? env().BOOKING_ORIGIN : "mailto:info@hotelcorali.gr";
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      const m = make(String(s.lang));
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: m.title.slice(0, 80), body: m.body.slice(0, 240), tag: m.tag, url: m.url ?? `/manage-booking?app=1&lang=${s.lang}` }),
          { vapidDetails: { subject, publicKey: keys.public_key, privateKey: keys.private_key }, TTL: 12 * 3600, urgency: "normal", timeout: 10_000 },
        );
        sent++;
        await db().query(`UPDATE guest_push_subscriptions SET last_sent_at=$2,failures=0 WHERE id=$1`, [s.id, Date.now()]);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db().query(`DELETE FROM guest_push_subscriptions WHERE id=$1`, [s.id]);
        else await db().query(`UPDATE guest_push_subscriptions SET failures=failures+1 WHERE id=$1`, [s.id]);
      }
    }));
    return sent;
  } catch (e) {
    console.error("Guest push failed", e);
    return 0;
  }
}

const fromHotel: Record<string, string> = { el: "Μήνυμα από το Hotel Corali", en: "Message from Hotel Corali", fr: "Message de l'Hotel Corali", de: "Nachricht vom Hotel Corali", it: "Messaggio dall'Hotel Corali", es: "Mensaje del Hotel Corali" };

/** A new message from the hotel in the booking's conversation. */
export function pushHotelMessage(ownerId: string, bookingId: number, body: string): Promise<number> {
  return sendGuestPush(ownerId, [bookingId], (lang) => ({ title: fromHotel[lang] ?? fromHotel.en, body, tag: `msg-${bookingId}` }));
}

/** Same, after the response is sent (inside a request), so a transaction is committed first. */
export function pushHotelMessageAfter(ownerId: string, bookingId: number, body: string): void {
  try { after(() => pushHotelMessage(ownerId, bookingId, body).then(() => undefined)); } catch { void pushHotelMessage(ownerId, bookingId, body); }
}

/** Hotel news / offer for every guest in house (or one booking). */
export function pushAnnouncementAfter(ownerId: string, bookingId: number | null, t: { titleEl: string; titleEn: string; bodyEl: string; bodyEn: string }): void {
  const run = async () => {
    // Stays that ended no longer get anything: their phones are removed here.
    await db().query(`DELETE FROM guest_push_subscriptions s USING bookings b WHERE s.owner_id=$1 AND b.owner_id=s.owner_id AND b.id=s.booking_id AND b.status NOT IN ('confirmed','checked_in')`, [ownerId]);
    const ids = bookingId !== null ? [bookingId] : (await db().query(`SELECT DISTINCT booking_id FROM guest_push_subscriptions WHERE owner_id=$1`, [ownerId])).rows.map((r) => Number(r.booking_id));
    await sendGuestPush(ownerId, ids, (lang) => ({ title: (lang === "el" ? t.titleEl || t.titleEn : t.titleEn || t.titleEl) || "Hotel Corali", body: lang === "el" ? t.bodyEl || t.bodyEn : t.bodyEn || t.bodyEl, tag: "news" }));
  };
  try { after(() => run()); } catch { void run(); }
}

export async function subscribeGuest(ownerId: string, bookingId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, lang: string): Promise<void> {
  await db().query(
    `INSERT INTO guest_push_subscriptions(owner_id,booking_id,endpoint,p256dh,auth,lang,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(endpoint) DO UPDATE SET owner_id=$1,booking_id=$2,p256dh=$4,auth=$5,lang=$6,failures=0`,
    [ownerId, bookingId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, lang, Date.now()],
  );
}

export async function unsubscribeGuest(ownerId: string, endpoint: string): Promise<void> {
  await db().query(`DELETE FROM guest_push_subscriptions WHERE owner_id=$1 AND endpoint=$2`, [ownerId, endpoint]);
}
