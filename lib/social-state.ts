import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Posts and the last 30 days of Facebook/Instagram messages for the PMS social screen. */
export async function socialState(ownerId: string) {
  const [posts, messages] = await Promise.all([
    db().query(`SELECT p.*,a.display_name author,v.display_name approver FROM social_posts p LEFT JOIN pms_staff_users a ON a.owner_id=p.owner_id AND a.id=p.created_by LEFT JOIN pms_staff_users v ON v.owner_id=p.owner_id AND v.id=p.approved_by WHERE p.owner_id=$1 ORDER BY p.scheduled_at DESC LIMIT 100`, [ownerId]),
    db().query(`SELECT * FROM social_messages WHERE owner_id=$1 AND created_at>$2 ORDER BY created_at DESC LIMIT 300`, [ownerId, Date.now() - 30 * 86_400_000]),
  ]);
  return { posts: posts.rows, messages: messages.rows, bookingUrl: `${env().BOOKING_ORIGIN}/book` };
}
