// Housekeeping day for the phone page (/hk) and the reception ↔ housekeeping messages.
import { db, withTransaction } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { prefsByEmail } from "@/lib/guest-prefs";
import { prefLines } from "@/lib/guest-prefs-core";
import { hkServiceRows } from "@/lib/hk-services";
import type { HkService } from "@/lib/hk-services-core";
import { hkKindOrder, roomDayKind, roomHasWork, type HkRoomKind } from "@/lib/hk-mobile-core";
import { pushNotification } from "@/lib/pms-notifications";
import { isDesk } from "@/lib/staff-core";
import { deferStaffPush } from "@/lib/staff-push";
import { hotelToday } from "@/lib/tape-chart";

export type HkTask = { id: number; type: string; status: string; assignedTo: string | null; assignedName: string | null; notes: string; inspectionNotes: string; checklist: Record<string, boolean>; cleanedBy: number | null };
export type HkRoom = {
  id: number; code: string; type: string; status: string; kind: HkRoomKind; dnd: boolean;
  departure: { guest: string; departed: boolean } | null;
  arrival: { guest: string; people: number; checkedIn: boolean; prefs: string[] } | null;
  stay: { guest: string; checkOut: string; night: number; nights: number; bookingId: number } | null;
  due: HkService[]; done: HkService[];
  task: HkTask | null; notices: number;
};
export type HkMessage = { id: number; direction: "to_hk" | "to_reception"; from: string; fromId: number; to: string | null; toId: number | null; toSpecialty: string | null; room: string | null; body: string; createdAt: number; read: boolean };

const json = (v: unknown) => { try { return JSON.parse(String(v || "{}")) as Record<string, boolean>; } catch { return {}; } };

export async function hkDay(u: CurrentUser): Promise<{ today: string; rooms: HkRoom[] }> {
  const today = hotelToday();
  const [r, services] = await Promise.all([
    db().query(
      `SELECT r.id,r.code,r.room_type,r.operational_status,(SELECT s.dnd_since FROM tv_screens s WHERE s.owner_id=r.owner_id AND s.room_id=r.id) AS dnd_since,
              dep.guest_name dep_guest,dep.status dep_status,arr.guest_name arr_guest,arr.people arr_people,arr.status arr_status,arr.guest_email arr_email,
              (SELECT count(*)::int FROM maintenance_notices n WHERE n.owner_id=r.owner_id AND n.room_id=r.id AND n.status='open') AS notices,
              t.id task_id,t.task_type,t.status task_status,t.assigned_to,su.display_name assigned_name,t.notes,t.inspection_notes,t.checklist_json,t.cleaned_by_staff_id
         FROM rooms r
         LEFT JOIN LATERAL (SELECT b.guest_name,b.status FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.check_out=$2 AND b.status IN ('confirmed','checked_in','checked_out') ORDER BY b.id DESC LIMIT 1) dep ON true
         LEFT JOIN LATERAL (SELECT b.guest_name,b.guest_email,b.status,(b.adults+b.children) AS people FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.check_in=$2 AND b.status IN ('confirmed','checked_in') ORDER BY b.id DESC LIMIT 1) arr ON true
         LEFT JOIN LATERAL (SELECT * FROM housekeeping_tasks x WHERE x.owner_id=r.owner_id AND x.room_id=r.id AND x.status<>'ready' ORDER BY x.id DESC LIMIT 1) t ON true
         LEFT JOIN pms_staff_users su ON su.owner_id=r.owner_id AND su.id::text=t.assigned_to
        WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,
      [u.ownerId, today],
    ),
    hkServiceRows(u.ownerId, today),
  ]);
  const stays = new Map(services.rows.map((s) => [s.roomId, s]));
  // What the arriving guest likes, so the room is prepared for it (pillow, cot, allergies…).
  const prefs = await prefsByEmail(u.ownerId, r.rows.map((x) => String(x.arr_email ?? "")));
  const rooms = r.rows.map((x): HkRoom => {
    const stay = stays.get(Number(x.id));
    const kind = roomDayKind({ departure: x.dep_guest != null, arrival: x.arr_guest != null, stayover: Boolean(stay) });
    return {
      id: Number(x.id), code: String(x.code), type: String(x.room_type ?? ""), status: String(x.operational_status ?? ""), kind, dnd: x.dnd_since != null,
      departure: x.dep_guest != null ? { guest: String(x.dep_guest), departed: x.dep_status === "checked_out" } : null,
      arrival: x.arr_guest != null ? { guest: String(x.arr_guest), people: Number(x.arr_people ?? 1), checkedIn: x.arr_status === "checked_in", prefs: (() => { const p = prefs.get(String(x.arr_email ?? "").toLowerCase()); return p ? prefLines(p.prefs, "el", { allergies: p.allergies }, true) : []; })() } : null,
      stay: stay ? { guest: stay.guestName, checkOut: stay.checkOut, night: stay.night, nights: stay.nights, bookingId: stay.bookingId } : null,
      due: stay?.due ?? [], done: stay?.done ?? [],
      task: x.task_id != null ? { id: Number(x.task_id), type: String(x.task_type), status: String(x.task_status), assignedTo: x.assigned_to ?? null, assignedName: x.assigned_name ?? null, notes: String(x.notes ?? ""), inspectionNotes: String(x.inspection_notes ?? ""), checklist: json(x.checklist_json), cleanedBy: x.cleaned_by_staff_id == null ? null : Number(x.cleaned_by_staff_id) } : null,
      notices: Number(x.notices ?? 0),
    };
  });
  return {
    today,
    rooms: rooms.filter((x) => roomHasWork({ kind: x.kind, taskOpen: Boolean(x.task), notices: x.notices, due: x.due.length })).sort((a, b) => hkKindOrder[a.kind] - hkKindOrder[b.kind] || a.code.localeCompare(b.code, undefined, { numeric: true })),
  };
}

/**
 * Messages of the last two days. Staff see what they wrote and what was sent to them, to one of their teams or to
 * everyone; the front desk sees all. (Table name kept from v94, when only housekeeping used it.)
 */
export async function hkMessages(u: CurrentUser): Promise<HkMessage[]> {
  const r = await db().query(
    `SELECT m.*,f.display_name from_name,t.display_name to_name,sp.name specialty_name,r.code room_code FROM hk_messages m
       LEFT JOIN pms_staff_users f ON f.owner_id=m.owner_id AND f.id=m.from_staff_id
       LEFT JOIN pms_staff_users t ON t.owner_id=m.owner_id AND t.id=m.to_staff_id
       LEFT JOIN staff_specialties sp ON sp.owner_id=m.owner_id AND sp.id=m.to_specialty_id
       LEFT JOIN rooms r ON r.owner_id=m.owner_id AND r.id=m.room_id
      WHERE m.owner_id=$1 AND m.created_at>$2 AND ($3 OR m.from_staff_id=$4 OR (m.direction='to_hk' AND ${toMe}))
      ORDER BY m.id DESC LIMIT 80`,
    [u.ownerId, Date.now() - 2 * 86_400_000, isDesk(u.role), u.id],
  );
  return r.rows.map((m) => ({ id: Number(m.id), direction: m.direction, from: String(m.from_name ?? ""), fromId: Number(m.from_staff_id), to: m.to_name ?? null, toId: m.to_staff_id == null ? null : Number(m.to_staff_id), toSpecialty: m.specialty_name ?? null, room: m.room_code ?? null, body: String(m.body), createdAt: Number(m.created_at), read: m.read_at != null }));
}

const toMe = `(m.to_staff_id=$4 OR m.to_specialty_id IN (SELECT specialty_id FROM staff_user_specialties WHERE owner_id=m.owner_id AND staff_user_id=$4) OR (m.to_staff_id IS NULL AND m.to_specialty_id IS NULL))`;

/** Staff write to the front desk (a PMS notification with sound); the front desk writes to a person, a team or everyone. */
export async function sendHkMessage(u: CurrentUser, input: { body: string; roomId: number | null; toStaffId: number | null; toSpecialtyId?: number | null }): Promise<void> {
  const desk = isDesk(u.role);
  const direction = desk ? "to_hk" : "to_reception";
  const toStaff = desk ? input.toStaffId : null, toSpecialty = desk && !toStaff ? input.toSpecialtyId ?? null : null;
  let roomCode = "";
  await withTransaction(async (c) => {
    const room = input.roomId ? (await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND id=$2`, [u.ownerId, input.roomId])).rows[0] : null;
    if (input.roomId && !room) throw Error("INVALID_ROOM");
    roomCode = room ? String(room.code) : "";
    if (toStaff && !(await c.query(`SELECT 1 FROM pms_staff_users WHERE owner_id=$1 AND id=$2 AND active=1`, [u.ownerId, toStaff])).rowCount) throw Error("INVALID_STAFF");
    if (toSpecialty && !(await c.query(`SELECT 1 FROM staff_specialties WHERE owner_id=$1 AND id=$2 AND active=1`, [u.ownerId, toSpecialty])).rowCount) throw Error("INVALID_STAFF");
    await c.query(
      `INSERT INTO hk_messages(owner_id,direction,from_staff_id,to_staff_id,to_specialty_id,room_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u.ownerId, direction, u.id, toStaff, toSpecialty, input.roomId, input.body, Date.now()],
    );
    if (!desk) {
      const where = room ? ` · ${room.code}` : "";
      await pushNotification(c, u.ownerId, { kind: "hk_message", titleEl: `💬 ${u.displayName}${where}: ${input.body}`, titleEn: `💬 ${u.displayName}${where}: ${input.body}`, link: "/pms/housekeeping#hk-messages" });
    }
  });
  if (desk) {
    const where = roomCode ? ` · ${roomCode}` : "";
    deferStaffPush(u.ownerId, toStaff ? { userIds: [toStaff] } : toSpecialty ? { specialtyId: toSpecialty } : { staff: true }, {
      kind: "message", url: "/staff?tab=messages",
      title: { el: `💬 ${u.displayName}${where}`, en: `💬 ${u.displayName}${where}` }, body: { el: input.body, en: input.body },
    }, { exceptUserId: u.id });
  }
}

/** Mark what was sent to this person (staff) or to the front desk (desk) as read. */
export async function readHkMessages(u: CurrentUser): Promise<void> {
  if (isDesk(u.role)) await db().query(`UPDATE hk_messages m SET read_at=$2 WHERE m.owner_id=$1 AND m.read_at IS NULL AND m.direction='to_reception'`, [u.ownerId, Date.now()]);
  else await db().query(`UPDATE hk_messages m SET read_at=$3 WHERE m.owner_id=$1 AND m.read_at IS NULL AND m.direction='to_hk' AND ${toMe.replaceAll("$4", "$2")}`, [u.ownerId, u.id, Date.now()]);
}

/** People and teams a message can be addressed to. */
export async function messageTargets(ownerId: string): Promise<{ people: { id: number; name: string }[]; teams: { id: number; name: string }[] }> {
  const [people, teams] = await Promise.all([
    db().query(`SELECT id,display_name FROM pms_staff_users WHERE owner_id=$1 AND active=1 AND role NOT IN ('owner','admin','reception') ORDER BY display_name`, [ownerId]),
    db().query(`SELECT id,name FROM staff_specialties WHERE owner_id=$1 AND active=1 ORDER BY sort,id`, [ownerId]),
  ]);
  return { people: people.rows.map((x) => ({ id: Number(x.id), name: String(x.display_name) })), teams: teams.rows.map((x) => ({ id: Number(x.id), name: String(x.name) })) };
}
