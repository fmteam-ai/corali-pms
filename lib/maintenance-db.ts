// Maintenance notices: database operations shared by the housekeeping board, the tape chart and the maintenance queue.
import type { PoolClient } from "pg";
import { enqueueAvailability } from "@/lib/channel-sync";
import { db } from "@/lib/db";
import { maxPhotosPerNotice, needsSecondPerson, parsePhoto, roomStatusAfterResolution, severityBlocksRoom, type MaintenanceSeverity, type PostRepairState } from "@/lib/maintenance";
import { pushNotification } from "@/lib/pms-notifications";
import { addDays, hotelToday } from "@/lib/tape-chart";

const severityEl: Record<MaintenanceSeverity, string> = { minor: "Μικρή βλάβη", major: "Σοβαρή βλάβη · εκτός λειτουργίας", out_of_order: "Εκτός λειτουργίας" };
const severityEn: Record<MaintenanceSeverity, string> = { minor: "Minor defect", major: "Major defect · out of order", out_of_order: "Out of order" };

async function roomCode(c: PoolClient, ownerId: string, roomId: number) {
  return String((await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, roomId])).rows[0]?.code ?? roomId);
}

/** Log a defect with photos. Blocking severities take the room out of order and push availability to the channels. */
export async function createNotice(c: PoolClient, ownerId: string, input: { roomId: number; taskId?: number | null; severity: MaintenanceSeverity; description: string; reportedBy: number; photos?: string[] }) {
  const room = await c.query(`SELECT id FROM rooms WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, input.roomId]);
  if (!room.rowCount) throw Error("INVALID_ROOM");
  const photos = (input.photos ?? []).map(parsePhoto);
  if (photos.length > maxPhotosPerNotice || photos.some((p) => !p)) throw Error("INVALID_PHOTO");
  const now = Date.now();
  const notice = (await c.query(
    `INSERT INTO maintenance_notices(owner_id,room_id,housekeeping_task_id,severity,description,reported_by,reported_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ownerId, input.roomId, input.taskId ?? null, input.severity, input.description, input.reportedBy, now],
  )).rows[0];
  for (const p of photos) await c.query(`INSERT INTO maintenance_notice_photos(owner_id,notice_id,mime,data_base64,byte_size,uploaded_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [ownerId, notice.id, p!.mime, p!.base64, p!.bytes, input.reportedBy, now]);
  if (severityBlocksRoom(input.severity)) {
    await c.query(`UPDATE rooms SET operational_status='out_of_order' WHERE owner_id=$1 AND id=$2`, [ownerId, input.roomId]);
    const today = hotelToday();
    await enqueueAvailability(c, ownerId, today, addDays(today, 180), "room_status");
  }
  const code = await roomCode(c, ownerId, input.roomId);
  await pushNotification(c, ownerId, { kind: "housekeeping", titleEl: `${severityEl[input.severity]} · δωμάτιο ${code}: ${input.description}`, titleEn: `${severityEn[input.severity]} · room ${code}: ${input.description}`, link: `/pms/maintenance?notice=${notice.id}` });
  return notice;
}

/**
 * Resolve a notice (never deleted). Mandatory notes; optional labour/cost/vendor; the staff choice sets the room to
 * clean (inspected) or dirty with a touch-up clean, unless another blocking notice keeps it out of order.
 */
export async function resolveNotice(c: PoolClient, ownerId: string, input: { id: number; resolverId: number; notes: string; laborHours?: number | null; costCents?: number | null; vendorReference?: string | null; override: PostRepairState }) {
  const n = (await c.query(`SELECT * FROM maintenance_notices WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, input.id])).rows[0];
  if (!n) throw Error("NOT_FOUND");
  if (n.status !== "open") throw Error("ALREADY_RESOLVED");
  if (needsSecondPerson(n, input.resolverId)) throw Error("SECOND_REVIEW_REQUIRED");
  await c.query(`SELECT id FROM rooms WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, n.room_id]);
  const now = Date.now();
  const updated = (await c.query(
    `UPDATE maintenance_notices SET status='resolved',resolved_by=$3,resolved_at=$4,resolution_notes=$5,labor_hours=$6,cost_cents=$7,vendor_reference=$8,post_repair_state=$9 WHERE owner_id=$1 AND id=$2 RETURNING *`,
    [ownerId, input.id, input.resolverId, now, input.notes, input.laborHours ?? null, input.costCents ?? null, input.vendorReference || null, input.override],
  )).rows[0];
  const others = await c.query(`SELECT severity FROM maintenance_notices WHERE owner_id=$1 AND room_id=$2 AND status='open'`, [ownerId, n.room_id]);
  const otherBlockingOpen = others.rows.some((r) => severityBlocksRoom(r.severity));
  const roomStatus = roomStatusAfterResolution({ otherBlockingOpen, override: input.override });
  const wasOut = (await c.query(`SELECT operational_status FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, n.room_id])).rows[0]?.operational_status === "out_of_order";
  await c.query(`UPDATE rooms SET operational_status=$1 WHERE owner_id=$2 AND id=$3`, [roomStatus, ownerId, n.room_id]);
  if (!otherBlockingOpen) {
    // Close the housekeeping repair task that raised it (the resolver is the second sign-off).
    await c.query(
      `UPDATE housekeeping_tasks SET status='ready',inspection_status='approved',inspected_by_staff_id=$3,inspected_at=$4,completed_at=COALESCE(completed_at,$4)
        WHERE owner_id=$1 AND room_id=$2 AND status IN ('out_of_order','repaired')`,
      [ownerId, n.room_id, input.resolverId, now],
    );
  }
  if (roomStatus === "dirty") {
    await c.query(
      `INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,assigned_to,notes,due_at,checklist_json,inspection_status)
       SELECT $1,$2,'touch_up','todo',(SELECT staff_user_id::text FROM housekeeping_staff_room_defaults WHERE owner_id=$1 AND room_id=$2 ORDER BY staff_user_id LIMIT 1),$4,$3,'{}','pending'
        WHERE NOT EXISTS (SELECT 1 FROM housekeeping_tasks WHERE owner_id=$1 AND room_id=$2 AND status IN ('todo','in_progress','cleaned'))`,
      [ownerId, n.room_id, now, `Μετά την επισκευή / After repair: ${input.notes}`.slice(0, 2000)],
    );
  }
  if (wasOut && roomStatus !== "out_of_order") { const today = hotelToday(); await enqueueAvailability(c, ownerId, today, addDays(today, 180), "room_status"); }
  const code = await roomCode(c, ownerId, n.room_id);
  await pushNotification(c, ownerId, {
    kind: "housekeeping",
    titleEl: roomStatus === "out_of_order" ? `Βλάβη δωματίου ${code} επιλύθηκε · παραμένει εκτός λειτουργίας (ανοιχτές βλάβες)` : `Βλάβη δωματίου ${code} επιλύθηκε · ${roomStatus === "clean" ? "καθαρό & έτοιμο" : "χρειάζεται καθαρισμό"}`,
    titleEn: roomStatus === "out_of_order" ? `Room ${code} defect resolved · still out of order (open defects)` : `Room ${code} defect resolved · ${roomStatus === "clean" ? "clean & ready" : "needs a touch-up clean"}`,
    link: `/pms/maintenance?notice=${n.id}`,
  });
  return { notice: updated, roomStatus };
}

/** Tape-chart badge columns for a rooms query aliased "r": open count plus the most severe open notice for the hover card. */
export const roomNoticeSql = `(SELECT count(*)::int FROM maintenance_notices n WHERE n.owner_id=r.owner_id AND n.room_id=r.id AND n.status='open') AS open_notices,
  (SELECT json_build_object('id',n.id,'severity',n.severity,'description',n.description,'reported_at',n.reported_at,'reporter',u.display_name,'photos',(SELECT count(*) FROM maintenance_notice_photos p WHERE p.owner_id=n.owner_id AND p.notice_id=n.id))
     FROM maintenance_notices n LEFT JOIN pms_staff_users u ON u.owner_id=n.owner_id AND u.id=n.reported_by
    WHERE n.owner_id=r.owner_id AND n.room_id=r.id AND n.status='open'
    ORDER BY CASE n.severity WHEN 'out_of_order' THEN 3 WHEN 'major' THEN 2 ELSE 1 END DESC, n.reported_at DESC LIMIT 1) AS top_notice`;

const noticeColumns = `n.id,n.room_id,r.code room_code,r.room_type,r.operational_status,n.housekeeping_task_id,n.severity,n.description,n.reported_by,rep.display_name reporter_name,n.reported_at,n.status,
  n.resolved_by,res.display_name resolver_name,n.resolved_at,n.resolution_notes,n.labor_hours,n.cost_cents,n.vendor_reference,n.post_repair_state,
  COALESCE((SELECT json_agg(p.id ORDER BY p.id) FROM maintenance_notice_photos p WHERE p.owner_id=n.owner_id AND p.notice_id=n.id),'[]'::json) photo_ids`;
const noticeJoins = `FROM maintenance_notices n JOIN rooms r ON r.owner_id=n.owner_id AND r.id=n.room_id
  LEFT JOIN pms_staff_users rep ON rep.owner_id=n.owner_id AND rep.id=n.reported_by LEFT JOIN pms_staff_users res ON res.owner_id=n.owner_id AND res.id=n.resolved_by`;

export async function listNotices(ownerId: string, filter: { status?: "open" | "resolved" | "all"; roomId?: number | null; limit?: number } = {}) {
  const status = filter.status ?? "all";
  const r = await db().query(
    `SELECT ${noticeColumns} ${noticeJoins} WHERE n.owner_id=$1 AND ($2='all' OR n.status=$2) AND ($3::bigint IS NULL OR n.room_id=$3)
      ORDER BY (n.status='open') DESC, n.reported_at DESC LIMIT $4`,
    [ownerId, status, filter.roomId ?? null, Math.min(500, filter.limit ?? 200)],
  );
  return r.rows;
}

export async function getNotice(ownerId: string, id: number) {
  return (await db().query(`SELECT ${noticeColumns} ${noticeJoins} WHERE n.owner_id=$1 AND n.id=$2`, [ownerId, id])).rows[0] ?? null;
}
