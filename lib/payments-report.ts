// Payments & fiscal documents register for the PMS "Payments & receipts/invoices" screen and its CSV export.
import { db } from "@/lib/db";

export type PaymentRow = { id: number; booking_id: number; reference: string; guest_name: string; entry_type: string; payment_method: string | null; description: string; amount_cents: number; payer: string; receipt_reference: string | null; created_at: number; actor: string | null };
export type DocumentRow = { id: number; booking_id: number; reference: string; guest_name: string; invoice_type: string; series: string; aa: number; issue_date: string; payer: string; total_cents: number; status: string; mark: string | null; qr_url: string | null; last_error: string | null; created_at: number };

/** Payments and refunds recorded on folios in [from, to] (Athens dates, inclusive), newest first. */
export async function paymentsBetween(ownerId: string, from: string, to: string, method: string | null) {
  const r = await db().query(
    `SELECT f.id,f.booking_id,b.reference,b.guest_name,f.entry_type,f.payment_method,f.description,f.amount_cents,f.payer,f.receipt_reference,f.created_at,s.display_name actor
       FROM folio_entries f JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id
       LEFT JOIN pms_staff_users s ON s.owner_id=f.owner_id AND s.id::text=f.actor_id
      WHERE f.owner_id=$1 AND f.entry_type IN ('payment','refund')
        AND (to_timestamp(f.created_at/1000.0) AT TIME ZONE 'Europe/Athens')::date BETWEEN $2::date AND $3::date
        AND ($4::text IS NULL OR COALESCE(f.payment_method,'other')=$4)
      ORDER BY f.created_at DESC LIMIT 2000`,
    [ownerId, from, to, method],
  );
  return r.rows.map((x) => ({ ...x, id: Number(x.id), booking_id: Number(x.booking_id), amount_cents: Number(x.amount_cents), created_at: Number(x.created_at) })) as PaymentRow[];
}

export async function documentsBetween(ownerId: string, from: string, to: string) {
  const r = await db().query(
    `SELECT d.id,d.booking_id,b.reference,b.guest_name,d.invoice_type,d.series,d.aa,d.issue_date,d.payer,d.total_cents,d.status,d.mark,d.qr_url,d.last_error,d.created_at
       FROM fiscal_documents d JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id
      WHERE d.owner_id=$1 AND d.issue_date BETWEEN $2 AND $3 ORDER BY d.issue_date DESC,d.id DESC LIMIT 2000`,
    [ownerId, from, to],
  );
  return r.rows.map((x) => ({ ...x, id: Number(x.id), booking_id: Number(x.booking_id), aa: Number(x.aa), total_cents: Number(x.total_cents), created_at: Number(x.created_at) })) as DocumentRow[];
}

/** Money received per method; refunds are stored as positive balance changes, so they reduce the takings. */
export function takingsByMethod(rows: PaymentRow[]) {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.payment_method || "other", (map.get(r.payment_method || "other") ?? 0) - r.amount_cents);
  return [...map.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);
}

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
export function toCsv(header: string[], rows: unknown[][]) {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}
