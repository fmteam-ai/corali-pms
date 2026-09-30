import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { MinStayManager } from "./min-stay-manager";

export default async function MinStayPage() {
  const u = await requireUser("pricing.read");
  const { lang, t } = await getPmsT();
  const [types, rules, today] = await Promise.all([
    db().query(`SELECT r.room_type, min(c.name_el) AS name_el, min(c.name_en) AS name_en, count(*)::int AS rooms FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id AND c.owner_id=r.owner_id WHERE r.owner_id=$1 GROUP BY r.room_type ORDER BY r.room_type`, [u.ownerId]),
    db().query(`SELECT id,room_type,starts_on,ends_on,min_nights,active,updated_at FROM min_stay_rules WHERE owner_id=$1 ORDER BY starts_on NULLS FIRST,room_type NULLS FIRST,id`, [u.ownerId]),
    db().query(`SELECT to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AS d`),
  ]);
  return (
    <section className="srPage">
      <div className="pageTitle"><div><h1>{t("ms.title")}</h1><p>{t("ms.subtitle")}</p></div></div>
      <MinStayManager
        lang={lang}
        today={String(today.rows[0].d)}
        types={types.rows.map((x) => ({ type: String(x.room_type), label: (lang === "en" ? x.name_en || x.name_el : x.name_el || x.name_en) || String(x.room_type), rooms: Number(x.rooms) }))}
        rules={rules.rows.map((r) => ({ id: Number(r.id), room_type: r.room_type || null, starts_on: r.starts_on || null, ends_on: r.ends_on || null, min_nights: Number(r.min_nights), active: Number(r.active), updated_at: Number(r.updated_at) }))}
        canCreate={can(u.role, "pricing.create", u.permissions)}
        canEdit={can(u.role, "pricing.edit", u.permissions)}
        canDelete={can(u.role, "pricing.delete", u.permissions)}
      />
    </section>
  );
}
