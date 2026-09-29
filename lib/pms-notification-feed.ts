import { db } from "@/lib/db";
import { pmsT, type PmsLang } from "@/lib/pms-i18n";

export type FeedItem = { key: string; kind: string; title: string; link: string; created_at: number };

const RECENT_MS = 14 * 86_400_000;

/** Unread staff notifications: guest messages, today's arrivals and stored events (bookings, OTA, housekeeping). */
export async function loadNotifications(ownerId: string, lang: PmsLang): Promise<FeedItem[]> {
  const t = pmsT(lang);
  const since = Date.now() - RECENT_MS;
  const [messages, arrivals, events] = await Promise.all([
    db().query(
      `SELECT m.id,b.id booking_id,b.reference,m.created_at FROM booking_messages m JOIN bookings b ON b.id=m.booking_id AND b.owner_id=m.owner_id
        LEFT JOIN pms_notification_reads r ON r.owner_id=m.owner_id AND r.notification_key='message-'||m.id
        WHERE m.owner_id=$1 AND m.sender='guest' AND r.notification_key IS NULL ORDER BY m.created_at DESC LIMIT 20`,
      [ownerId],
    ),
    db().query(
      `SELECT b.id,b.guest_name,b.created_at FROM bookings b LEFT JOIN pms_notification_reads r ON r.owner_id=b.owner_id AND r.notification_key='arrival-'||b.id
        WHERE b.owner_id=$1 AND b.check_in=(now() AT TIME ZONE 'Europe/Athens')::date::text AND b.status='confirmed' AND r.notification_key IS NULL`,
      [ownerId],
    ),
    db().query(
      `SELECT n.id,n.kind,n.title_el,n.title_en,n.link,n.created_at FROM pms_notifications n LEFT JOIN pms_notification_reads r ON r.owner_id=n.owner_id AND r.notification_key='n-'||n.id
        WHERE n.owner_id=$1 AND n.created_at>$2 AND r.notification_key IS NULL ORDER BY n.id DESC LIMIT 50`,
      [ownerId, since],
    ),
  ]);
  const items: FeedItem[] = [
    ...messages.rows.map((m) => ({ key: `message-${m.id}`, kind: "message", title: t("notif.message", { ref: m.reference }), link: "/pms/messages", created_at: Number(m.created_at) })),
    ...arrivals.rows.map((b) => ({ key: `arrival-${b.id}`, kind: "arrival", title: t("notif.arrival", { name: b.guest_name }), link: `/pms/reservations/${b.id}`, created_at: Number(b.created_at) })),
    ...events.rows.map((n) => ({ key: `n-${n.id}`, kind: String(n.kind), title: String(lang === "en" ? n.title_en : n.title_el), link: String(n.link), created_at: Number(n.created_at) })),
  ];
  return items.sort((a, b) => b.created_at - a.created_at);
}

/** Cheap change detector for the live stream: changes whenever any feed source or read marker changes. */
export async function notificationSignature(ownerId: string): Promise<string> {
  const result = await db().query(
    `SELECT (SELECT COALESCE(max(id),0) FROM pms_notifications WHERE owner_id=$1) n,
            (SELECT COALESCE(max(id),0) FROM booking_messages WHERE owner_id=$1 AND sender='guest') m,
            (SELECT COALESCE(max(read_at),0) FROM pms_notification_reads WHERE owner_id=$1) r,
            (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_in=(now() AT TIME ZONE 'Europe/Athens')::date::text AND status='confirmed') a`,
    [ownerId],
  );
  const row = result.rows[0] ?? {};
  return `${row.n}:${row.m}:${row.r}:${row.a}`;
}
