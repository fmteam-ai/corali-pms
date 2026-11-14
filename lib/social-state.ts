import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { waDigits } from "@/lib/whatsapp-inbox-core";

export type GuestLink = { bookingId: number; reference: string; guestName: string; checkIn: string; checkOut: string; status: string };

/** Posts and the last 30 days of Facebook/Instagram/TikTok/WhatsApp messages for the PMS social screen. */
export async function socialState(ownerId: string) {
  const [posts, messages] = await Promise.all([
    db().query(`SELECT p.*,a.display_name author,v.display_name approver FROM social_posts p LEFT JOIN pms_staff_users a ON a.owner_id=p.owner_id AND a.id=p.created_by LEFT JOIN pms_staff_users v ON v.owner_id=p.owner_id AND v.id=p.approved_by WHERE p.owner_id=$1 ORDER BY p.scheduled_at DESC LIMIT 100`, [ownerId]),
    db().query(`SELECT * FROM social_messages WHERE owner_id=$1 AND created_at>$2 ORDER BY created_at DESC LIMIT 300`, [ownerId, Date.now() - 30 * 86_400_000]),
  ]);
  // WhatsApp senders matched to their booking by phone number (the latest stay first).
  const numbers = [...new Set(messages.rows.filter((m) => m.platform === "whatsapp").map((m) => String(m.sender_id)))];
  const guests: Record<string, GuestLink> = {};
  if (numbers.length) {
    const r = await db().query(
      `SELECT id,reference,guest_name,guest_phone,check_in,check_out,status FROM bookings WHERE owner_id=$1 AND guest_phone IS NOT NULL AND regexp_replace(regexp_replace(guest_phone,'[^0-9]','','g'),'^00','') = ANY($2::text[]) ORDER BY check_in DESC`,
      [ownerId, numbers],
    );
    for (const b of r.rows) {
      const key = waDigits(b.guest_phone);
      if (!guests[key]) guests[key] = { bookingId: Number(b.id), reference: String(b.reference), guestName: String(b.guest_name ?? ""), checkIn: String(b.check_in), checkOut: String(b.check_out), status: String(b.status) };
    }
  }
  return { posts: posts.rows, messages: messages.rows, guests, bookingUrl: `${env().BOOKING_ORIGIN}/book` };
}
