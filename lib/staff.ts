// Specialties (teams such as Housekeeping, Bar, Kitchen) and shifts, managed in PMS → Staff; read by the Corali Staff app.
import type { CurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { deferStaffPush } from "@/lib/staff-push";
import { hexColor, normalizeModules, shiftsOverlap, userModules, validTime, type StaffModule } from "@/lib/staff-core";

export type Specialty = { id: number; name: string; color: string; modules: StaffModule[]; members: number[] };
export type Shift = { id: number; userId: number; userName: string; date: string; start: string; end: string; specialtyId: number | null; note: string };
export type StaffPerson = { id: number; name: string; role: string; specialties: number[] };

/** A new hotel starts with three teams; after that the hotel adds, renames or removes them. */
const starters: { name: string; color: string; modules: StaffModule[] }[] = [
  { name: "Καθαριότητα", color: "#2a7d8f", modules: ["housekeeping"] },
  { name: "Ρεσεψιόν", color: "#c47a1c", modules: ["reception"] },
  { name: "Συντήρηση", color: "#8a4fb3", modules: ["maintenance"] },
];

export async function listSpecialties(ownerId: string): Promise<Specialty[]> {
  const exists = await db().query(`SELECT 1 FROM staff_specialties WHERE owner_id=$1 LIMIT 1`, [ownerId]);
  if (!exists.rowCount) {
    await withTransaction(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('staff_specialties:' || $1))`, [ownerId]);
      if ((await c.query(`SELECT 1 FROM staff_specialties WHERE owner_id=$1 LIMIT 1`, [ownerId])).rowCount) return;
      for (const [i, s] of starters.entries()) await c.query(`INSERT INTO staff_specialties(owner_id,name,color,modules_json,sort,created_at) VALUES($1,$2,$3,$4,$5,$6)`, [ownerId, s.name, s.color, JSON.stringify(s.modules), i, Date.now()]);
      // Existing housekeepers join the housekeeping team.
      await c.query(`INSERT INTO staff_user_specialties(owner_id,staff_user_id,specialty_id) SELECT $1,u.id,s.id FROM pms_staff_users u JOIN staff_specialties s ON s.owner_id=u.owner_id AND s.sort=0 WHERE u.owner_id=$1 AND u.role='housekeeping' ON CONFLICT DO NOTHING`, [ownerId]);
    });
  }
  const r = await db().query(
    `SELECT s.id,s.name,s.color,s.modules_json,COALESCE(array_agg(us.staff_user_id) FILTER (WHERE us.staff_user_id IS NOT NULL),'{}') AS members
       FROM staff_specialties s LEFT JOIN staff_user_specialties us ON us.owner_id=s.owner_id AND us.specialty_id=s.id
      WHERE s.owner_id=$1 AND s.active=1 GROUP BY s.id ORDER BY s.sort,s.id`,
    [ownerId],
  );
  return r.rows.map((s) => ({ id: Number(s.id), name: String(s.name), color: hexColor(s.color), modules: normalizeModules(s.modules_json), members: (s.members as unknown[]).map(Number) }));
}

export async function saveSpecialty(ownerId: string, x: { id?: number; name: string; color: string; modules: StaffModule[]; members: number[] }): Promise<void> {
  await withTransaction(async (c) => {
    let id = x.id;
    if (id) {
      const r = await c.query(`UPDATE staff_specialties SET name=$3,color=$4,modules_json=$5 WHERE owner_id=$1 AND id=$2 AND active=1`, [ownerId, id, x.name, hexColor(x.color), JSON.stringify(x.modules)]);
      if (!r.rowCount) throw Error("NOT_FOUND");
    } else {
      const sort = Number((await c.query(`SELECT COALESCE(max(sort),0)+1 AS n FROM staff_specialties WHERE owner_id=$1`, [ownerId])).rows[0].n);
      id = Number((await c.query(`INSERT INTO staff_specialties(owner_id,name,color,modules_json,sort,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [ownerId, x.name, hexColor(x.color), JSON.stringify(x.modules), sort, Date.now()])).rows[0].id);
    }
    const valid = (await c.query(`SELECT id FROM pms_staff_users WHERE owner_id=$1 AND id=ANY($2::bigint[])`, [ownerId, x.members])).rows.map((r) => Number(r.id));
    await c.query(`DELETE FROM staff_user_specialties WHERE owner_id=$1 AND specialty_id=$2`, [ownerId, id]);
    for (const m of valid) await c.query(`INSERT INTO staff_user_specialties(owner_id,staff_user_id,specialty_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [ownerId, m, id]);
  });
}

/** Removing a team keeps past shifts (they lose the team colour) but drops the memberships. */
export async function deleteSpecialty(ownerId: string, id: number): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`UPDATE staff_specialties SET active=0 WHERE owner_id=$1 AND id=$2`, [ownerId, id]);
    await c.query(`DELETE FROM staff_user_specialties WHERE owner_id=$1 AND specialty_id=$2`, [ownerId, id]);
  });
}

export async function staffPeople(ownerId: string): Promise<StaffPerson[]> {
  const r = await db().query(
    `SELECT u.id,u.display_name,u.role,COALESCE(array_agg(us.specialty_id) FILTER (WHERE us.specialty_id IS NOT NULL),'{}') AS specialties
       FROM pms_staff_users u LEFT JOIN staff_user_specialties us ON us.owner_id=u.owner_id AND us.staff_user_id=u.id
      WHERE u.owner_id=$1 AND u.active=1 GROUP BY u.id ORDER BY u.display_name`,
    [ownerId],
  );
  return r.rows.map((u) => ({ id: Number(u.id), name: String(u.display_name), role: String(u.role), specialties: (u.specialties as unknown[]).map(Number) }));
}

/** The signed-in person: teams and the app sections they open. */
export async function staffMe(u: CurrentUser): Promise<{ specialties: Specialty[]; modules: StaffModule[] }> {
  const all = await listSpecialties(u.ownerId);
  const mine = all.filter((s) => s.members.includes(u.id));
  return { specialties: mine, modules: userModules(u.role, mine.map((s) => s.modules)) };
}

export async function listShifts(ownerId: string, from: string, to: string, userId?: number): Promise<Shift[]> {
  const r = await db().query(
    `SELECT s.id,s.staff_user_id,u.display_name,s.date,s.start_time,s.end_time,s.specialty_id,s.note FROM staff_shifts s
       JOIN pms_staff_users u ON u.owner_id=s.owner_id AND u.id=s.staff_user_id
      WHERE s.owner_id=$1 AND s.date>=$2 AND s.date<=$3 AND ($4::bigint IS NULL OR s.staff_user_id=$4) ORDER BY s.date,s.start_time,u.display_name`,
    [ownerId, from, to, userId ?? null],
  );
  return r.rows.map((s) => ({ id: Number(s.id), userId: Number(s.staff_user_id), userName: String(s.display_name), date: String(s.date), start: String(s.start_time), end: String(s.end_time), specialtyId: s.specialty_id == null ? null : Number(s.specialty_id), note: String(s.note ?? "") }));
}

const dayLabel = (date: string, lang: "el" | "en") => new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });

/** Add or change a shift; the person gets an alert on the phone. */
export async function saveShift(u: CurrentUser, x: { id?: number; userId: number; date: string; start: string; end: string; specialtyId: number | null; note: string }): Promise<number> {
  if (!validTime(x.start) || !validTime(x.end) || x.start === x.end || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw Error("INVALID_SHIFT");
  const id = await withTransaction(async (c) => {
    if (!(await c.query(`SELECT 1 FROM pms_staff_users WHERE owner_id=$1 AND id=$2 AND active=1`, [u.ownerId, x.userId])).rowCount) throw Error("INVALID_STAFF");
    if (x.specialtyId && !(await c.query(`SELECT 1 FROM staff_specialties WHERE owner_id=$1 AND id=$2 AND active=1`, [u.ownerId, x.specialtyId])).rowCount) throw Error("INVALID_SPECIALTY");
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('staff_shift:' || $1 || ':' || $2))`, [u.ownerId, x.userId]);
    const same = (await c.query(`SELECT id,start_time,end_time FROM staff_shifts WHERE owner_id=$1 AND staff_user_id=$2 AND date=$3 AND id<>$4`, [u.ownerId, x.userId, x.date, x.id ?? 0])).rows;
    if (same.some((s) => shiftsOverlap({ start: s.start_time, end: s.end_time }, x))) throw Error("SHIFT_OVERLAP");
    const now = Date.now();
    if (x.id) {
      const r = await c.query(`UPDATE staff_shifts SET staff_user_id=$3,date=$4,start_time=$5,end_time=$6,specialty_id=$7,note=$8,updated_at=$9 WHERE owner_id=$1 AND id=$2 RETURNING id`, [u.ownerId, x.id, x.userId, x.date, x.start, x.end, x.specialtyId, x.note, now]);
      if (!r.rowCount) throw Error("NOT_FOUND");
      return x.id;
    }
    return Number((await c.query(`INSERT INTO staff_shifts(owner_id,staff_user_id,date,start_time,end_time,specialty_id,note,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`, [u.ownerId, x.userId, x.date, x.start, x.end, x.specialtyId, x.note, u.id, now])).rows[0].id);
  });
  deferStaffPush(u.ownerId, { userIds: [x.userId] }, {
    kind: "shift", tag: `shift-${id}`, url: "/staff?tab=shifts",
    title: { el: x.id ? "Αλλαγή βάρδιας" : "Νέα βάρδια", en: x.id ? "Shift changed" : "New shift" },
    body: { el: `${dayLabel(x.date, "el")} · ${x.start}–${x.end}${x.note ? ` · ${x.note}` : ""}`, en: `${dayLabel(x.date, "en")} · ${x.start}–${x.end}${x.note ? ` · ${x.note}` : ""}` },
  }, { committed: { table: "staff_shifts", id }, exceptUserId: u.id });
  return id;
}

export async function deleteShift(u: CurrentUser, id: number): Promise<void> {
  const r = (await db().query(`DELETE FROM staff_shifts WHERE owner_id=$1 AND id=$2 RETURNING staff_user_id,date,start_time,end_time`, [u.ownerId, id])).rows[0];
  if (!r) throw Error("NOT_FOUND");
  deferStaffPush(u.ownerId, { userIds: [Number(r.staff_user_id)] }, {
    kind: "shift", tag: `shift-${id}`, url: "/staff?tab=shifts",
    title: { el: "Ακύρωση βάρδιας", en: "Shift cancelled" },
    body: { el: `${dayLabel(String(r.date), "el")} · ${r.start_time}–${r.end_time}`, en: `${dayLabel(String(r.date), "en")} · ${r.start_time}–${r.end_time}` },
  }, { exceptUserId: u.id });
}

/** Copy one week's shifts onto the next week (skips any that would overlap what is already there). */
export async function copyWeek(u: CurrentUser, fromMonday: string, toMonday: string): Promise<number> {
  const shift = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + (Date.parse(`${toMonday}T00:00:00Z`) - Date.parse(`${fromMonday}T00:00:00Z`))).toISOString().slice(0, 10);
  const source = await listShifts(u.ownerId, fromMonday, new Date(Date.parse(`${fromMonday}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10));
  return withTransaction(async (c) => {
    let copied = 0;
    for (const s of source) {
      const date = shift(s.date);
      const same = (await c.query(`SELECT start_time,end_time FROM staff_shifts WHERE owner_id=$1 AND staff_user_id=$2 AND date=$3`, [u.ownerId, s.userId, date])).rows;
      if (same.some((x) => shiftsOverlap({ start: x.start_time, end: x.end_time }, s))) continue;
      await c.query(`INSERT INTO staff_shifts(owner_id,staff_user_id,date,start_time,end_time,specialty_id,note,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [u.ownerId, s.userId, date, s.start, s.end, s.specialtyId, s.note, u.id, Date.now()]);
      copied++;
    }
    return copied;
  });
}
