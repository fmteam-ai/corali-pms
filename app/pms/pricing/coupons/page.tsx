import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { CouponsManager, type CouponRow } from "./coupons-manager";

export default async function CouponsPage() {
  const u = await requireUser("pricing.read");
  const { lang, t } = await getPmsT();
  const [coupons, today] = await Promise.all([
    db().query(`SELECT c.id,c.code,c.name,c.discount_type,c.discount_value,c.valid_from,c.valid_to,c.stay_from,c.stay_to,c.blackout_json,c.max_uses,c.usage_count,c.combinable,c.restricted_email,c.active,c.purpose,c.created_at,
        (SELECT count(*)::int FROM booking_sessions s WHERE s.owner_id=c.owner_id AND s.coupon_code=c.code AND s.status='payment_pending' AND s.recovery_due_at>(extract(epoch from now())*1000)::bigint) AS pending_uses,
        (SELECT COALESCE(sum(s.room_subtotal_cents),0)::bigint FROM booking_sessions s WHERE s.owner_id=c.owner_id AND s.coupon_code=c.code AND s.status='completed') AS revenue_cents
      FROM coupons c WHERE c.owner_id=$1 ORDER BY c.active DESC,c.created_at DESC,c.id DESC LIMIT 500`, [u.ownerId]),
    db().query(`SELECT to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AS d`),
  ]);
  const showRevenue = can(u.role, "reports.financial", u.permissions);
  return (
    <section className="srPage">
      <div className="pageTitle"><div><h1>{t("cp.title")}</h1><p>{t("cp.subtitle")}</p></div></div>
      <CouponsManager
        lang={lang}
        today={String(today.rows[0].d)}
        coupons={coupons.rows.map((c) => ({ id: Number(c.id), code: String(c.code), name: String(c.name ?? ""), discount_type: String(c.discount_type), discount_value: Number(c.discount_value), valid_from: String(c.valid_from ?? ""), valid_to: String(c.valid_to ?? ""), stay_from: c.stay_from || null, stay_to: c.stay_to || null, blackout_json: String(c.blackout_json ?? "[]"), max_uses: c.max_uses === null ? null : Number(c.max_uses), usage_count: Number(c.usage_count), pending_uses: Number(c.pending_uses), revenue_cents: showRevenue ? Number(c.revenue_cents) : null, combinable: Number(c.combinable), restricted_email: c.restricted_email || null, active: Number(c.active), purpose: String(c.purpose ?? "general") }) as CouponRow)}
        canCreate={can(u.role, "pricing.create", u.permissions)}
        canEdit={can(u.role, "pricing.edit", u.permissions)}
        canDelete={can(u.role, "pricing.delete", u.permissions)}
      />
    </section>
  );
}
