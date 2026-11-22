// v184 department sales in the database: the POS key of each department, receipts from the POS (cash, card or charged
// to a guest's room folio), voids, the POS item sync, CSV import, the sales report per department and the sales
// advisor's suggestions (run now, dismiss, turn into an offer).
import type { PoolClient } from "pg";
import { addDays, daysBetween, playbookFor, normalizePosSale, parseSalesCsv, salesSummary, suggestionWindow, type PosSale, type SalesSummary } from "../scripts/department-sales-core.mjs";
import { newPosKey, parsePosKey, posKeyHash, samePosHash } from "../scripts/pos-key-core.mjs";
import { loadSales, runSalesAdvisor } from "../scripts/sales-advisor-worker.mjs";
import { db, withTransaction } from "@/lib/db";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { createAnnouncement } from "@/lib/guest-portal";
import { anthropicApiKey } from "@/lib/provider-connections";
import { allowAttempt, clientIp } from "@/lib/request-limit";
import { recordSecurityEvent } from "@/lib/security-center";
import { hotelToday } from "@/lib/tape-chart";

type Q = Pick<PoolClient, "query">;
export type PosCaller = { ownerId: string; departmentId: number; department: string };

const posError = (status: number, error: string, message: string) => Response.json({ ok: false, error, message }, { status, headers: { "Cache-Control": "no-store" } });
export const posJson = (data: unknown, status = 200) => Response.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store" } });
export const posBad = (message: string) => posError(400, "INVALID_INPUT", message);

// ───────────────────────────── POS keys (PMS) ─────────────────────────────

export type PosLink = { departmentId: number; name: string; prefix: string; createdAt: number; lastSaleAt: number | null; lastSeenAt: number | null; salesToday: number };

export async function listPosLinks(ownerId: string): Promise<PosLink[]> {
  const r = await db().query(
    `SELECT p.*,(SELECT count(*)::int FROM pos_sales s WHERE s.owner_id=p.owner_id AND s.department_id=p.department_id AND s.sold_date=$2 AND s.status='paid') AS today FROM department_pos p WHERE p.owner_id=$1 AND p.revoked_at IS NULL`,
    [ownerId, hotelToday()],
  );
  return r.rows.map((p) => ({ departmentId: Number(p.department_id), name: String(p.name), prefix: String(p.prefix), createdAt: Number(p.created_at), lastSaleAt: p.last_sale_at ? Number(p.last_sale_at) : null, lastSeenAt: p.last_seen_at ? Number(p.last_seen_at) : null, salesToday: Number(p.today) }));
}

/** A new key for a department's POS (shown once; a previous key of that department stops working). */
export async function createPosKey(ownerId: string, departmentId: number, userId: number, name: string): Promise<string> {
  if (!(await db().query(`SELECT 1 FROM hotel_departments WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, departmentId])).rowCount) throw Error("NOT_FOUND");
  const k = newPosKey();
  await db().query(
    `INSERT INTO department_pos(owner_id,department_id,name,prefix,key_hash,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(owner_id,department_id) DO UPDATE SET name=$3,prefix=$4,key_hash=$5,created_at=$6,created_by=$7,revoked_at=NULL,last_seen_at=NULL`,
    [ownerId, departmentId, name.trim().slice(0, 80) || "POS", k.prefix, k.hash, Date.now(), userId],
  );
  return k.key;
}

export async function revokePosKey(ownerId: string, departmentId: number): Promise<void> {
  const r = await db().query(`UPDATE department_pos SET revoked_at=$3 WHERE owner_id=$1 AND department_id=$2 AND revoked_at IS NULL`, [ownerId, departmentId, Date.now()]);
  if (!r.rowCount) throw Error("NOT_FOUND");
}

/** Authorization: Bearer cpos_… — the key decides the department. 240 requests a minute per department. */
export async function requirePosKey(request: Request): Promise<PosCaller | Response> {
  const ip = clientIp(request), parsed = parsePosKey(request.headers.get("authorization"));
  const bad = async (message: string) => {
    void recordSecurityEvent("bad_api_key", ip, "pos");
    if (!(await allowAttempt(`pos-bad:${ip}`, 30, 60_000, 15 * 60_000))) return posError(429, "RATE_LIMITED", "Too many requests");
    return posError(401, "UNAUTHORIZED", message);
  };
  if (!parsed) return bad("Send Authorization: Bearer <department POS key cpos_…>");
  const row = (await db().query(`SELECT p.owner_id,p.department_id,p.key_hash,p.revoked_at,d.name_el,d.deleted_at FROM department_pos p JOIN hotel_departments d ON d.owner_id=p.owner_id AND d.id=p.department_id WHERE p.prefix=$1`, [parsed.prefix])).rows[0];
  if (!row || row.revoked_at || row.deleted_at || !samePosHash(String(row.key_hash), posKeyHash(parsed.key))) return bad("Unknown or revoked POS key");
  if (!(await allowAttempt(`pos-key:${row.owner_id}:${row.department_id}`, 240, 60_000, 60_000))) return posError(429, "RATE_LIMITED", "More than 240 requests a minute");
  await db().query(`UPDATE department_pos SET last_seen_at=$3::bigint WHERE owner_id=$1 AND department_id=$2 AND (last_seen_at IS NULL OR last_seen_at<$3::bigint-60000)`, [row.owner_id, row.department_id, Date.now()]);
  return { ownerId: String(row.owner_id), departmentId: Number(row.department_id), department: String(row.name_el) };
}

// ───────────────────────────── receipts ─────────────────────────────

async function findStay(c: Q, ownerId: string, ref: string) {
  return (await c.query(
    `SELECT b.*,r.code room_code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND (upper(b.reference)=upper($2) OR (b.status='checked_in' AND r.code=$2)) ORDER BY (upper(b.reference)=upper($2)) DESC, b.check_in DESC LIMIT 1 FOR UPDATE OF b`,
    [ownerId, ref.trim()],
  )).rows[0];
}

/** POS items matched to the department's catalogue by POS code, else by Greek / English name. */
async function matchItems(c: Q, ownerId: string, departmentId: number, items: PosSale["items"]) {
  const cat = (await c.query(`SELECT id,lower(trim(pos_sku)) sku,lower(trim(name_el)) el,lower(trim(name_en)) en FROM department_items WHERE owner_id=$1 AND department_id=$2 AND deleted_at IS NULL`, [ownerId, departmentId])).rows;
  return items.map((i) => {
    const sku = i.sku.trim().toLowerCase(), name = i.name.trim().toLowerCase();
    const hit = (sku && cat.find((x) => x.sku && x.sku === sku)) || cat.find((x) => x.el === name || (x.en && x.en === name));
    return { ...i, itemId: hit ? Number(hit.id) : null };
  });
}

export type RecordedSale = { id: number; receiptId: string; total: string; payment: string; duplicate: boolean; booking: string | null; folioEntryId: number | null };

/**
 * One receipt of a department. The same receipt_id again returns the first one (duplicate: true), so a POS can retry.
 * payment "room" posts the amount on the guest's folio (booking confirmed or checked in), unless `postToFolio` is
 * false (CSV import of past sales, which the front desk has already charged).
 */
export async function recordPosSale(caller: PosCaller, sale: PosSale, opts: { source?: "pos" | "csv"; postToFolio?: boolean } = {}): Promise<RecordedSale | { error: "ROOM_NOT_FOUND" | "BOOKING_CLOSED" }> {
  const source = opts.source ?? "pos", post = opts.postToFolio ?? true;
  return withTransaction(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('pos:' || $1 || ':' || $2 || ':' || $3))`, [caller.ownerId, String(caller.departmentId), sale.receiptId]);
    const dup = (await c.query(`SELECT s.id,s.total_cents,s.payment,s.folio_entry_id,b.reference FROM pos_sales s LEFT JOIN bookings b ON b.owner_id=s.owner_id AND b.id=s.booking_id WHERE s.owner_id=$1 AND s.department_id=$2 AND s.receipt_id=$3`, [caller.ownerId, caller.departmentId, sale.receiptId])).rows[0];
    if (dup) return { id: Number(dup.id), receiptId: sale.receiptId, total: (Number(dup.total_cents) / 100).toFixed(2), payment: String(dup.payment), duplicate: true, booking: dup.reference ? String(dup.reference) : null, folioEntryId: dup.folio_entry_id ? Number(dup.folio_entry_id) : null };
    let booking: Record<string, unknown> | null = null, entry: number | null = null;
    if (sale.room) {
      booking = await findStay(c, caller.ownerId, sale.room) ?? null;
      if (sale.payment === "room") {
        if (!booking) return { error: "ROOM_NOT_FOUND" as const };
        if (!["confirmed", "checked_in"].includes(String(booking.status)) && post) return { error: "BOOKING_CLOSED" as const };
      }
    }
    const items = await matchItems(c, caller.ownerId, caller.departmentId, sale.items);
    if (booking && sale.payment === "room" && post) {
      const b = booking;
      await ensureFolio(c, caller.ownerId, { id: Number(b.id), total_cents: Number(b.total_cents), balance_cents: Number(b.balance_cents), check_in: String(b.check_in), check_out: String(b.check_out), folio_initialized_at: (b.folio_initialized_at as number | null) ?? null, created_at: Number(b.created_at) });
      const what = items.length ? items.slice(0, 4).map((i) => `${i.name}${i.quantity !== 1 ? ` × ${i.quantity}` : ""}`).join(", ") + (items.length > 4 ? "…" : "") : "POS";
      const e = await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest',$5,$6) RETURNING id`,
        [caller.ownerId, b.id, `${caller.department}: ${what} [POS ${sale.receiptId}]`.slice(0, 200), sale.totalCents, `pos:${caller.departmentId}`, Date.now()]);
      entry = Number(e.rows[0].id);
      await recalcBooking(c, caller.ownerId, Number(b.id));
    }
    const s = await c.query(
      `INSERT INTO pos_sales(owner_id,department_id,source,receipt_id,sold_at,sold_date,sold_hour,total_cents,payment,covers,booking_id,folio_entry_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'paid',$13) RETURNING id`,
      [caller.ownerId, caller.departmentId, source, sale.receiptId, sale.soldAt, sale.soldDate, sale.soldHour, sale.totalCents, sale.payment, sale.covers, booking ? Number(booking.id) : null, entry, Date.now()],
    );
    const id = Number(s.rows[0].id);
    for (const i of items) await c.query(`INSERT INTO pos_sale_items(owner_id,sale_id,item_id,name,sku,quantity,unit_cents,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [caller.ownerId, id, i.itemId, i.name, i.sku, i.quantity, i.unitCents, i.amountCents]);
    await c.query(`UPDATE department_pos SET last_sale_at=GREATEST(COALESCE(last_sale_at,0),$3::bigint) WHERE owner_id=$1 AND department_id=$2`, [caller.ownerId, caller.departmentId, source === "pos" ? Date.now() : 0]);
    return { id, receiptId: sale.receiptId, total: (sale.totalCents / 100).toFixed(2), payment: sale.payment, duplicate: false, booking: booking ? String(booking.reference) : null, folioEntryId: entry };
  });
}

/** Void a receipt (cancelled on the POS): out of the sales; a room charge is reversed on the folio. */
export async function voidPosSale(caller: PosCaller, receiptId: string): Promise<{ voided: boolean } | { error: "NOT_FOUND" }> {
  return withTransaction(async (c) => {
    const s = (await c.query(`SELECT * FROM pos_sales WHERE owner_id=$1 AND department_id=$2 AND receipt_id=$3 FOR UPDATE`, [caller.ownerId, caller.departmentId, receiptId])).rows[0];
    if (!s) return { error: "NOT_FOUND" as const };
    if (s.status === "void") return { voided: false };
    if (s.folio_entry_id && s.booking_id) {
      await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest',$5,$6)`,
        [caller.ownerId, s.booking_id, `Ακύρωση / Void: ${caller.department} [POS ${receiptId}]`.slice(0, 200), -Number(s.total_cents), `pos:${caller.departmentId}`, Date.now()]);
      await recalcBooking(c, caller.ownerId, Number(s.booking_id));
    }
    await c.query(`UPDATE pos_sales SET status='void',voided_at=$3 WHERE owner_id=$1 AND id=$2`, [caller.ownerId, s.id, Date.now()]);
    return { voided: true };
  });
}

/** Who is in a room (for «charge to room» on the POS): first name and initial only, and whether it can be charged. */
export async function posGuest(caller: PosCaller, room: string) {
  const b = (await db().query(
    `SELECT b.reference,b.guest_name,b.status,b.check_in,b.check_out,r.code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND (upper(b.reference)=upper($2) OR (b.status='checked_in' AND r.code=$2)) ORDER BY (upper(b.reference)=upper($2)) DESC, b.check_in DESC LIMIT 1`,
    [caller.ownerId, room.trim().slice(0, 60)],
  )).rows[0];
  if (!b) return null;
  const parts = String(b.guest_name).trim().split(/\s+/);
  return { reference: String(b.reference), room: b.code ? String(b.code) : null, guest: `${parts[0]}${parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : ""}`, check_out: String(b.check_out), can_charge: ["confirmed", "checked_in"].includes(String(b.status)) };
}

export async function posItems(caller: PosCaller) {
  const r = await db().query(`SELECT id,name_el,name_en,price_cents,pos_sku,active FROM department_items WHERE owner_id=$1 AND department_id=$2 AND deleted_at IS NULL ORDER BY sort_order,id`, [caller.ownerId, caller.departmentId]);
  return r.rows.map((i) => ({ id: Number(i.id), sku: String(i.pos_sku), name: String(i.name_el), name_en: String(i.name_en), price: (Number(i.price_cents) / 100).toFixed(2), active: Number(i.active) === 1 }));
}

/** The POS sends its products: matched by sku, new ones added (shown in the guest app when active). */
export async function syncPosItems(caller: PosCaller, items: { sku: string; name: string; name_en?: string; price: number; active?: boolean }[]) {
  let added = 0, updated = 0;
  await withTransaction(async (c) => {
    for (const it of items) {
      const now = Date.now(), cents = Math.round(it.price * 100), active = it.active === false ? 0 : 1;
      const u = await c.query(`UPDATE department_items SET name_el=$4,name_en=COALESCE(NULLIF($5,''),name_en),price_cents=$6,active=$7,updated_at=$8 WHERE owner_id=$1 AND department_id=$2 AND pos_sku=$3 AND deleted_at IS NULL`, [caller.ownerId, caller.departmentId, it.sku, it.name, it.name_en ?? "", cents, active, now]);
      if (u.rowCount) { updated++; continue; }
      await c.query(`INSERT INTO department_items(owner_id,department_id,name_el,name_en,price_cents,active,pos_sku,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1000,$8,$8)`, [caller.ownerId, caller.departmentId, it.name, it.name_en ?? "", cents, active, it.sku, now]);
      added++;
    }
  });
  return { added, updated };
}

/** Sales file from a POS without an API (PMS → Τμήματα → Πωλήσεις → Εισαγωγή CSV). Room charges are not posted again. */
export async function importSalesCsv(ownerId: string, departmentId: number, text: string) {
  const d = (await db().query(`SELECT name_el FROM hotel_departments WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, departmentId])).rows[0];
  if (!d) throw Error("NOT_FOUND");
  const caller: PosCaller = { ownerId, departmentId, department: String(d.name_el) };
  const parsed = parseSalesCsv(text), errors = [...parsed.errors];
  let added = 0, duplicates = 0, cents = 0;
  for (const raw of parsed.sales) {
    const n = normalizePosSale(raw);
    if (!n.sale) { if (errors.length < 30) errors.push(`${raw.receipt_id}: ${n.error}`); continue; }
    const r = await recordPosSale(caller, n.sale, { source: "csv", postToFolio: false });
    if ("error" in r) { if (errors.length < 30) errors.push(`${raw.receipt_id}: ${r.error}`); continue; }
    if (r.duplicate) duplicates++; else { added++; cents += n.sale.totalCents; }
  }
  return { added, duplicates, totalCents: cents, errors };
}

// ───────────────────────────── report ─────────────────────────────

export type SalesReport = SalesSummary & { names: Record<number, { name: string; icon: string }>; inHouseBookings: number; recent: { id: number; department: string; receiptId: string; at: number; totalCents: number; payment: string; source: string; reference: string | null; status: string }[] };

export async function salesReport(ownerId: string, from: string, to: string): Promise<SalesReport> {
  const days = daysBetween(from, to) + 1;
  const pfrom = addDays(from, -days), pto = addDays(from, -1);
  const pick = (list: Awaited<ReturnType<typeof loadSales>>, a: string, b: string) => list.filter((s) => s.date >= a && s.date <= b);
  const [all, depts, stays, recent] = await Promise.all([
    // A day of margin on each side for the time zone; the hotel date of each sale decides the period.
    loadSales(db(), ownerId, Date.parse(`${addDays(pfrom, -1)}T00:00:00Z`), Date.parse(`${addDays(to, 2)}T00:00:00Z`)),
    db().query(`SELECT id,name_el,icon FROM hotel_departments WHERE owner_id=$1`, [ownerId]),
    db().query(`SELECT count(*)::int n FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in','checked_out') AND check_in<=$3 AND check_out>$2`, [ownerId, from, to]),
    db().query(`SELECT s.id,s.receipt_id,s.sold_at,s.total_cents,s.payment,s.source,s.status,d.name_el,b.reference FROM pos_sales s LEFT JOIN hotel_departments d ON d.owner_id=s.owner_id AND d.id=s.department_id LEFT JOIN bookings b ON b.owner_id=s.owner_id AND b.id=s.booking_id WHERE s.owner_id=$1 AND s.sold_date>=$2 AND s.sold_date<=$3 ORDER BY s.sold_at DESC LIMIT 100`, [ownerId, from, to]),
  ]);
  const inHouse = Number(stays.rows[0]?.n ?? 0);
  const summary = salesSummary(pick(all, from, to), from, to, pick(all, pfrom, pto), inHouse);
  const names: SalesReport["names"] = {};
  for (const d of depts.rows) names[Number(d.id)] = { name: String(d.name_el), icon: String(d.icon) };
  return { ...summary, names, inHouseBookings: inHouse, recent: recent.rows.map((s) => ({ id: Number(s.id), department: String(s.name_el ?? ""), receiptId: String(s.receipt_id), at: Number(s.sold_at), totalCents: Number(s.total_cents), payment: String(s.payment), source: String(s.source), reference: s.reference ? String(s.reference) : null, status: String(s.status) })) };
}

/** The report as CSV (one line per department), for the accountant or a spreadsheet. */
export function reportCsv(r: SalesReport): string {
  const e = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const rows = [["Τμήμα", "Έσοδα €", "Πωλήσεις", "Μέση απόδειξη €", "Μετρητά €", "Κάρτα €", "Χρέωση δωματίου €", "Άλλο €", "Από εφαρμογή €", "Από POS €", "Πελάτες ξενοδοχείου", "Προηγ. περίοδος €", "Μεταβολή %"]];
  for (const d of r.departments) rows.push([r.names[d.departmentId]?.name ?? String(d.departmentId), e(d.revenueCents), String(d.receipts), e(d.avgTicketCents), e(d.byPayment.cash), e(d.byPayment.card), e(d.byPayment.room), e(d.byPayment.other), e(d.bySource.app), e(d.bySource.pos + d.bySource.csv), String(d.guests), e(d.previousRevenueCents), d.changePercent === null ? "" : String(d.changePercent)]);
  rows.push(["Σύνολο", e(r.totalCents), String(r.receipts), e(r.avgTicketCents), "", "", "", "", "", "", "", e(r.previousTotalCents), r.changePercent === null ? "" : String(r.changePercent)]);
  return `﻿${rows.map((x) => x.map((v) => (/[;"\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(";")).join("\r\n")}\r\n`;
}

// ───────────────────────────── sales advisor ─────────────────────────────

export type SuggestionView = { id: number; departmentId: number | null; department: string; kind: string; title: string; reasoning: string; segment: string; itemId: number | null; item: string; itemPriceCents: number | null; discountPercent: number; titleEl: string; titleEn: string; messageEl: string; messageEn: string; startsHour: number | null; durationHours: number; confidence: string; status: string; ai: boolean; createdAt: number; announcementId: number | null; orders: number; revenueCents: number };

export async function advisorState(ownerId: string) {
  const [runs, sugg] = await Promise.all([
    db().query(`SELECT id,kind,summary,error,created_at,tips_json FROM sales_advisor_runs WHERE owner_id=$1 ORDER BY id DESC LIMIT 5`, [ownerId]),
    db().query(
      `SELECT s.*,d.name_el dept,i.name_el item,i.price_cents item_price,
          (SELECT count(*)::int FROM department_orders o WHERE o.owner_id=s.owner_id AND o.announcement_id=s.announcement_id AND o.status<>'cancelled') AS orders,
          (SELECT COALESCE(sum(o.amount_cents),0)::bigint FROM department_orders o WHERE o.owner_id=s.owner_id AND o.announcement_id=s.announcement_id AND o.status<>'cancelled') AS revenue
         FROM sales_suggestions s LEFT JOIN hotel_departments d ON d.owner_id=s.owner_id AND d.id=s.department_id LEFT JOIN department_items i ON i.owner_id=s.owner_id AND i.id=s.item_id
        WHERE s.owner_id=$1 AND (s.status='open' OR s.handled_at>$2) ORDER BY (s.status='open') DESC, s.id DESC LIMIT 60`,
      [ownerId, Date.now() - 14 * 86_400_000],
    ),
  ]);
  const parse = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return {}; } };
  // The salesperson's methods per department: the playbook, and Claude's tips of the latest AI analysis.
  const depts = (await db().query(`SELECT id,name_el,icon FROM hotel_departments WHERE owner_id=$1 AND deleted_at IS NULL AND active=1 ORDER BY sort_order,id`, [ownerId])).rows;
  const lastAi = runs.rows.find((r) => r.kind === "ai");
  const aiTips = (Array.isArray(parse(lastAi?.tips_json ?? "[]")) ? parse(lastAi?.tips_json ?? "[]") : []) as { departmentId: number; tips: string[] }[];
  return {
    playbook: depts.map((d) => ({ departmentId: Number(d.id), name: String(d.name_el), icon: String(d.icon), methods: playbookFor(String(d.icon)), aiTips: aiTips.find((t) => t.departmentId === Number(d.id))?.tips ?? [], aiAt: lastAi ? Number(lastAi.created_at) : null })),
    runs: runs.rows.map((r) => ({ id: Number(r.id), kind: String(r.kind), summary: String(r.summary), error: String(r.error), at: Number(r.created_at) })),
    suggestions: sugg.rows.map((s): SuggestionView => ({ id: Number(s.id), departmentId: s.department_id === null ? null : Number(s.department_id), department: String(s.dept ?? ""), kind: String(s.kind), title: String(s.title), reasoning: String(s.reasoning), segment: String(parse(s.audience_json).segment ?? "all"), itemId: s.item_id === null ? null : Number(s.item_id), item: String(s.item ?? ""), itemPriceCents: s.item_price === null ? null : Number(s.item_price), discountPercent: Number(s.discount_percent), titleEl: String(s.title_el), titleEn: String(s.title_en), messageEl: String(s.message_el), messageEn: String(s.message_en), startsHour: s.starts_hour === null ? null : Number(s.starts_hour), durationHours: Number(s.duration_hours), confidence: String(s.confidence), status: String(s.status), ai: !s.rule_key, createdAt: Number(s.created_at), announcementId: s.announcement_id === null ? null : Number(s.announcement_id), orders: Number(s.orders), revenueCents: Number(s.revenue) })),
  };
}

export async function runAdvisorNow(ownerId: string, userId: number, useAi: boolean) {
  const apiKey = useAi ? await anthropicApiKey(ownerId) : null;
  return runSalesAdvisor({ pool: db(), owner: ownerId, apiKey, actor: userId, notify: false });
}

export async function dismissSuggestion(ownerId: string, id: number, userId: number): Promise<void> {
  const r = await db().query(`UPDATE sales_suggestions SET status='dismissed',handled_by=$3,handled_at=$4 WHERE owner_id=$1 AND id=$2 AND status='open'`, [ownerId, id, userId, Date.now()]);
  if (!r.rowCount) throw Error("ALREADY_HANDLED");
}

/** The offer of a suggestion, sent to the guests of its audience (texts as edited by the manager). */
export async function applySuggestion(ownerId: string, id: number, userId: number, edit: { titleEl: string; titleEn: string; bodyEl: string; bodyEn: string; discountPercent: number; durationHours: number }): Promise<number> {
  const s = (await db().query(`SELECT * FROM sales_suggestions WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0];
  if (!s) throw Error("NOT_FOUND");
  if (s.status !== "open") throw Error("ALREADY_HANDLED");
  const now = Date.now(), w = suggestionWindow({ startsHour: s.starts_hour === null ? null : Number(s.starts_hour), durationHours: Math.max(1, edit.durationHours) }, now);
  const announcementId = await createAnnouncement(ownerId, userId, {
    departmentId: s.department_id === null ? null : Number(s.department_id), bookingId: null, kind: String(s.kind) === "happy_hour" ? "happy_hour" : "offer",
    titleEl: edit.titleEl, titleEn: edit.titleEn, bodyEl: edit.bodyEl, bodyEn: edit.bodyEn, startsAt: w.startsAt, endsAt: w.endsAt,
    audience: JSON.parse(String(s.audience_json || "{}")), itemId: s.item_id === null ? null : Number(s.item_id), discountPercent: edit.discountPercent, suggestionId: id,
  });
  await db().query(`UPDATE sales_suggestions SET status='applied',announcement_id=$3,handled_by=$4,handled_at=$5 WHERE owner_id=$1 AND id=$2`, [ownerId, id, announcementId, userId, now]);
  return announcementId;
}
