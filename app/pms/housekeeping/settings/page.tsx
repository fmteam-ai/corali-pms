import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { InspectorSettings } from "./inspectors";
import { HousekeepingSettings } from "./settings";

export default async function Page() {
  const u = await requireUser("users.manage");
  const [s, r, d, people, inspectors] = await Promise.all([
    db().query(`SELECT id,display_name,role FROM pms_staff_users WHERE owner_id=$1 AND active=1 AND role IN('housekeeping','admin','owner') ORDER BY display_name`, [u.ownerId]),
    db().query(`SELECT id,code,room_type FROM rooms WHERE owner_id=$1 AND active=1 ORDER BY code`, [u.ownerId]),
    db().query(`SELECT staff_user_id,room_id FROM housekeeping_staff_room_defaults WHERE owner_id=$1`, [u.ownerId]),
    // v185: who can be the second person: anyone who works in housekeeping, at the front desk or manages (they can open Housekeeping).
    db().query(`SELECT id,display_name,role FROM pms_staff_users WHERE owner_id=$1 AND active=1 AND role IN('housekeeping','reception','admin','owner') ORDER BY display_name`, [u.ownerId]),
    db().query(`SELECT room_id,staff_user_id FROM housekeeping_room_inspectors WHERE owner_id=$1`, [u.ownerId]),
  ]);
  return (
    <section>
      <h1>Αναθέσεις housekeeping</h1>
      <p>Ορίστε τα συνήθη δωμάτια κάθε μέλους. Οι νέες εργασίες ανατίθενται αυτόματα.</p>
      <p><Link className="secondaryLink" href="/pms/users">Προσθήκη και διαχείριση μελών προσωπικού</Link></p>
      <HousekeepingSettings staff={s.rows} rooms={r.rows} defaults={d.rows} />
      <InspectorSettings people={people.rows.map((p) => ({ id: Number(p.id), name: String(p.display_name), role: String(p.role) }))} rooms={r.rows.map((x) => ({ id: Number(x.id), code: String(x.code), room_type: String(x.room_type) }))} initial={Object.fromEntries(inspectors.rows.map((x) => [Number(x.room_id), Number(x.staff_user_id)]))} />
    </section>
  );
}
