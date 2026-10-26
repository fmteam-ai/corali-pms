// Housekeeping day for the phone page (/hk) and the reception ↔ housekeeping messages.
import { db, withTransaction } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { hkServiceRows } from "@/lib/hk-services";
import type { HkService } from "@/lib/hk-services-core";
import { hkKindOrder, roomDayKind, roomHasWork, type HkRoomKind } from "@/lib/hk-mobile-core";
import { pushNotification } from "@/lib/pms-notifications";
import { hotelToday } from "@/lib/tape-chart";

export type HkTask = { id: number; type: string; status: string; assignedTo: string | null; assignedName: string | null; notes: string; inspectionNotes: string; checklist: Record<string, boolean>; cleanedBy: number | null };
export type HkRoom = {
  id: number; code: string; type: string; status: string; kind: HkRoomKind; dnd: boolean;
  departure: { guest: string; departed: boolean } | null;
  arrival: { guest: string; people: number; checkedIn: boolean } | null;
  stay: { guest: string; checkOut: string; night: number; nights: number; bookingId: number } | null;
  due: HkService[]; done: HkService[];
  task: HkTask | null; notices: number;
};
export type HkMessage = { id: number; direction: "to_hk" | "to_reception"; from: string; fromId: number; to: string | null; toId: number | null; room: string | null; body: string; createdAt: number; read: boolean };

const json = (v: unknown) => { try { return JSON.parse(String(v || "{}")) as Record<string, boolean>; } catch { return {}; } };

export async function hkDay(u: CurrentUser): Promise<{ today: string; rooms: HkRoom[] }> {
  const today = hotelToday();
  const [r, services] = await Promise.all([
    db().query(
      `SELECT r.id,r.code,r.room_type,r.operational_status,(SELECT s.dnd_since FROM tv_screens s WHERE s.owner_id=r.owner_id AND s.room_id=r.id) AS dnd_since,
              dep.guest_name dep_guest,dep.status dep_status,arr.guest_name arr_guest,arr.people arr_people,arr.status arr_status,
              (SELECT count(*)::int FROM maintenance_notices n WHERE n.owner_id=r.owner_id AND n.room_id=r.id AND n.status='open') AS notices,
              t.id task_id,t.task_type,t.status task_status,t.assigned_to,su.display_name assigned_name,t.notes,t.inspection_notes,t.checklist_json,t.cleaned_by_staff_id
         FROM rooms r
         LEFT JOIN LATERAL (SELECT b.guest_name,b.status FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.check_out=$2 AND b.status IN ('confirmed','checked_in','checked_out') ORDER BY b.id DESC LIMIT 1) dep ON true
         LEFT JOIN LATERAL (SELECT b.guest_name,b.status,(b.adults+b.children) AS people FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.check_in=$2 AND b.status IN ('confirmed','checked_in') ORDER BY b.id DESC LIMIT 1) arr ON true
         LEFT JOIN LATERAL (SELECT * FROM housekeeping_tasks x WHERE x.owner_id=r.owner_id AND x.room_id=r.id AND x.status<>'ready' ORDER BY x.id DESC LIMIT 1) t ON true
         LEFT JOIN pms_staff_users su ON su.owner_id=r.owner_id AND su.id::text=t.assigned_to
        WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,
      [u.ownerId, today],
    ),
    hkServiceRows(u.ownerId, today),
  ]);
  const stays = new Map(services.rows.map((s) => [s.roomId, s]));
  const rooms = r.rows.map((x): HkRoom => {
    const stay = stays.get(Number(x.id));
    const kind = roomDayKind({ departure: x.dep_guest != null, arrival: x.arr_guest != null, stayover: Boolean(stay) });
    return {
      id: Number(x.id), code: String(x.code), type: String(x.room_type ?? ""), status: String(x.operational_status ?? ""), kind, dnd: x.dnd_since != null,
      departure: x.dep_guest != null ? { guest: String(x.dep_guest), departed: x.dep_status === "checked_out" } : null,
      arrival: x.arr_guest != null ? { guest: String(x.arr_guest), people: Number(x.arr_people ?? 1), checkedIn: x.arr_status === "checked_in" } : null,
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

/** Last two days of messages: a housekeeper sees the ones to everyone or to them, and their own; reception sees all. */
export async function hkMessages(u: CurrentUser): Promise<HkMessage[]> {
  const r = await db().query(
    `SELECT m.*,f.display_name from_name,t.display_name to_name,r.code room_code FROM hk_messages m
       LEFT JOIN pms_staff_users f ON f.owner_id=m.owner_id AND f.id=m.from_staff_id
       LEFT JOIN pms_staff_users t ON t.owner_id=m.owner_id AND t.id=m.to_staff_id
       LEFT JOIN rooms r ON r.owner_id=m.owner_id AND r.id=m.room_id
      WHERE m.owner_id=$1 AND m.created_at>$2 AND ($3<>'housekeeping' OR m.from_staff_id=$4 OR (m.direction='to_hk' AND (m.to_staff_id IS NULL OR m.to_staff_id=$4)))
      ORDER BY m.id DESC LIMIT 60`,
    [u.ownerId, Date.now() - 2 * 86_400_000, u.role, u.id],
  );
  return r.rows.map((m) => ({ id: Number(m.id), direction: m.direction, from: String(m.from_name ?? ""), fromId: Number(m.from_staff_id), to: m.to_name ?? null, toId: m.to_staff_id == null ? null : Number(m.to_staff_id), room: m.room_code ?? null, body: String(m.body), createdAt: Number(m.created_at), read: m.read_at != null }));
}

/** Housekeepers write to reception (a PMS notification with sound); everyone else writes to housekeeping. */
export async function sendHkMessage(u: CurrentUser, input: { body: string; roomId: number | null; toStaffId: number | null }): Promise<void> {
  const direction = u.role === "housekeeping" ? "to_reception" : "to_hk";
  await withTransaction(async (c) => {
    const room = input.roomId ? (await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND id=$2`, [u.ownerId, input.roomId])).rows[0] : null;
    if (input.roomId && !room) throw Error("INVALID_ROOM");
    if (direction === "to_hk" && input.toStaffId && !(await c.query(`SELECT 1 FROM pms_staff_users WHERE owner_id=$1 AND id=$2 AND active=1`, [u.ownerId, input.toStaffId])).rowCount) throw Error("INVALID_STAFF");
    await c.query(
      `INSERT INTO hk_messages(owner_id,direction,from_staff_id,to_staff_id,room_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [u.ownerId, direction, u.id, direction === "to_hk" ? input.toStaffId : null, input.roomId, input.body, Date.now()],
    );
    if (direction === "to_reception") {
      const where = room ? ` · ${room.code}` : "";
      await pushNotification(c, u.ownerId, { kind: "hk_message", titleEl: `💬 ${u.displayName}${where}: ${input.body}`, titleEn: `💬 ${u.displayName}${where}: ${input.body}`, link: "/pms/housekeeping#hk-messages" });
    }
  });
}

/** Mark the messages addressed to this user (housekeepers) or to reception (everyone else) as read. */
export async function readHkMessages(u: CurrentUser): Promise<void> {
  await db().query(
    u.role === "housekeeping"
      ? `UPDATE hk_messages SET read_at=$3 WHERE owner_id=$1 AND read_at IS NULL AND direction='to_hk' AND (to_staff_id IS NULL OR to_staff_id=$2)`
      : `UPDATE hk_messages SET read_at=$3 WHERE owner_id=$1 AND read_at IS NULL AND direction='to_reception' AND $2::bigint IS NOT NULL`,
    [u.ownerId, u.id, Date.now()],
  );
}

/** Staff a message can be addressed to. */
export async function housekeepers(ownerId: string): Promise<{ id: number; name: string }[]> {
  const r = await db().query(`SELECT id,display_name FROM pms_staff_users WHERE owner_id=$1 AND active=1 AND role='housekeeping' ORDER BY display_name`, [ownerId]);
  return r.rows.map((x) => ({ id: Number(x.id), name: String(x.display_name) }));
}
