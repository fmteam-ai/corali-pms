import { audited } from "@/lib/audit";
import { closeCleaningRequests } from "@/lib/guest-room";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { createNotice } from "@/lib/maintenance-db";
import { maintenanceSeverities, severityBlocksRoom, severityFrom } from "@/lib/maintenance";
import { canApproveInspection, nextHousekeepingStatus, roomStatusAfter, validChecklist, validHousekeepingTransition } from "@/lib/housekeeping";
import { can } from "@/lib/security/permissions";
import { pushNotification } from "@/lib/pms-notifications";
import { enqueueAvailability } from "@/lib/channel-sync";
import { addDays, hotelToday } from "@/lib/tape-chart";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { deferStaffPush } from "@/lib/staff-push";
import { etaOnComplete, etaOnStart } from "../../../../../scripts/room-ready-core.mjs";

const schema = z.object({
  action: z.enum(["start", "complete", "approve", "reject", "report_issue", "repair_done", "set_eta"]),
  // v187: expected ready time (epoch ms) for «set_eta»; null clears it.
  expectedReadyAt: z.number().int().positive().nullable().optional(),
  checklist: z.record(z.string(), z.boolean()).optional(),
  notes: z.string().trim().max(2000).optional(),
  severe: z.boolean().optional(),
  severity: z.enum(maintenanceSeverities).optional(),
  photos: z.array(z.string().max(3_500_000)).max(6).optional(),
});

const errorStatus: Record<string, number> = { INVALID_ETA: 400, NOT_FOUND: 404, NOT_ASSIGNED: 403, INSPECTOR_ONLY: 403, FORBIDDEN: 403, CHECKLIST_INCOMPLETE: 409, SECOND_REVIEW_REQUIRED: 409, INVALID_TRANSITION: 409, DESCRIPTION_REQUIRED: 400, INVALID_PHOTO: 400 };

async function handlePATCH(q: Request, { params }: { params: Promise<{ id: string }> }) {
  // v185: approving needs «housekeeping.inspect» or being the room's second person (checked below), not «write».
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(q);
    const id = Number((await params).id), x = schema.parse(await q.json());
    if (!Number.isSafeInteger(id) || id < 1) return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    const task = await withTransaction(async (c) => {
      const r = (await c.query(`SELECT * FROM housekeeping_tasks WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, id])).rows[0];
      if (!r) throw Error("NOT_FOUND");
      const review = x.action === "approve" || x.action === "reject";
      if (review) {
        // v185: the second person set for the room, or anyone with «housekeeping.inspect» (owner / admin by default).
        const inspector = (await c.query(`SELECT staff_user_id FROM housekeeping_room_inspectors WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, r.room_id])).rows[0];
        const cleaner = r.cleaned_by_staff_id === null ? null : Number(r.cleaned_by_staff_id);
        if (!canApproveInspection({ userId: u.id, canInspect: can(u.role, "housekeeping.inspect", u.permissions), cleanerId: cleaner, inspectorId: inspector ? Number(inspector.staff_user_id) : null })) {
          throw Error(inspector && Number(inspector.staff_user_id) === u.id ? "SECOND_REVIEW_REQUIRED" : "INSPECTOR_ONLY");
        }
      } else {
        // Cleaning, defects and repairs: «housekeeping.write»; housekeeping staff only on the rooms given to them.
        if (!can(u.role, "housekeeping.write", u.permissions)) throw Error("FORBIDDEN");
        if (u.role === "housekeeping" && r.assigned_to !== String(u.id)) throw Error("NOT_ASSIGNED");
      }
      // v187: «Έτοιμο έως»: only the expected ready time changes (an open task; today's availability is sent again).
      if (x.action === "set_eta") {
        if (!["todo", "in_progress", "cleaned", "repaired"].includes(String(r.status))) throw Error("INVALID_TRANSITION");
        const eta = x.expectedReadyAt ?? null;
        if (eta !== null && (eta < Date.now() - 5 * 60_000 || eta > Date.now() + 2 * 86_400_000)) throw Error("INVALID_ETA");
        const saved = await c.query(`UPDATE housekeeping_tasks SET expected_ready_at=$3 WHERE owner_id=$1 AND id=$2 RETURNING *`, [u.ownerId, id, eta]);
        const today = hotelToday(); await enqueueAvailability(c, u.ownerId, today, today, "room_ready");
        return saved.rows[0];
      }
      if (!validHousekeepingTransition(r.status, x.action)) throw Error("INVALID_TRANSITION");
      if ((x.action === "report_issue" || x.action === "reject" || x.action === "repair_done") && !x.notes) throw Error("DESCRIPTION_REQUIRED");
      if (x.action === "complete" && !validChecklist(x.checklist, r.task_type)) throw Error("CHECKLIST_INCOMPLETE");

      const now = Date.now();
      const severity = severityFrom(x);
      const severe = x.action === "report_issue" && severityBlocksRoom(severity);
      const status = nextHousekeepingStatus(r.status, x.action, severe);
      let { inspection_status: inspection, completed_at: completed, cleaned_by_staff_id: cleaner, inspected_by_staff_id: inspector, inspected_at: inspectedAt, checklist_json: list } = r;
      if (x.action === "complete" || x.action === "repair_done") { inspection = "pending"; completed = now; cleaner = u.id; if (x.checklist) list = JSON.stringify(x.checklist); }
      if (review) { inspection = x.action === "approve" ? "approved" : "rejected"; inspector = u.id; inspectedAt = now; }
      const updated = await c.query(
        `UPDATE housekeeping_tasks SET status=$1,inspection_status=$2,completed_at=$3,started_at=CASE WHEN $9='start' THEN COALESCE(started_at,$12) ELSE started_at END,
                cleaned_by_staff_id=$4,inspected_by_staff_id=$5,inspected_at=$6,checklist_json=$7,
                notes=CASE WHEN $9 IN ('report_issue','repair_done') AND $8::text IS NOT NULL THEN concat_ws(E'\\n',NULLIF(notes,''),$8::text) ELSE notes END,
                inspection_notes=CASE WHEN $9='reject' THEN $8 ELSE inspection_notes END,photo_data=NULL
          WHERE owner_id=$10 AND id=$11 RETURNING *`,
        [status, inspection, completed, cleaner, inspector, inspectedAt, list, x.notes ?? null, x.action, u.ownerId, id, now],
      );
      // Defects become maintenance notices (room status, channel sync and alert are handled there).
      if (x.action === "report_issue") {
        await createNotice(c, u.ownerId, { roomId: Number(r.room_id), taskId: id, severity, description: x.notes!, reportedBy: u.id, photos: x.photos });
        return updated.rows[0];
      }
      // v187: expected ready time — estimated when cleaning starts / ends, unknown again when sent back.
      if (x.action === "start" || x.action === "complete" || x.action === "reject") {
        const eta = x.action === "start" ? etaOnStart(String(r.task_type), now) : x.action === "complete" ? etaOnComplete(now) : null;
        await c.query(x.action === "start" ? `UPDATE housekeeping_tasks SET expected_ready_at=GREATEST(COALESCE(expected_ready_at,0),$3) WHERE owner_id=$1 AND id=$2` : `UPDATE housekeeping_tasks SET expected_ready_at=$3 WHERE owner_id=$1 AND id=$2`, [u.ownerId, id, eta]);
        const today = hotelToday(); await enqueueAvailability(c, u.ownerId, today, today, "room_ready");
      }
      const roomStatus = roomStatusAfter(r.status, x.action, false);
      if (roomStatus) await c.query(`UPDATE rooms SET operational_status=$1 WHERE owner_id=$2 AND id=$3`, [roomStatus, u.ownerId, r.room_id]);
      if (roomStatus === "out_of_order" || (x.action === "approve" && r.status === "repaired")) { const today = hotelToday(); await enqueueAvailability(c, u.ownerId, today, addDays(today, 180), "room_status"); }
      // v186: an approved room is ready — it can be sold again for tonight (OTAs get tonight's availability again).
      else if (x.action === "approve") { const today = hotelToday(); await enqueueAvailability(c, u.ownerId, today, today, "room_ready"); }
      const code = String((await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND id=$2`, [u.ownerId, r.room_id])).rows[0]?.code ?? r.room_id);
      // v176: the guest's open «please clean my room» (TV / phone) is done once the room is cleaned.
      if (x.action === "complete") await closeCleaningRequests(c, u.ownerId, Number(r.room_id), u.id);
      // v185: the room's second person (if set) gets it on the phone to approve.
      if (x.action === "complete" || x.action === "repair_done") {
        const insp = (await c.query(`SELECT staff_user_id FROM housekeeping_room_inspectors WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, r.room_id])).rows[0];
        if (insp && Number(insp.staff_user_id) !== u.id) deferStaffPush(u.ownerId, { userIds: [Number(insp.staff_user_id)] }, { kind: "inspection", tag: `inspect-${id}`, url: "/staff?tab=housekeeping", title: { el: `🔍 Δωμάτιο ${code}: για έγκριση`, en: `🔍 Room ${code}: to approve` }, body: { el: "Ο καθαρισμός ολοκληρώθηκε. Ελέγξτε και εγκρίνετε.", en: "Cleaning is done. Please check and approve." } }, { committed: { table: "housekeeping_tasks", id } });
      }
      if (x.action === "complete" || x.action === "repair_done") {
        await pushNotification(c, u.ownerId, { kind: "housekeeping", titleEl: x.action === "complete" ? `Δωμάτιο ${code} καθαρίστηκε · αναμονή επιθεώρησης` : `Δωμάτιο ${code} επισκευάστηκε · αναμονή δεύτερης έγκρισης`, titleEn: x.action === "complete" ? `Room ${code} cleaned · inspection pending` : `Room ${code} repaired · second sign-off pending`, link: "/pms/housekeeping" });
      } else if (x.action === "approve" && r.status === "repaired") {
        // Legacy two-step repair sign-off also closes the task's open notices, so the history stays consistent.
        await c.query(
          `UPDATE maintenance_notices SET status='resolved',resolved_by=$3,resolved_at=$4,resolution_notes=COALESCE(NULLIF(trim($5),''),'Repair approved'),post_repair_state='dirty'
            WHERE owner_id=$1 AND housekeeping_task_id=$2 AND status='open'`,
          [u.ownerId, id, u.id, now, r.notes ?? ""],
        );
        // Back in service: schedule a fresh clean for the room's default housekeeper.
        await c.query(
          `INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,assigned_to,due_at,checklist_json,inspection_status,booking_id)
           SELECT $1,$2,'departure_clean','todo',(SELECT staff_user_id::text FROM housekeeping_staff_room_defaults WHERE owner_id=$1 AND room_id=$2 ORDER BY staff_user_id LIMIT 1),$3,'{}','pending',(SELECT booking_id FROM housekeeping_tasks WHERE owner_id=$1 AND id=$4)
            WHERE NOT EXISTS (SELECT 1 FROM housekeeping_tasks WHERE owner_id=$1 AND room_id=$2 AND status IN ('todo','in_progress','cleaned') AND id<>$4)`,
          [u.ownerId, r.room_id, now, id],
        );
        await pushNotification(c, u.ownerId, { kind: "housekeeping", titleEl: `Δωμάτιο ${code} ξανά σε λειτουργία (διπλή έγκριση) · χρειάζεται καθαρισμό`, titleEn: `Room ${code} back in service (dual sign-off) · needs cleaning`, link: "/pms/housekeeping" });
      }
      return updated.rows[0];
    });
    return Response.json({ ok: true, task });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    return Response.json({ ok: false, error: errorStatus[m] ? m : "UPDATE_FAILED" }, { status: errorStatus[m] ?? 500 });
  }
}

export const PATCH = audited("housekeeping_task", handlePATCH);
