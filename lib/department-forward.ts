// v184 forwarding guest messages and orders to a department: the PMS (or, for orders from the app, the system) passes
// them to the department's staff team in Corali Staff (push) and / or its e-mail; the guest gets a confirmation in
// "My booking" that it was received and forwarded; the department marks it «seen» and «done» on the phone.
import { db, withTransaction } from "@/lib/db";
import { forwardConfirmation, forwardSummary, nextStatus, type ForwardKind, type ForwardStatus } from "@/lib/department-forward-core";
import { pushHotelMessageAfter } from "@/lib/guest-push";
import { sendEmail } from "@/lib/notifications/email";
import { isDesk } from "@/lib/staff-core";
import { deferStaffPush } from "@/lib/staff-push";

type Row = Record<string, unknown>;

async function source(ownerId: string, kind: ForwardKind, id: number): Promise<{ bookingId: number; text: string; item: string } | null> {
  if (kind === "message") {
    const m = (await db().query(`SELECT booking_id,body FROM booking_messages WHERE owner_id=$1 AND id=$2 AND sender='guest'`, [ownerId, id])).rows[0];
    return m ? { bookingId: Number(m.booking_id), text: String(m.body), item: "" } : null;
  }
  const table = kind === "dept_order" ? "department_orders" : "guest_orders";
  const o = (await db().query(`SELECT booking_id,title_el,title_guest,note,service_date,service_time FROM ${table} WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0];
  if (!o) return null;
  const when = [o.service_date, o.service_time].filter(Boolean).join(" ");
  return { bookingId: Number(o.booking_id), text: `${o.title_el}${when && !String(o.title_el).includes(String(o.service_time ?? "#")) ? ` · ${when}` : ""}${o.note ? ` · 📝 ${o.note}` : ""}`, item: String(o.title_guest) };
}

export type ForwardResult = { id: number; recipients: { team: string | null; email: string | null }; guestNotified: boolean };

/**
 * Forward to a department. Throws NOT_FOUND, ALREADY_FORWARDED (same thing to the same department, not done yet) or
 * NO_RECIPIENTS (the department has neither a staff team nor an e-mail; set them in Τμήματα → Κατάλογος).
 */
export async function forwardToDepartment(ownerId: string, x: { departmentId: number; kind: ForwardKind; sourceId: number; note?: string; actor: number | null; notifyGuest: boolean; automatic?: boolean }): Promise<ForwardResult> {
  const d = (await db().query(`SELECT d.*,s.name AS team FROM hotel_departments d LEFT JOIN staff_specialties s ON s.owner_id=d.owner_id AND s.id=d.staff_specialty_id AND s.active=1 WHERE d.owner_id=$1 AND d.id=$2 AND d.deleted_at IS NULL`, [ownerId, x.departmentId])).rows[0];
  if (!d) throw Error("NOT_FOUND");
  const team = d.team ? String(d.team) : null, email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.notify_email ?? "")) ? String(d.notify_email) : null;
  if (!team && !email) throw Error("NO_RECIPIENTS");
  const src = await source(ownerId, x.kind, x.sourceId);
  if (!src) throw Error("NOT_FOUND");
  const b = (await db().query(`SELECT b.id,b.reference,b.guest_name,b.guest_language,r.code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.id=$2`, [ownerId, src.bookingId])).rows[0];
  if (!b) throw Error("NOT_FOUND");
  const summary = forwardSummary({ room: b.code ? String(b.code) : null, reference: String(b.reference), guest: String(b.guest_name), text: src.text });
  const note = (x.note ?? "").trim().slice(0, 300);
  const id = await withTransaction(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('fwd:' || $1 || ':' || $2 || ':' || $3))`, [ownerId, x.kind, String(x.sourceId)]);
    const dup = await c.query(`SELECT 1 FROM department_forwards WHERE owner_id=$1 AND department_id=$2 AND source_kind=$3 AND source_id=$4 AND status<>'done'`, [ownerId, x.departmentId, x.kind, x.sourceId]);
    if (dup.rowCount) throw Error("ALREADY_FORWARDED");
    const r = await c.query(
      `INSERT INTO department_forwards(owner_id,department_id,source_kind,source_id,booking_id,summary,note,status,automatic,guest_notified,forwarded_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'sent',$8,$9,$10,$11) RETURNING id`,
      [ownerId, x.departmentId, x.kind, x.sourceId, b.id, summary, note, x.automatic ? 1 : 0, x.notifyGuest ? 1 : 0, x.actor, Date.now()],
    );
    if (x.notifyGuest) {
      const text = forwardConfirmation(b.guest_language, x.kind, { el: String(d.name_el), en: String(d.name_en ?? "") }, src.item);
      await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,NULL,0,$4)`, [ownerId, b.id, text, Date.now()]);
      pushHotelMessageAfter(ownerId, Number(b.id), text);
    }
    return Number(r.rows[0].id);
  });
  const title = { el: `📨 ${d.name_el}: νέο αίτημα πελάτη`, en: `📨 ${String(d.name_en || d.name_el)}: new guest request` };
  const body = { el: `${summary}${note ? `\n— ${note}` : ""}`, en: `${summary}${note ? `\n— ${note}` : ""}` };
  if (d.staff_specialty_id && team) deferStaffPush(ownerId, { specialtyId: Number(d.staff_specialty_id) }, { kind: "department", title, body, url: "/staff?tab=department", tag: `fwd-${id}` }, { committed: { table: "department_forwards", id } });
  if (email) void sendEmail(email, title.el, `${summary}${note ? `\n\nΣημείωση ρεσεψιόν: ${note}` : ""}\n\nΚράτηση ${b.reference}. Σημειώστε το ως «ολοκληρώθηκε» στην εφαρμογή Corali Staff (Τμήμα).`, { lang: "el" }).catch((e) => console.error("Department forward e-mail failed", e instanceof Error ? e.message : e));
  return { id, recipients: { team, email }, guestNotified: x.notifyGuest };
}

/** An order placed in the app goes straight to its department when the department has recipients and auto-forward on. */
export async function autoForwardDeptOrder(ownerId: string, orderId: number): Promise<void> {
  const o = (await db().query(`SELECT o.department_id,d.auto_forward,d.staff_specialty_id,d.notify_email FROM department_orders o JOIN hotel_departments d ON d.owner_id=o.owner_id AND d.id=o.department_id WHERE o.owner_id=$1 AND o.id=$2`, [ownerId, orderId])).rows[0];
  if (!o || Number(o.auto_forward) !== 1 || (!o.staff_specialty_id && !String(o.notify_email ?? "").includes("@"))) return;
  await forwardToDepartment(ownerId, { departmentId: Number(o.department_id), kind: "dept_order", sourceId: orderId, actor: null, notifyGuest: true, automatic: true }).catch((e) => {
    if (!(e instanceof Error) || !["NO_RECIPIENTS", "ALREADY_FORWARDED"].includes(e.message)) console.error("Auto-forward failed", e);
  });
}

export type ForwardView = { id: number; departmentId: number; department: string; kind: ForwardKind; sourceId: number; bookingId: number | null; summary: string; note: string; status: ForwardStatus; automatic: boolean; guestNotified: boolean; createdAt: number; by: string; seenBy: string; seenAt: number | null; doneBy: string; doneAt: number | null };

const view = (f: Row): ForwardView => ({ id: Number(f.id), departmentId: Number(f.department_id), department: String(f.dept ?? ""), kind: String(f.source_kind) as ForwardKind, sourceId: Number(f.source_id), bookingId: f.booking_id === null ? null : Number(f.booking_id), summary: String(f.summary), note: String(f.note), status: String(f.status) as ForwardStatus, automatic: Number(f.automatic) === 1, guestNotified: Number(f.guest_notified) === 1, createdAt: Number(f.created_at), by: String(f.by_name ?? ""), seenBy: String(f.seen_name ?? ""), seenAt: f.seen_at ? Number(f.seen_at) : null, doneBy: String(f.done_name ?? ""), doneAt: f.done_at ? Number(f.done_at) : null });
const SELECT = `SELECT f.*,d.name_el dept,u1.display_name by_name,u2.display_name seen_name,u3.display_name done_name FROM department_forwards f
  LEFT JOIN hotel_departments d ON d.owner_id=f.owner_id AND d.id=f.department_id LEFT JOIN pms_staff_users u1 ON u1.owner_id=f.owner_id AND u1.id=f.forwarded_by
  LEFT JOIN pms_staff_users u2 ON u2.owner_id=f.owner_id AND u2.id=f.seen_by LEFT JOIN pms_staff_users u3 ON u3.owner_id=f.owner_id AND u3.id=f.done_by`;

/** Forwards of some messages / orders (the PMS shows «→ Spa ✓» next to each). */
export async function forwardsFor(ownerId: string, kind: ForwardKind, ids: number[]): Promise<ForwardView[]> {
  if (!ids.length) return [];
  return (await db().query(`${SELECT} WHERE f.owner_id=$1 AND f.source_kind=$2 AND f.source_id=ANY($3::bigint[]) ORDER BY f.id`, [ownerId, kind, ids.slice(0, 500)])).rows.map(view);
}

/** Departments a staff member answers for (through their teams); the front desk sees all of them. */
export async function myDepartments(ownerId: string, userId: number, role: string): Promise<number[]> {
  const r = await db().query(
    isDesk(role) ? `SELECT id FROM hotel_departments WHERE owner_id=$1 AND deleted_at IS NULL AND staff_specialty_id IS NOT NULL`
      : `SELECT d.id FROM hotel_departments d JOIN staff_user_specialties us ON us.owner_id=d.owner_id AND us.specialty_id=d.staff_specialty_id WHERE d.owner_id=$1 AND d.deleted_at IS NULL AND us.staff_user_id=$2`,
    isDesk(role) ? [ownerId] : [ownerId, userId],
  );
  return r.rows.map((x) => Number(x.id));
}

/** Open forwards of these departments, and the ones finished today. */
export async function departmentInbox(ownerId: string, departmentIds: number[]): Promise<ForwardView[]> {
  if (!departmentIds.length) return [];
  return (await db().query(`${SELECT} WHERE f.owner_id=$1 AND f.department_id=ANY($2::bigint[]) AND (f.status<>'done' OR f.done_at>$3) AND f.created_at>$4 ORDER BY (f.status='done'), f.created_at DESC LIMIT 100`, [ownerId, departmentIds, Date.now() - 12 * 3_600_000, Date.now() - 7 * 86_400_000])).rows.map(view);
}

/** The department marks a forward seen (a forwarded message tells the guest) or done (an app order is marked done too). */
export async function setForwardStatus(ownerId: string, id: number, user: { id: number; role: string }, wanted: "seen" | "done"): Promise<void> {
  const f = (await db().query(`SELECT f.*,d.name_el,d.name_en,b.guest_language FROM department_forwards f JOIN hotel_departments d ON d.owner_id=f.owner_id AND d.id=f.department_id LEFT JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id WHERE f.owner_id=$1 AND f.id=$2`, [ownerId, id])).rows[0];
  if (!f) throw Error("NOT_FOUND");
  if (!(await myDepartments(ownerId, user.id, user.role)).includes(Number(f.department_id))) throw Error("FORBIDDEN");
  const next = nextStatus(String(f.status) as ForwardStatus, wanted);
  if (!next) throw Error("ALREADY_HANDLED");
  const now = Date.now();
  await withTransaction(async (c) => {
    const r = await c.query(next === "seen" ? `UPDATE department_forwards SET status='seen',seen_by=$3,seen_at=$4 WHERE owner_id=$1 AND id=$2 AND status='sent'` : `UPDATE department_forwards SET status='done',done_by=$3,done_at=$4,seen_by=COALESCE(seen_by,$3),seen_at=COALESCE(seen_at,$4) WHERE owner_id=$1 AND id=$2 AND status<>'done'`, [ownerId, id, user.id, now]);
    if (!r.rowCount) throw Error("ALREADY_HANDLED");
    if (next === "done" && f.source_kind === "dept_order") await c.query(`UPDATE department_orders SET status='done',handled_by=$3,handled_at=$4 WHERE owner_id=$1 AND id=$2 AND status='placed'`, [ownerId, f.source_id, user.id, now]);
    // A forwarded message: the guest also hears that the department took it (once, on the first «seen»).
    if (f.source_kind === "message" && f.status === "sent" && f.booking_id) {
      const text = forwardConfirmation(f.guest_language, "seen", { el: String(f.name_el), en: String(f.name_en ?? "") });
      await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,NULL,0,$4)`, [ownerId, f.booking_id, text, now]);
      pushHotelMessageAfter(ownerId, Number(f.booking_id), text);
    }
  });
}

/** Departments with their recipients, for the PMS «Προώθηση» picker. */
export async function forwardTargets(ownerId: string) {
  const r = await db().query(`SELECT d.id,d.name_el,d.icon,d.notify_email,s.name team FROM hotel_departments d LEFT JOIN staff_specialties s ON s.owner_id=d.owner_id AND s.id=d.staff_specialty_id AND s.active=1 WHERE d.owner_id=$1 AND d.deleted_at IS NULL ORDER BY d.sort_order,d.id`, [ownerId]);
  return r.rows.map((d) => ({ id: Number(d.id), name: String(d.name_el), icon: String(d.icon), team: d.team ? String(d.team) : null, email: String(d.notify_email ?? "") || null, ready: Boolean(d.team) || String(d.notify_email ?? "").includes("@") }));
}
