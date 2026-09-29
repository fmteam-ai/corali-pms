import type { PoolClient } from "pg";
import { evenNights, impliedInitialPayment, reconcileNights, summarizeFolio, type Night, type Payer } from "@/lib/folio";

type Queryable = Pick<PoolClient, "query">;

export async function loadFolio(client: Queryable, ownerId: string, bookingId: number) {
  const [nights, entries, payers] = await Promise.all([
    client.query(`SELECT stay_date,amount_cents,original_cents,payer,updated_by,updated_at FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2 ORDER BY stay_date`, [ownerId, bookingId]),
    client.query(`SELECT * FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at,id`, [ownerId, bookingId]),
    client.query(`SELECT payer_type,name,vat_number,tax_office,address,email FROM booking_payers WHERE owner_id=$1 AND booking_id=$2`, [ownerId, bookingId]),
  ]);
  return { nights: nights.rows as Night[], entries: entries.rows, payers: payers.rows, summary: summarizeFolio(nights.rows as Night[], entries.rows) };
}

/**
 * Give a booking a complete ledger the first time its folio is used: nightly accommodation rates from the booked
 * total and a line for any payment taken at booking time. Must run inside a transaction holding the booking row lock.
 */
export async function ensureFolio(client: Queryable, ownerId: string, booking: { id: number; total_cents: number; balance_cents: number; check_in: string; check_out: string; folio_initialized_at: number | null; created_at?: number }) {
  if (booking.folio_initialized_at) return;
  const now = Date.now();
  const existing = await client.query(`SELECT amount_cents FROM folio_entries WHERE owner_id=$1 AND booking_id=$2`, [ownerId, booking.id]);
  const nightly = await client.query(`SELECT 1 FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2 LIMIT 1`, [ownerId, booking.id]);
  if (!nightly.rowCount) {
    for (const night of evenNights(Number(booking.total_cents), booking.check_in, booking.check_out)) {
      await client.query(
        `INSERT INTO booking_nightly_rates(owner_id,booking_id,stay_date,amount_cents,original_cents,payer,updated_by,updated_at) VALUES($1,$2,$3,$4,$4,$5,'system',$6) ON CONFLICT DO NOTHING`,
        [ownerId, booking.id, night.stay_date, night.amount_cents, night.payer, now],
      );
    }
    const paid = impliedInitialPayment(Number(booking.total_cents), Number(booking.balance_cents), existing.rows.map((r) => Number(r.amount_cents)));
    if (paid > 0) {
      await client.query(
        `INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at,payment_method) VALUES($1,$2,'payment','other',$3,$4,'guest','system',$5,'prior')`,
        [ownerId, booking.id, "Πληρωμή κατά την κράτηση / Payment at booking", -paid, Number(booking.created_at ?? now)],
      );
    }
  }
  await client.query(`UPDATE bookings SET folio_initialized_at=$1 WHERE owner_id=$2 AND id=$3`, [now, ownerId, booking.id]);
}

/** Recompute the stored total and balance from the ledger (single source of truth for reports and payments). */
export async function recalcBooking(client: Queryable, ownerId: string, bookingId: number) {
  const folio = await loadFolio(client, ownerId, bookingId);
  if (!folio.nights.length) return folio.summary;
  await client.query(`UPDATE bookings SET total_cents=$1,balance_cents=GREATEST(0,$2),version=version+1 WHERE owner_id=$3 AND id=$4`, [folio.summary.charges, folio.summary.balance, ownerId, bookingId]);
  return folio.summary;
}

/** Keep nightly rates aligned with the stay after a move or date change. */
export async function moveNights(client: Queryable, ownerId: string, bookingId: number, checkIn: string, checkOut: string, actor: string) {
  const current = await client.query(`SELECT stay_date,amount_cents,original_cents,payer FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2 ORDER BY stay_date`, [ownerId, bookingId]);
  if (!current.rowCount) return false;
  const next = reconcileNights(current.rows as Night[], checkIn, checkOut);
  await client.query(`DELETE FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2`, [ownerId, bookingId]);
  const now = Date.now();
  for (const n of next) {
    await client.query(`INSERT INTO booking_nightly_rates(owner_id,booking_id,stay_date,amount_cents,original_cents,payer,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [ownerId, bookingId, n.stay_date, n.amount_cents, n.original_cents ?? n.amount_cents, n.payer as Payer, actor, now]);
  }
  return true;
}

/** Read-only folio view: a booking that has never been edited is shown with its derived ledger without writing it. */
export async function folioView(client: Queryable, ownerId: string, booking: { id: number; total_cents: number; balance_cents: number; check_in: string; check_out: string; folio_initialized_at: number | null; created_at?: number }) {
  const folio = await loadFolio(client, ownerId, booking.id);
  if (booking.folio_initialized_at || folio.nights.length) return { ...folio, initialized: true };
  const nights = evenNights(Number(booking.total_cents), booking.check_in, booking.check_out);
  const paid = impliedInitialPayment(Number(booking.total_cents), Number(booking.balance_cents), folio.entries.map((e) => Number(e.amount_cents)));
  const entries = paid > 0 ? [{ id: 0, entry_type: "payment", category: "other", description: "Πληρωμή κατά την κράτηση / Payment at booking", amount_cents: -paid, payer: "guest", payment_method: "prior", actor_id: "system", created_at: Number(booking.created_at ?? 0) }, ...folio.entries] : folio.entries;
  return { nights, entries, payers: folio.payers, summary: summarizeFolio(nights, entries), initialized: false };
}

type OnlineSource = { room_subtotal_cents: number; extras_cents: number; charge_breakdown: string; check_in: string; check_out: string };

/**
 * Itemised folio for a paid online booking (one booking per room): nightly room rates, extras, mandatory charges
 * (climate resilience fee as tax), the Stripe payment, and a discount/adjustment line so the ledger equals the charged total.
 */
export async function postOnlineFolio(client: Queryable, ownerId: string, bookingId: number, source: OnlineSource, index: number, rooms: number, bookingTotal: number, paid: number, paymentReference: string) {
  const share = (total: number) => {
    const safe = Math.max(0, Math.trunc(Number(total) || 0));
    return Math.floor(safe / rooms) + (index < safe % rooms ? 1 : 0);
  };
  const now = Date.now();
  const room = share(source.room_subtotal_cents);
  for (const night of evenNights(room, source.check_in, source.check_out)) {
    await client.query(`INSERT INTO booking_nightly_rates(owner_id,booking_id,stay_date,amount_cents,original_cents,payer,updated_by,updated_at) VALUES($1,$2,$3,$4,$4,'guest','online',$5) ON CONFLICT DO NOTHING`, [ownerId, bookingId, night.stay_date, night.amount_cents, now]);
  }
  let posted = room;
  const charge = async (category: string, description: string, amount: number) => {
    if (amount <= 0) return;
    posted += amount;
    await client.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge',$3,$4,$5,'guest','online',$6)`, [ownerId, bookingId, category, description.slice(0, 300), amount, now]);
  };
  await charge("extra", "Πρόσθετες υπηρεσίες / Extras", share(source.extras_cents));
  let breakdown: { name?: unknown; category?: unknown; total_cents?: unknown }[] = [];
  try { const parsed = JSON.parse(source.charge_breakdown || "[]"); if (Array.isArray(parsed)) breakdown = parsed; } catch { breakdown = []; }
  for (const item of breakdown) {
    const category = /climate/.test(String(item.category ?? "")) ? "tax" : "fee";
    await charge(category, String(item.name ?? "Χρέωση / Charge"), share(Number(item.total_cents)));
  }
  const difference = Math.trunc(bookingTotal) - posted;
  if (difference < 0) await client.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'discount','other','Έκπτωση κράτησης / Booking discount',$3,'guest','online',$4)`, [ownerId, bookingId, difference, now]);
  if (difference > 0) await charge("other", "Διαφορά τιμολόγησης / Pricing adjustment", difference);
  if (paid > 0) await client.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at,payment_method,receipt_reference) VALUES($1,$2,'payment','other','Stripe online',$3,'guest','stripe-webhook',$4,'stripe',$5) ON CONFLICT DO NOTHING`, [ownerId, bookingId, -paid, now, paymentReference]);
  await client.query(`UPDATE bookings SET folio_initialized_at=$1 WHERE owner_id=$2 AND id=$3`, [now, ownerId, bookingId]);
  await recalcBooking(client, ownerId, bookingId);
}
