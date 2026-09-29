import { db } from "@/lib/db";

export type GuestSummary = {
  email: string; guest_name: string; guest_phone: string; guest_country: string; language: string;
  stays: number; nights: number; lifetime_cents: number; last_stay: string | null; next_stay: string | null;
  preferences: string; dietary: string; allergies: string; tags: string;
};

// Auto-profiles are keyed by lower-cased email; cancelled and no-show stays do not count towards value or nights.
const profileSelect = `
  SELECT lower(b.guest_email) AS email,
         (array_agg(b.guest_name ORDER BY b.created_at DESC))[1] AS guest_name,
         COALESCE((array_agg(NULLIF(b.guest_phone,'') ORDER BY b.created_at DESC) FILTER (WHERE NULLIF(b.guest_phone,'') IS NOT NULL))[1],'') AS guest_phone,
         COALESCE((array_agg(NULLIF(b.guest_country,'') ORDER BY b.created_at DESC) FILTER (WHERE NULLIF(b.guest_country,'') IS NOT NULL))[1],'') AS guest_country,
         (array_agg(b.guest_language ORDER BY b.created_at DESC))[1] AS language,
         count(*) FILTER (WHERE b.status NOT IN ('cancelled','no_show'))::int AS stays,
         COALESCE(sum(b.check_out::date - b.check_in::date) FILTER (WHERE b.status NOT IN ('cancelled','no_show')),0)::int AS nights,
         COALESCE(sum(b.total_cents) FILTER (WHERE b.status NOT IN ('cancelled','no_show')),0)::bigint AS lifetime_cents,
         max(b.check_out) FILTER (WHERE b.status IN ('checked_out','checked_in')) AS last_stay,
         min(b.check_in) FILTER (WHERE b.status='confirmed' AND b.check_in >= (now() AT TIME ZONE 'Europe/Athens')::date::text) AS next_stay,
         COALESCE(max(p.preferences),'') AS preferences, COALESCE(max(p.dietary),'') AS dietary,
         COALESCE(max(p.allergies),'') AS allergies, COALESCE(max(p.tags),'') AS tags
    FROM bookings b
    LEFT JOIN guest_preferences p ON p.owner_id=b.owner_id AND p.email=lower(b.guest_email)
   WHERE b.owner_id=$1 AND COALESCE(b.guest_email,'')<>''`;

export async function listGuestProfiles(ownerId: string, query = "", limit = 500): Promise<GuestSummary[]> {
  const term = query.trim();
  const r = await db().query(
    `${profileSelect}
       AND ($2='' OR b.guest_name ILIKE '%'||$2||'%' OR b.guest_email ILIKE '%'||$2||'%' OR regexp_replace(COALESCE(b.guest_phone,''),'\\D','','g') LIKE '%'||NULLIF(regexp_replace($2,'\\D','','g'),'')||'%')
     GROUP BY lower(b.guest_email)
     ORDER BY max(b.check_out) DESC
     LIMIT $3`,
    [ownerId, term, limit],
  );
  return r.rows;
}

export async function guestProfile(ownerId: string, email: string) {
  const key = email.trim().toLowerCase();
  const [summary, stays, checkin, messages, channels] = await Promise.all([
    db().query(`${profileSelect} AND lower(b.guest_email)=$2 GROUP BY lower(b.guest_email)`, [ownerId, key]),
    db().query(`SELECT b.id,b.reference,b.check_in,b.check_out,b.status,b.channel,b.total_cents,b.balance_cents,r.code AS room_code,r.room_type FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND lower(b.guest_email)=$2 ORDER BY b.check_in DESC LIMIT 200`, [ownerId, key]),
    db().query(`SELECT birth_month,birth_day,adult_at_submission,preferred_language,email_marketing_consent,whatsapp_marketing_consent,marketing_consent_at,identity_purged_at,submitted_at FROM guest_checkins WHERE owner_id=$1 AND lower(email)=$2 ORDER BY submitted_at DESC LIMIT 1`, [ownerId, key]),
    db().query(`SELECT count(*)::int AS total FROM booking_messages m JOIN bookings b ON b.id=m.booking_id AND b.owner_id=m.owner_id WHERE m.owner_id=$1 AND lower(b.guest_email)=$2`, [ownerId, key]),
    db().query(`SELECT channel,count(*)::int AS stays FROM bookings WHERE owner_id=$1 AND lower(guest_email)=$2 AND status NOT IN ('cancelled','no_show') GROUP BY channel ORDER BY 2 DESC`, [ownerId, key]),
  ]);
  if (!summary.rowCount) return null;
  return { summary: summary.rows[0] as GuestSummary, stays: stays.rows, checkin: checkin.rows[0] ?? null, messages: Number(messages.rows[0]?.total ?? 0), channels: channels.rows as { channel: string; stays: number }[] };
}
