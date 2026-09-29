import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { FeedbackList } from "./feedback-list";

export default async function FeedbackPage() {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const [rows, stats] = await Promise.all([
    db().query(
      `SELECT r.id,r.booking_id,r.rating,r.route,r.comment,r.contact_ok,r.status,r.rated_at,r.public_clicked,r.resolved_at,r.resolution_notes,b.reference,b.guest_name,b.guest_email,b.guest_phone,s.display_name resolver
         FROM review_requests r JOIN bookings b ON b.owner_id=r.owner_id AND b.id=r.booking_id LEFT JOIN pms_staff_users s ON s.owner_id=r.owner_id AND s.id=r.resolved_by
        WHERE r.owner_id=$1 AND r.rated_at IS NOT NULL ORDER BY (r.status='feedback') DESC, r.rated_at DESC LIMIT 300`,
      [u.ownerId],
    ),
    db().query(
      `SELECT count(*)::int sent,count(rating)::int rated,round(avg(rating)::numeric,2)::float avg,count(*) FILTER (WHERE route='public')::int public,count(*) FILTER (WHERE route='private')::int private,count(*) FILTER (WHERE public_clicked IS NOT NULL)::int clicked
         FROM review_requests WHERE owner_id=$1`,
      [u.ownerId],
    ),
  ]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("fb.title")}</h1><p>{t("fb.subtitle")}</p></div></div>
      <FeedbackList lang={lang} rows={rows.rows} stats={stats.rows[0]} canResolve={can(u.role, "reservations.edit", u.permissions)} />
    </section>
  );
}
