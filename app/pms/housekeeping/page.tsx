import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { roomNoticeSql } from "@/lib/maintenance-db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { HousekeepingBoard } from "./board";
import { HousekeepingServices } from "./services";
import { hkServiceRows } from "@/lib/hk-services";
import { housekeepers } from "@/lib/hk-mobile";
import { HkMessages } from "./hk-messages";

export default async function HousekeepingPage() {
  const u = await requireUser("housekeeping.read");
  const { lang, t } = await getPmsT();
  const [tasks, rooms, services, staff] = await Promise.all([
    db().query(
      `SELECT t.*,r.code room_code,r.room_type,s.display_name assigned_name FROM housekeeping_tasks t
         JOIN rooms r ON r.id=t.room_id AND r.owner_id=t.owner_id
         LEFT JOIN pms_staff_users s ON s.owner_id=t.owner_id AND s.id::text=t.assigned_to
        WHERE t.owner_id=$1 AND (t.status<>'ready' OR t.inspected_at>(extract(epoch from now())*1000)::bigint-86400000)
          AND ($2<>'housekeeping' OR t.assigned_to=$3 OR (t.status IN ('cleaned','repaired') AND t.cleaned_by_staff_id<>$4))
        ORDER BY CASE t.status WHEN 'out_of_order' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 WHEN 'cleaned' THEN 3 WHEN 'repaired' THEN 3 ELSE 4 END, r.code`,
      [u.ownerId, u.role, String(u.id), u.id],
    ),
    db().query(
      `SELECT r.id,r.code,r.operational_status,(SELECT t.status FROM housekeeping_tasks t WHERE t.owner_id=r.owner_id AND t.room_id=r.id AND t.status<>'ready' ORDER BY t.id DESC LIMIT 1) AS open_task_status,(SELECT s.dnd_since FROM tv_screens s WHERE s.owner_id=r.owner_id AND s.room_id=r.id) AS dnd_since,${roomNoticeSql}
         FROM rooms r WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,
      [u.ownerId],
    ),
    hkServiceRows(u.ownerId),
    housekeepers(u.ownerId),
  ]);
  return (
    <section className="hkPage">
      <div className="pageTitle"><div><h1>{t("hkb.title")}</h1><p>{t("hkb.subtitle")}</p></div>{can(u.role, "users.manage", u.permissions) && <Link className="secondaryLink" href="/pms/housekeeping/settings">{t("hkb.settings")}</Link>}</div>
      <HousekeepingServices lang={lang} initial={services} canWrite={can(u.role, "housekeeping.write", u.permissions)} />
      <HkMessages lang={lang} me={u.id} staff={staff} rooms={rooms.rows.map((r) => ({ id: Number(r.id), code: String(r.code) }))} />
      <HousekeepingBoard lang={lang} initialTasks={tasks.rows} rooms={rooms.rows} userId={u.id} canWrite={can(u.role, "housekeeping.write", u.permissions)} canResolve={can(u.role, "maintenance.resolve", u.permissions)} />
    </section>
  );
}
