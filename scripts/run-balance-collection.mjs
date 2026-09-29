// Automatic balance collection (PMS instance only). Daily cPanel cron, e.g. 09:05:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-balance-collection.mjs
// Charges the card saved at booking (Stripe, off-session) N days before arrival, as set in PMS → payment policy.
// Declined cards, cards needing authentication and bookings without a saved card alert reception instead.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { attemptAllowed, balanceChargeForm, collectionDue } from "./balance-collection-core.mjs";

if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function unseal(value) {
  const key = createHash("sha256").update(process.env.PMS_DOCUMENT_KEY ?? "").digest();
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw Error("INVALID_CIPHERTEXT");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
async function stripeKey() {
  const r = await pool.query(`SELECT active,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='stripe'`, [owner]);
  if (r.rowCount) return Number(r.rows[0].active) ? JSON.parse(unseal(r.rows[0].secrets_encrypted)).secretKey : null;
  return process.env.STRIPE_SECRET_KEY || null;
}
async function notify(titleEl, titleEn, bookingId) {
  await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'payment',$2,$3,$4,$5)`, [owner, titleEl, titleEn, `/pms/reservations/${bookingId}`, Date.now()]);
}
async function attempt(bookingId, amount, status, reference, error) {
  await pool.query(`INSERT INTO balance_collection_attempts(owner_id,booking_id,amount_cents,status,provider_reference,error,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [owner, bookingId, amount, status, reference, error, Date.now()]);
}

try {
  const p = (await pool.query(`SELECT full_payment_days_before_arrival,full_payment_window_active FROM payment_policies WHERE owner_id=$1 AND active=1 LIMIT 1`, [owner])).rows[0];
  const policy = { active: Number(p?.full_payment_window_active ?? 1) === 1, days: Number(p?.full_payment_days_before_arrival ?? 7) };
  const key = await stripeKey();
  const candidates = (await pool.query(
    // Each booking carries its rate plan's charge day (-1 = balance paid at the hotel); older bookings use the general policy.
    `SELECT id,reference,status,check_in,balance_cents,payment_provider,payment_customer_ref,payment_method_ref,balance_charge_days FROM bookings
      WHERE owner_id=$1 AND status='confirmed' AND balance_cents>0 AND check_in>=$2 AND COALESCE(balance_charge_days,0)>=0
        AND check_in<=($2::date+COALESCE(balance_charge_days,$3)::int)::text`,
    [owner, today, policy.days],
  )).rows.filter((b) => collectionDue(b, b.balance_charge_days === null || b.balance_charge_days === undefined ? policy : { active: true, days: Number(b.balance_charge_days) }, today));
  let charged = 0, failed = 0, noCard = 0;
  for (const booking of candidates) {
    const attempts = (await pool.query(`SELECT status,created_at FROM balance_collection_attempts WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at DESC`, [owner, booking.id])).rows;
    const amount = Number(booking.balance_cents);
    if (!(booking.payment_provider === "stripe" && booking.payment_customer_ref && booking.payment_method_ref && key)) {
      if (!attempts.some((a) => a.status === "no_card")) {
        await attempt(booking.id, amount, "no_card", null, null);
        await notify(`Υπόλοιπο €${(amount / 100).toFixed(2)} πληρωτέο · ${booking.reference} · χωρίς αποθηκευμένη κάρτα: στείλτε σύνδεσμο πληρωμής`, `Balance €${(amount / 100).toFixed(2)} due · ${booking.reference} · no card on file: send a payment link`, booking.id);
        noCard++;
      }
      continue;
    }
    if (!attemptAllowed(attempts, Date.now())) continue;
    const response = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `balance-${owner}-${booking.id}-${amount}-${attempts.length}` },
      body: balanceChargeForm(booking, amount),
      signal: AbortSignal.timeout(20_000),
    });
    const intent = await response.json().catch(() => ({}));
    if (response.ok && intent.status === "succeeded") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT id FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [owner, booking.id]);
        await client.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at,payment_method,receipt_reference) VALUES($1,$2,'payment','other','Αυτόματη χρέωση υπολοίπου / Automatic balance charge',$3,'guest','auto-balance',$4,'stripe',$5) ON CONFLICT DO NOTHING`, [owner, booking.id, -amount, Date.now(), intent.id]);
        await client.query(`INSERT INTO payment_transactions(owner_id,booking_id,provider,provider_reference,kind,status,amount_cents,currency,created_at) VALUES($1,$2,'stripe',$3,'payment','succeeded',$4,'EUR',$5) ON CONFLICT(provider,provider_reference) DO NOTHING`, [owner, booking.id, intent.id, amount, Date.now()]);
        await client.query(`UPDATE bookings SET balance_cents=GREATEST(0,balance_cents-$1),version=version+1 WHERE owner_id=$2 AND id=$3`, [amount, owner, booking.id]);
        await client.query(`INSERT INTO balance_collection_attempts(owner_id,booking_id,amount_cents,status,provider_reference,created_at) VALUES($1,$2,$3,'succeeded',$4,$5)`, [owner, booking.id, amount, intent.id, Date.now()]);
        await client.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'payment',$2,$3,$4,$5)`, [owner, `Εισπράχθηκε αυτόματα το υπόλοιπο €${(amount / 100).toFixed(2)} · ${booking.reference}`, `Balance €${(amount / 100).toFixed(2)} collected automatically · ${booking.reference}`, `/pms/reservations/${booking.id}`, Date.now()]);
        await client.query("COMMIT");
        charged++;
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`Charged ${intent.id} but could not record it for booking ${booking.id}; record it manually in the folio.`, error);
      } finally {
        client.release();
      }
    } else {
      const reason = String(intent.error?.decline_code ?? intent.error?.code ?? intent.status ?? response.status).slice(0, 120);
      await attempt(booking.id, amount, "failed", intent.error?.payment_intent?.id ?? intent.id ?? null, reason);
      await notify(`Αποτυχία αυτόματης χρέωσης υπολοίπου · ${booking.reference} (${reason}): στείλτε σύνδεσμο πληρωμής`, `Automatic balance charge failed · ${booking.reference} (${reason}): send a payment link`, booking.id);
      failed++;
    }
  }
  console.log(`Balance collection ${today}: ${candidates.length} due, ${charged} charged, ${failed} failed, ${noCard} without card.`);
} finally {
  await pool.end();
}
