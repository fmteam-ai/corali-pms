import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { RoomsManager } from "./rooms-manager";

export default async function RoomsManagePage() {
  const u = await requireUser("rooms.read");
  const { lang, t } = await getPmsT();
  const [rooms, categories, photos, amenities, assigned] = await Promise.all([
    db().query(`SELECT r.id,r.code,r.room_type,r.capacity,r.base_rate_cents,r.category_id,r.description,r.active,r.operational_status,r.images,EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id) AS has_bookings FROM rooms r WHERE r.owner_id=$1 ORDER BY r.code`, [u.ownerId]),
    db().query(`SELECT id,name_el,name_en FROM room_categories WHERE owner_id=$1 ORDER BY display_order,id`, [u.ownerId]),
    db().query(`SELECT id,room_id FROM room_photos WHERE owner_id=$1 ORDER BY room_id,sort_order,id`, [u.ownerId]),
    db().query(`SELECT id,name_el,name_en,name_translations_json,icon,active FROM room_amenities WHERE owner_id=$1 ORDER BY display_order,id`, [u.ownerId]),
    db().query(`SELECT x.room_id,x.amenity_id FROM room_amenity_assignments x JOIN rooms r ON r.id=x.room_id WHERE r.owner_id=$1`, [u.ownerId]),
  ]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("rm.title")}</h1><p>{t("rm.subtitle")}</p></div><Link className="secondaryLink" href="/pms/rooms/catalog">{t("tape.catalog")}</Link></div>
      <RoomsManager
        lang={lang}
        rooms={rooms.rows.map((r) => ({ id: Number(r.id), code: r.code, roomType: r.room_type, capacity: Number(r.capacity), baseRateCents: Number(r.base_rate_cents), categoryId: r.category_id ? Number(r.category_id) : null, description: r.description ?? "", active: Number(r.active) === 1, status: r.operational_status, hasBookings: Boolean(r.has_bookings), photoIds: photos.rows.filter((p) => Number(p.room_id) === Number(r.id)).map((p) => Number(p.id)), amenityIds: assigned.rows.filter((a) => Number(a.room_id) === Number(r.id)).map((a) => Number(a.amenity_id)) }))}
        amenities={amenities.rows.map((a) => { let tr: Record<string, string> = {}; try { tr = JSON.parse(a.name_translations_json || "{}"); } catch { tr = {}; } return { id: Number(a.id), icon: a.icon, active: Number(a.active) === 1, names: { ...tr, el: a.name_el, en: a.name_en } }; })}
        categories={categories.rows.map((c) => ({ id: Number(c.id), name: lang === "en" ? c.name_en || c.name_el : c.name_el || c.name_en }))}
        canCreate={can(u.role, "rooms.create", u.permissions)}
        canEdit={can(u.role, "rooms.edit", u.permissions)}
        canDelete={can(u.role, "rooms.delete", u.permissions)}
      />
    </section>
  );
}
