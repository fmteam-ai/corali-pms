import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { SeasonRates } from "./season-rates";

export default async function SeasonRatesPage() {
  const u = await requireUser("pricing.read");
  const { lang, t } = await getPmsT();
  const [rooms, rules, today] = await Promise.all([
    db().query(`SELECT code,room_type,base_rate_cents FROM rooms WHERE owner_id=$1 AND active=1 ORDER BY room_type,code`, [u.ownerId]),
    db().query(`SELECT id,name,room_type,room_codes,weekdays,starts_on,ends_on,price_cents,active,updated_at FROM rate_rules WHERE owner_id=$1 AND price_cents IS NOT NULL ORDER BY starts_on,id`, [u.ownerId]),
    db().query(`SELECT to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AS d`),
  ]);
  return (
    <section className="srPage">
      <div className="pageTitle"><div><h1>{t("sr.title")}</h1><p>{t("sr.subtitle")}</p></div></div>
      <SeasonRates
        lang={lang}
        today={String(today.rows[0].d)}
        rooms={rooms.rows.map((r) => ({ code: String(r.code), roomType: String(r.room_type), baseCents: Number(r.base_rate_cents) }))}
        rules={rules.rows.map((r) => ({ id: Number(r.id), name: String(r.name ?? ""), room_type: r.room_type || null, room_codes: String(r.room_codes ?? "[]"), weekdays: String(r.weekdays ?? "[]"), starts_on: String(r.starts_on), ends_on: String(r.ends_on), price_cents: Number(r.price_cents), active: Number(r.active), updated_at: Number(r.updated_at) }))}
        canCreate={can(u.role, "pricing.create", u.permissions)}
        canEdit={can(u.role, "pricing.edit", u.permissions)}
        canDelete={can(u.role, "pricing.delete", u.permissions)}
      />
    </section>
  );
}
