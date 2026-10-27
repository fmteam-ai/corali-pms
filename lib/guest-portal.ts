// Guest portal in the database: departments and their items (PMS), what a guest sees in "My booking", orders and
// appointments charged straight to the folio (a cancellation posts the opposite entry), and hotel messages.
import type { PoolClient } from "pg";
import { db, withTransaction } from "@/lib/db";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { announcementVisible, appointmentSlots, endTime, guestCanCancel, isOpen, pick, portalTexts, slotFree, stayDays, type AnnouncementKind, type DepartmentIcon, type DepartmentMode, type GuestLang } from "@/lib/guest-portal-core";
import { pushNotification } from "@/lib/pms-notifications";
import { hotelToday } from "@/lib/tape-chart";
import { personalize } from "@/lib/tv-messages-core";

type Q = Pick<PoolClient, "query">;
type Booking = Record<string, unknown>;
const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const hotelTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const firstName = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0] || null;

export type Department = { id: number; nameEl: string; nameEn: string; descriptionEl: string; descriptionEn: string; icon: DepartmentIcon; mode: DepartmentMode; openFrom: string; openTo: string; capacity: number; active: boolean; sortOrder: number; items: DepartmentItem[] };
export type DepartmentItem = { id: number; departmentId: number; nameEl: string; nameEn: string; descriptionEl: string; descriptionEn: string; priceCents: number; durationMin: number; active: boolean; sortOrder: number };

const toItem = (i: Record<string, unknown>): DepartmentItem => ({ id: Number(i.id), departmentId: Number(i.department_id), nameEl: String(i.name_el), nameEn: String(i.name_en), descriptionEl: String(i.description_el), descriptionEn: String(i.description_en), priceCents: Number(i.price_cents), durationMin: Number(i.duration_min), active: Number(i.active) === 1, sortOrder: Number(i.sort_order) });

/** Departments with their items (removed ones left out). */
export async function listDepartments(ownerId: string, activeOnly = false): Promise<Department[]> {
  const [d, i] = await Promise.all([
    db().query(`SELECT * FROM hotel_departments WHERE owner_id=$1 AND deleted_at IS NULL ${activeOnly ? "AND active=1" : ""} ORDER BY sort_order,id`, [ownerId]),
    db().query(`SELECT * FROM department_items WHERE owner_id=$1 AND deleted_at IS NULL ${activeOnly ? "AND active=1" : ""} ORDER BY sort_order,id`, [ownerId]),
  ]);
  const items = i.rows.map(toItem);
  return d.rows.map((x) => ({ id: Number(x.id), nameEl: String(x.name_el), nameEn: String(x.name_en), descriptionEl: String(x.description_el), descriptionEn: String(x.description_en), icon: String(x.icon) as DepartmentIcon, mode: String(x.mode) as DepartmentMode, openFrom: String(x.open_from), openTo: String(x.open_to), capacity: Number(x.capacity), active: Number(x.active) === 1, sortOrder: Number(x.sort_order), items: items.filter((it) => it.departmentId === Number(x.id)) }));
}

export type DepartmentInput = { id?: number; nameEl: string; nameEn: string; descriptionEl: string; descriptionEn: string; icon: DepartmentIcon; mode: DepartmentMode; openFrom: string; openTo: string; capacity: number; active: boolean; sortOrder: number };
export async function saveDepartment(ownerId: string, x: DepartmentInput): Promise<number> {
  const now = Date.now(), active = x.active ? 1 : 0;
  if (x.id) {
    const r = await db().query(`UPDATE hotel_departments SET name_el=$3,name_en=$4,description_el=$5,description_en=$6,icon=$7,mode=$8,open_from=$9,open_to=$10,capacity=$11,active=$12,sort_order=$13,updated_at=$14 WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, x.id, x.nameEl, x.nameEn, x.descriptionEl, x.descriptionEn, x.icon, x.mode, x.openFrom, x.openTo, x.capacity, active, x.sortOrder, now]);
    if (!r.rowCount) throw Error("NOT_FOUND");
    return x.id;
  }
  const r = await db().query(`INSERT INTO hotel_departments(owner_id,name_el,name_en,description_el,description_en,icon,mode,open_from,open_to,capacity,active,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`, [ownerId, x.nameEl, x.nameEn, x.descriptionEl, x.descriptionEn, x.icon, x.mode, x.openFrom, x.openTo, x.capacity, active, x.sortOrder, now]);
  return Number(r.rows[0].id);
}

/** Removed departments and items stay in the database (past orders keep pointing at them) but are no longer shown. */
export async function removeDepartment(ownerId: string, id: number): Promise<void> {
  const now = Date.now();
  await withTransaction(async (c) => {
    const r = await c.query(`UPDATE hotel_departments SET deleted_at=$3,active=0 WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, id, now]);
    if (!r.rowCount) throw Error("NOT_FOUND");
    await c.query(`UPDATE department_items SET deleted_at=$3,active=0 WHERE owner_id=$1 AND department_id=$2 AND deleted_at IS NULL`, [ownerId, id, now]);
  });
}

export type ItemInput = { id?: number; departmentId: number; nameEl: string; nameEn: string; descriptionEl: string; descriptionEn: string; priceCents: number; durationMin: number; active: boolean; sortOrder: number };
export async function saveItem(ownerId: string, x: ItemInput): Promise<number> {
  const dept = await db().query(`SELECT 1 FROM hotel_departments WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, x.departmentId]);
  if (!dept.rowCount) throw Error("NOT_FOUND");
  const now = Date.now(), active = x.active ? 1 : 0;
  if (x.id) {
    const r = await db().query(`UPDATE department_items SET name_el=$4,name_en=$5,description_el=$6,description_en=$7,price_cents=$8,duration_min=$9,active=$10,sort_order=$11,updated_at=$12 WHERE owner_id=$1 AND id=$2 AND department_id=$3 AND deleted_at IS NULL`, [ownerId, x.id, x.departmentId, x.nameEl, x.nameEn, x.descriptionEl, x.descriptionEn, x.priceCents, x.durationMin, active, x.sortOrder, now]);
    if (!r.rowCount) throw Error("NOT_FOUND");
    return x.id;
  }
  const r = await db().query(`INSERT INTO department_items(owner_id,department_id,name_el,name_en,description_el,description_en,price_cents,duration_min,active,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`, [ownerId, x.departmentId, x.nameEl, x.nameEn, x.descriptionEl, x.descriptionEn, x.priceCents, x.durationMin, active, x.sortOrder, now]);
  return Number(r.rows[0].id);
}

export async function removeItem(ownerId: string, id: number): Promise<void> {
  const r = await db().query(`UPDATE department_items SET deleted_at=$3,active=0 WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, id, Date.now()]);
  if (!r.rowCount) throw Error("NOT_FOUND");
}

// ---------- guest side ----------

/** Orders are possible while the guest is in the hotel (arrival day to departure day, booking not closed). */
const inHouse = (b: Booking, today: string) => ["confirmed", "checked_in"].includes(String(b.status)) && String(b.check_in) <= today && today <= String(b.check_out);

export type PortalOrder = { id: number; departmentId: number; title: string; amountCents: number; status: string; mode: DepartmentMode; date: string | null; time: string | null; endTime: string | null; note: string; createdAt: number; canCancel: boolean };
export type PortalAnnouncement = { id: number; kind: AnnouncementKind; personal: boolean; department: string; departmentIcon: DepartmentIcon | null; title: string; body: string; startsAt: number; endsAt: number | null };

async function bookingDeptOrders(ownerId: string, bookingId: number): Promise<PortalOrder[]> {
  const r = await db().query(`SELECT * FROM department_orders WHERE owner_id=$1 AND booking_id=$2 ORDER BY id DESC LIMIT 50`, [ownerId, bookingId]);
  const now = Date.now(), today = hotelToday(), t = hotelTime();
  return r.rows.map((o) => {
    const x = { id: Number(o.id), departmentId: Number(o.department_id), title: String(o.title_guest), amountCents: Number(o.amount_cents), status: String(o.status), mode: String(o.mode) as DepartmentMode, date: o.service_date ? String(o.service_date) : null, time: o.service_time ? String(o.service_time) : null, endTime: o.end_time ? String(o.end_time) : null, note: String(o.note), createdAt: Number(o.created_at) };
    return { ...x, canCancel: guestCanCancel(x, now, today, t) };
  });
}

async function guestAnnouncements(ownerId: string, b: Booking, lang: GuestLang): Promise<PortalAnnouncement[]> {
  const r = await db().query(
    `SELECT a.*,d.name_el dept_el,d.name_en dept_en,d.icon dept_icon FROM guest_announcements a LEFT JOIN hotel_departments d ON d.owner_id=a.owner_id AND d.id=a.department_id
      WHERE a.owner_id=$1 AND a.deleted_at IS NULL AND (a.booking_id IS NULL OR a.booking_id=$2) AND a.starts_at<=$3 ORDER BY a.starts_at DESC LIMIT 40`,
    [ownerId, b.id, Date.now()],
  );
  const now = Date.now(), name = firstName(b.guest_name);
  return r.rows
    .filter((a) => announcementVisible({ startsAt: Number(a.starts_at), endsAt: a.ends_at === null ? null : Number(a.ends_at), bookingId: a.booking_id === null ? null : Number(a.booking_id), deletedAt: null }, Number(b.id), now))
    // A general message is for guests in the hotel at that time; a personal one also before arrival.
    .filter((a) => a.booking_id !== null || inHouse(b, hotelToday()))
    .slice(0, 12)
    .map((a) => ({ id: Number(a.id), kind: String(a.kind) as AnnouncementKind, personal: a.booking_id !== null, department: a.dept_el ? pick(String(a.dept_el), String(a.dept_en), lang) : "", departmentIcon: a.dept_icon ? (String(a.dept_icon) as DepartmentIcon) : null, title: personalize(pick(String(a.title_el), String(a.title_en), lang), name), body: personalize(pick(String(a.body_el), String(a.body_en), lang), name), startsAt: Number(a.starts_at), endsAt: a.ends_at === null ? null : Number(a.ends_at) }));
}

export type PortalDepartment = { id: number; name: string; description: string; icon: DepartmentIcon; mode: DepartmentMode; openFrom: string; openTo: string; openNow: boolean; items: { id: number; name: string; description: string; priceCents: number; durationMin: number }[] };

/** Everything the guest portal shows for a booking. */
export async function portalData(ownerId: string, b: Booking, lang: GuestLang) {
  const today = hotelToday(), now = hotelTime();
  const [departments, orders, announcements] = await Promise.all([listDepartments(ownerId, true), bookingDeptOrders(ownerId, Number(b.id)), guestAnnouncements(ownerId, b, lang)]);
  return {
    texts: portalTexts[lang],
    canOrder: inHouse(b, today),
    days: stayDays(String(b.check_in), String(b.check_out), today),
    departments: departments.filter((d) => d.items.length).map((d): PortalDepartment => ({ id: d.id, name: pick(d.nameEl, d.nameEn, lang), description: pick(d.descriptionEl, d.descriptionEn, lang), icon: d.icon, mode: d.mode, openFrom: d.openFrom, openTo: d.openTo, openNow: isOpen(d.openFrom, d.openTo, now), items: d.items.map((i) => ({ id: i.id, name: pick(i.nameEl, i.nameEn, lang), description: pick(i.descriptionEl, i.descriptionEn, lang), priceCents: i.priceCents, durationMin: i.durationMin })) })),
    orders, announcements,
  };
}

/** Free start times of an appointment item on a day (past times today left out). */
export async function freeSlots(ownerId: string, itemId: number, date: string): Promise<string[]> {
  const it = (await db().query(`SELECT i.duration_min,d.id dept,d.open_from,d.open_to,d.capacity FROM department_items i JOIN hotel_departments d ON d.owner_id=i.owner_id AND d.id=i.department_id WHERE i.owner_id=$1 AND i.id=$2 AND i.active=1 AND i.deleted_at IS NULL AND d.active=1 AND d.deleted_at IS NULL AND d.mode='appointment'`, [ownerId, itemId])).rows[0];
  if (!it) return [];
  const booked = (await db().query(`SELECT service_time s,end_time e FROM department_orders WHERE owner_id=$1 AND department_id=$2 AND service_date=$3 AND mode='appointment' AND status<>'cancelled'`, [ownerId, it.dept, date])).rows.map((r) => ({ start: String(r.s), end: String(r.e) }));
  const today = hotelToday(), now = hotelTime();
  return appointmentSlots(String(it.open_from), String(it.open_to), Number(it.duration_min)).filter((s) => (date > today || s > now) && slotFree(s, Number(it.duration_min), booked, Number(it.capacity)));
}

async function postCharge(c: Q, ownerId: string, b: Booking, description: string, amount: number, actor: string): Promise<number> {
  await ensureFolio(c, ownerId, { id: Number(b.id), total_cents: Number(b.total_cents), balance_cents: Number(b.balance_cents), check_in: String(b.check_in), check_out: String(b.check_out), folio_initialized_at: (b.folio_initialized_at as number | null) ?? null, created_at: Number(b.created_at) });
  const e = await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest',$5,$6) RETURNING id`, [ownerId, b.id, description.slice(0, 200), amount, actor, Date.now()]);
  await recalcBooking(c, ownerId, Number(b.id));
  return Number(e.rows[0].id);
}

/** The guest orders an item (or books an appointment): priced on the server and charged to the folio at once. */
export async function placeDeptOrder(ownerId: string, bookingId: number, lang: GuestLang, x: { itemId: number; quantity: number; date?: string; time?: string; note?: string }): Promise<void> {
  await withTransaction(async (c) => {
    const b = (await c.query(`SELECT b.*,r.code room_code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.id=$2 FOR UPDATE OF b`, [ownerId, bookingId])).rows[0];
    const today = hotelToday(), now = hotelTime();
    if (!b || !inHouse(b, today)) throw Error("NOT_IN_HOUSE");
    const it = (await c.query(`SELECT i.*,d.mode,d.open_from,d.open_to,d.capacity,d.name_el dept_el FROM department_items i JOIN hotel_departments d ON d.owner_id=i.owner_id AND d.id=i.department_id WHERE i.owner_id=$1 AND i.id=$2 AND i.active=1 AND i.deleted_at IS NULL AND d.active=1 AND d.deleted_at IS NULL`, [ownerId, x.itemId])).rows[0];
    if (!it) throw Error("NOT_AVAILABLE");
    const mode = String(it.mode) as DepartmentMode;
    let quantity = Math.max(1, Math.min(20, Math.floor(x.quantity || 1))), date: string | null = null, time: string | null = null, end: string | null = null;
    if (mode === "appointment") {
      quantity = 1;
      if (!x.date || !x.time || !stayDays(String(b.check_in), String(b.check_out), today).includes(x.date)) throw Error("SLOT_TAKEN");
      // One booking at a time per department, so two guests cannot take the last place together.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('dept-slot:' || $1 || ':' || $2))`, [ownerId, String(it.department_id)]);
      const booked = (await c.query(`SELECT service_time s,end_time e FROM department_orders WHERE owner_id=$1 AND department_id=$2 AND service_date=$3 AND mode='appointment' AND status<>'cancelled'`, [ownerId, it.department_id, x.date])).rows.map((r) => ({ start: String(r.s), end: String(r.e) }));
      const slots = appointmentSlots(String(it.open_from), String(it.open_to), Number(it.duration_min));
      if (!slots.includes(x.time) || (x.date === today && x.time <= now) || !slotFree(x.time, Number(it.duration_min), booked, Number(it.capacity))) throw Error("SLOT_TAKEN");
      date = x.date; time = x.time; end = endTime(x.time, Number(it.duration_min));
    } else {
      if (!isOpen(String(it.open_from), String(it.open_to), now)) throw Error("CLOSED");
    }
    const amount = Number(it.price_cents) * quantity;
    const nameGuest = pick(String(it.name_el), String(it.name_en), lang), times = quantity > 1 ? ` × ${quantity}` : "";
    const when = date ? ` · ${date.split("-").reverse().slice(0, 2).join("/")} ${time}` : "";
    const titleEl = `${it.dept_el}: ${it.name_el}${times}${when}`;
    const entry = amount > 0 ? await postCharge(c, ownerId, b, titleEl, amount, "guest-portal") : null;
    await c.query(
      `INSERT INTO department_orders(owner_id,booking_id,department_id,item_id,mode,title_el,title_guest,quantity,amount_cents,service_date,service_time,end_time,note,status,lang,folio_entry_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'placed',$14,$15,$16)`,
      [ownerId, b.id, it.department_id, it.id, mode, titleEl.slice(0, 200), `${nameGuest}${times}`.slice(0, 200), quantity, amount, date, time, end, (x.note ?? "").trim().slice(0, 300), lang, entry, Date.now()],
    );
    const room = b.room_code ? `Δωμ. ${b.room_code}` : String(b.reference), roomEn = b.room_code ? `Room ${b.room_code}` : String(b.reference);
    const note = x.note?.trim() ? ` · 📝 ${x.note.trim().slice(0, 80)}` : "";
    await pushNotification(c, ownerId, { kind: "guest_order", titleEl: `🛎️ ${room} · ${b.guest_name}: ${titleEl} · ${euro(amount)}${note}`, titleEn: `🛎️ ${roomEn} · ${b.guest_name}: ${titleEl} · ${euro(amount)}${note}`, link: "/pms/departments?tab=orders" });
  });
}

/** Cancel an order: the guest (within the allowed time) or staff (any time while not done). The charge is reversed. */
export async function cancelDeptOrder(ownerId: string, orderId: number, by: { bookingId: number } | { staffId: number; reason: string }): Promise<void> {
  await withTransaction(async (c) => {
    const o = (await c.query(`SELECT * FROM department_orders WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, orderId])).rows[0];
    if (!o || ("bookingId" in by && Number(o.booking_id) !== by.bookingId)) throw Error("NOT_FOUND");
    if (o.status !== "placed") throw Error("ALREADY_HANDLED");
    if ("bookingId" in by && !guestCanCancel({ status: String(o.status), mode: String(o.mode) as DepartmentMode, createdAt: Number(o.created_at), date: o.service_date, time: o.service_time }, Date.now(), hotelToday(), hotelTime())) throw Error("TOO_LATE");
    const b = (await c.query(`SELECT b.*,r.code room_code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.id=$2 FOR UPDATE OF b`, [ownerId, o.booking_id])).rows[0];
    if (Number(o.amount_cents) > 0 && b) {
      await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest',$5,$6)`, [ownerId, b.id, `Ακύρωση / Cancelled: ${o.title_el}`.slice(0, 200), -Number(o.amount_cents), "bookingId" in by ? "guest-portal" : String(by.staffId), Date.now()]);
      await recalcBooking(c, ownerId, Number(b.id));
    }
    await c.query(`UPDATE department_orders SET status='cancelled',cancel_reason=$3,handled_by=$4,handled_at=$5 WHERE owner_id=$1 AND id=$2`, [ownerId, orderId, "staffId" in by ? by.reason.slice(0, 300) : "", "staffId" in by ? by.staffId : null, Date.now()]);
    if ("bookingId" in by && b) {
      await pushNotification(c, ownerId, { kind: "guest_order", titleEl: `❌ ${b.room_code ? `Δωμ. ${b.room_code}` : b.reference} · ${b.guest_name}: ακύρωσε «${o.title_el}»`, titleEn: `❌ ${b.room_code ? `Room ${b.room_code}` : b.reference} · ${b.guest_name}: cancelled “${o.title_el}”`, link: "/pms/departments?tab=orders" });
    } else if (b) {
      const reason = "staffId" in by && by.reason.trim() ? ` ${by.reason.trim()}` : "";
      const msg = String(o.lang) === "el" ? `Η παραγγελία «${o.title_guest}» ακυρώθηκε και το ποσό ${euro(Number(o.amount_cents))} αφαιρέθηκε από τον λογαριασμό σας.${reason}` : `Your order “${o.title_guest}” was cancelled and ${euro(Number(o.amount_cents))} was removed from your account.${reason}`;
      await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,$4,0,$4)`, [ownerId, b.id, msg.slice(0, 4000), Date.now()]);
    }
  });
}

export async function completeDeptOrder(ownerId: string, orderId: number, staffId: number): Promise<void> {
  const r = await db().query(`UPDATE department_orders SET status='done',handled_by=$3,handled_at=$4 WHERE owner_id=$1 AND id=$2 AND status='placed'`, [ownerId, orderId, staffId, Date.now()]);
  if (!r.rowCount) throw Error("ALREADY_HANDLED");
}

/** Department orders for the PMS: open ones first, then the last 30 days. */
export async function listDeptOrders(ownerId: string) {
  const r = await db().query(
    `SELECT o.*,b.reference,b.guest_name,r.code room_code,d.name_el dept,d.icon,COALESCE(u.display_name,'') handled_name FROM department_orders o
       JOIN bookings b ON b.owner_id=o.owner_id AND b.id=o.booking_id LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
       LEFT JOIN hotel_departments d ON d.owner_id=o.owner_id AND d.id=o.department_id LEFT JOIN pms_staff_users u ON u.owner_id=o.owner_id AND u.id=o.handled_by
      WHERE o.owner_id=$1 AND (o.status='placed' OR o.created_at>$2) ORDER BY (o.status='placed') DESC, COALESCE(o.service_date,''), COALESCE(o.service_time,''), o.created_at DESC LIMIT 300`,
    [ownerId, Date.now() - 30 * 86_400_000],
  );
  return r.rows.map((o) => ({ id: Number(o.id), departmentId: Number(o.department_id), department: String(o.dept ?? ""), icon: String(o.icon ?? "bell") as DepartmentIcon, mode: String(o.mode) as DepartmentMode, title: String(o.title_el), amountCents: Number(o.amount_cents), status: String(o.status), date: o.service_date ? String(o.service_date) : null, time: o.service_time ? String(o.service_time) : null, endTime: o.end_time ? String(o.end_time) : null, note: String(o.note), createdAt: Number(o.created_at), reference: String(o.reference), guest: String(o.guest_name), room: o.room_code ? String(o.room_code) : null, cancelReason: String(o.cancel_reason), handledBy: String(o.handled_name) }));
}

// ---------- messages from the hotel ----------

export type AnnouncementInput = { departmentId: number | null; bookingId: number | null; kind: AnnouncementKind; titleEl: string; titleEn: string; bodyEl: string; bodyEn: string; startsAt: number; endsAt: number | null };

export async function createAnnouncement(ownerId: string, userId: number, x: AnnouncementInput): Promise<number> {
  if (x.departmentId !== null && !(await db().query(`SELECT 1 FROM hotel_departments WHERE owner_id=$1 AND id=$2`, [ownerId, x.departmentId])).rowCount) throw Error("NOT_FOUND");
  if (x.bookingId !== null && !(await db().query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND id=$2 AND status IN ('confirmed','checked_in')`, [ownerId, x.bookingId])).rowCount) throw Error("NOT_FOUND");
  return withTransaction(async (c) => {
    const r = await c.query(`INSERT INTO guest_announcements(owner_id,department_id,booking_id,kind,title_el,title_en,body_el,body_en,starts_at,ends_at,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [ownerId, x.departmentId, x.bookingId, x.kind, x.titleEl, x.titleEn, x.bodyEl, x.bodyEn, x.startsAt, x.endsAt, userId, Date.now()]);
    // A personal message also lands in the booking's conversation, so the guest gets the usual e-mail notice.
    if (x.bookingId !== null) {
      const b = (await c.query(`SELECT guest_name,guest_language FROM bookings WHERE owner_id=$1 AND id=$2`, [ownerId, x.bookingId])).rows[0];
      const lang = String(b?.guest_language ?? "en").startsWith("el") ? "el" : "en", name = firstName(b?.guest_name);
      const text = [pick(x.titleEl, x.titleEn, lang), pick(x.bodyEl, x.bodyEn, lang)].filter(Boolean).map((s) => personalize(s, name)).join("\n\n");
      await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,NULL,0,$4)`, [ownerId, x.bookingId, text.slice(0, 4000), Date.now()]);
    }
    return Number(r.rows[0].id);
  });
}

export async function removeAnnouncement(ownerId: string, id: number): Promise<void> {
  const r = await db().query(`UPDATE guest_announcements SET deleted_at=$3 WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, id, Date.now()]);
  if (!r.rowCount) throw Error("NOT_FOUND");
}

export async function listAnnouncements(ownerId: string) {
  const r = await db().query(
    `SELECT a.*,d.name_el dept,b.reference,b.guest_name,rm.code room_code,COALESCE(u.display_name,'') author,
       (SELECT count(*) FROM bookings x WHERE x.owner_id=a.owner_id AND x.status IN ('confirmed','checked_in') AND x.check_in<=$3 AND x.check_out>=$3)::int AS in_house
       FROM guest_announcements a LEFT JOIN hotel_departments d ON d.owner_id=a.owner_id AND d.id=a.department_id
       LEFT JOIN bookings b ON b.owner_id=a.owner_id AND b.id=a.booking_id LEFT JOIN rooms rm ON rm.owner_id=b.owner_id AND rm.id=b.room_id
       LEFT JOIN pms_staff_users u ON u.owner_id=a.owner_id AND u.id=a.created_by
      WHERE a.owner_id=$1 AND a.deleted_at IS NULL AND COALESCE(a.ends_at,a.starts_at+7*86400000)>$2 ORDER BY a.starts_at DESC LIMIT 100`,
    [ownerId, Date.now() - 7 * 86_400_000, hotelToday()],
  );
  return r.rows.map((a) => ({ id: Number(a.id), kind: String(a.kind) as AnnouncementKind, department: a.dept ? String(a.dept) : "", departmentId: a.department_id === null ? null : Number(a.department_id), personal: a.booking_id !== null, target: a.booking_id === null ? "" : `${a.room_code ? `${a.room_code} · ` : ""}${a.guest_name} (${a.reference})`, titleEl: String(a.title_el), titleEn: String(a.title_en), bodyEl: String(a.body_el), bodyEn: String(a.body_en), startsAt: Number(a.starts_at), endsAt: a.ends_at === null ? null : Number(a.ends_at), author: String(a.author), inHouse: Number(a.in_house) }));
}

/** Guests in the hotel now (for a personal message): booking id, room and name. */
export async function inHouseGuests(ownerId: string) {
  const today = hotelToday();
  const r = await db().query(`SELECT b.id,b.reference,b.guest_name,r.code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>=$2 ORDER BY r.code NULLS LAST, b.guest_name`, [ownerId, today]);
  return r.rows.map((b) => ({ id: Number(b.id), label: `${b.code ? `${b.code} · ` : ""}${b.guest_name} (${b.reference})` }));
}
