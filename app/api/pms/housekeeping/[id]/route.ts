import { audited } from "@/lib/audit";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { nextHousekeepingStatus, roomStatusAfter, validChecklist, validHousekeepingTransition } from "@/lib/housekeeping";
import { pushNotification } from "@/lib/pms-notifications";
import { assertTrustedOrigin } from "@/lib/security/origin";

const schema = z.object({
  action: z.enum(["start", "complete", "approve", "reject", "report_issue", "repair_done"]),
  checklist: z.record(z.string(), z.boolean()).optional(),
  notes: z.string().trim().max(2000).optional(),
  severe: z.boolean().optional(),
});

const errorStatus: Record<string, number> = { NOT_FOUND: 404, NOT_ASSIGNED: 403, CHECKLIST_INCOMPLETE: 409, SECOND_REVIEW_REQUIRED: 409, INVALID_TRANSITION: 409, DESCRIPTION_REQUIRED: 400 };

async function handlePATCH(q: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("housekeeping.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(q);
    const id = Number((await params).id), x = schema.parse(await q.json());
    if (!Number.isSafeInteger(id) || id < 1) return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    const task = await withTransaction(async (c) => {
      const r = (await c.query(`SELECT * FROM housekeeping_tasks WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, id])).rows[0];
      if (!r) throw Error("NOT_FOUND");
      const review = x.action === "approve" || x.action === "reject";
      const reviewable = (r.status === "cleaned" || r.status === "repaired") && review;
      // Housekeeping staff act on their own tasks; any other colleague may perform the second review.
      if (u.role === "housekeeping" && r.assigned_to !== String(u.id) && !(reviewable && Number(r.cleaned_by_staff_id) !== u.id)) throw Error("NOT_ASSIGNED");
      if (!validHousekeepingTransition(r.status, x.action)) throw Error("INVALID_TRANSITION");
      if ((x.action === "report_issue" || x.action === "reject" || x.action === "repair_done") && !x.notes) throw Error("DESCRIPTION_REQUIRED");
      if (review && Number(r.cleaned_by_staff_id) === u.id) throw Error("SECOND_REVIEW_REQUIRED");
      if (x.action === "complete" && !validChecklist(x.checklist)) throw Error("CHECKLIST_INCOMPLETE");

      const now = Date.now();
      const status = nextHousekeepingStatus(r.status, x.action, x.severe === true);
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
      const roomStatus = roomStatusAfter(r.status, x.action, x.severe === true);
      if (roomStatus) await c.query(`UPDATE rooms SET operational_status=$1 WHERE owner_id=$2 AND id=$3`, [roomStatus, u.ownerId, r.room_id]);
      const code = String((await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND id=$2`, [u.ownerId, r.room_id])).rows[0]?.code ?? r.room_id);
      if (x.action === "report_issue") {
        await pushNotification(c, u.ownerId, { kind: "housekeeping", titleEl: `${x.severe ? "Σοβαρή βλάβη · εκτός λειτουργίας" : "Βλάβη"} · δωμάτιο ${code}: ${x.notes}`, titleEn: `${x.severe ? "Severe damage · out of order" : "Damage"} · room ${code}: ${x.notes}`, link: "/pms/housekeeping" });
      } else if (x.action === "complete" || x.action === "repair_done") {
        await pushNotification(c, u.ownerId, { kind: "housekeeping", titleEl: x.action === "complete" ? `Δωμάτιο ${code} καθαρίστηκε · αναμονή επιθεώρησης` : `Δωμάτιο ${code} επισκευάστηκε · αναμονή δεύτερης έγκρισης`, titleEn: x.action === "complete" ? `Room ${code} cleaned · inspection pending` : `Room ${code} repaired · second sign-off pending`, link: "/pms/housekeeping" });
      } else if (x.action === "approve" && r.status === "repaired") {
        // Back in service: schedule a fresh clean for the room's default housekeeper.
        await c.query(
          `INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,assigned_to,due_at,checklist_json,inspection_status)
           SELECT $1,$2,'departure_clean','todo',(SELECT staff_user_id::text FROM housekeeping_staff_room_defaults WHERE owner_id=$1 AND room_id=$2 ORDER BY staff_user_id LIMIT 1),$3,'{}','pending'
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
