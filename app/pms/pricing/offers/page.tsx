import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { OffersManager, type OfferRow } from "./offers-manager";

const date = /^\d{4}-\d{2}-\d{2}$/;

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ new?: string; from?: string; to?: string }> }) {
  const u = await requireUser("pricing.read");
  const { lang, t } = await getPmsT();
  const query = await searchParams;
  const [rooms, plans, offers, today] = await Promise.all([
    db().query(`SELECT r.code,r.room_type,c.name_el,c.name_en FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id AND c.owner_id=r.owner_id WHERE r.owner_id=$1 AND r.active=1 ORDER BY COALESCE(c.display_order,999),r.room_type,r.code`, [u.ownerId]),
    db().query(`SELECT plan_key,name FROM rate_plans WHERE owner_id=$1 AND active=1 ORDER BY CASE plan_key WHEN 'flexible' THEN 1 WHEN 'direct_web' THEN 2 ELSE 3 END,plan_key`, [u.ownerId]),
    db().query(`SELECT id,name,starts_on,ends_on,adjustment_type,adjustment_value,operation,weekdays,room_codes,rate_plan_keys,minimum_stay,promotion,promotion_text_json,last_minute_days,min_advance_days,checkin_in_season,round_integer,nights_overrides_json,combine_offers,combine_plan,combine_direct,combine_coupons,active FROM special_prices WHERE owner_id=$1 ORDER BY active DESC,starts_on,id`, [u.ownerId]),
    db().query(`SELECT to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AS d`),
  ]);
  const preset = query.new === "promotion" ? { from: date.test(query.from ?? "") ? query.from! : null, to: date.test(query.to ?? "") ? query.to! : null } : null;
  return (
    <section className="srPage">
      <div className="pageTitle"><div><h1>{t("of.title")}</h1><p>{t("of.subtitle")}</p></div></div>
      <OffersManager
        lang={lang}
        today={String(today.rows[0].d)}
        preset={preset}
        rooms={rooms.rows.map((r) => ({ code: String(r.code), type: String(r.room_type), label: String((lang === "en" ? r.name_en || r.name_el : r.name_el || r.name_en) || r.room_type) }))}
        plans={plans.rows.map((p) => ({ key: String(p.plan_key), name: String(p.name || p.plan_key) }))}
        offers={offers.rows.map((o) => ({ ...o, id: Number(o.id), adjustment_value: Number(o.adjustment_value), minimum_stay: Number(o.minimum_stay), promotion: Number(o.promotion), last_minute_days: o.last_minute_days === null ? null : Number(o.last_minute_days), min_advance_days: o.min_advance_days === null ? null : Number(o.min_advance_days), checkin_in_season: Number(o.checkin_in_season), round_integer: Number(o.round_integer), combine_offers: Number(o.combine_offers ?? 1), combine_plan: Number(o.combine_plan ?? 1), combine_direct: Number(o.combine_direct ?? 1), combine_coupons: Number(o.combine_coupons ?? 1), active: Number(o.active) }) as OfferRow)}
        canCreate={can(u.role, "pricing.create", u.permissions)}
        canEdit={can(u.role, "pricing.edit", u.permissions)}
        canDelete={can(u.role, "pricing.delete", u.permissions)}
      />
    </section>
  );
}
