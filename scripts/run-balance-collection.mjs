// Automatic balance collection (PMS instance only). Daily cPanel cron, e.g. 09:05:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-balance-collection.mjs
// Charges the card saved at booking (Stripe, off-session) N days before arrival, as set in PMS → payment policy.
// When the charge fails (declined, authentication needed, no saved card) the guest is emailed a payment link valid for
// 48 hours and reception is alerted; a booking still unpaid after the deadline is cancelled automatically.
// Run it hourly so the 48-hour deadline is applied on time, e.g. `5 * * * *`.
import process from "node:process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { PAYMENT_DEADLINE_MS, attemptAllowed, balanceChargeForm, collectionDue, deadlineExpired, deadlineLabel } from "./balance-collection-core.mjs";
import { cancellationRefund, guestMessaging } from "./automation-core.mjs";

if (!process.env.DATABASE_URL || !process.env.PMS_DOCUMENT_KEY || !process.env.BOOKING_ORIGIN) throw Error("DATABASE_URL, PMS_DOCUMENT_KEY and BOOKING_ORIGIN are required");
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
function seal(value) {
  const key = createHash("sha256").update(process.env.PMS_DOCUMENT_KEY ?? "").digest(), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
async function smtpSettings() {
  const r = await pool.query(`SELECT active,settings_json,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='smtp'`, [owner]);
  if (r.rowCount) {
    if (!Number(r.rows[0].active)) return null;
    const settings = JSON.parse(r.rows[0].settings_json), secrets = JSON.parse(unseal(r.rows[0].secrets_encrypted));
    return settings.host && settings.username && settings.from && secrets.password ? { host: settings.host, port: Number(settings.port || 587), user: settings.username, pass: secrets.password, from: settings.from } : null;
  }
  const e = process.env;
  return e.SMTP_HOST && e.SMTP_USERNAME && e.SMTP_PASSWORD && e.SMTP_FROM ? { host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), user: e.SMTP_USERNAME, pass: e.SMTP_PASSWORD, from: e.SMTP_FROM } : null;
}
/** Sends one email; returns false (and logs) when SMTP is missing or fails, so payment handling never stops on email. */
async function sendMail(to, subject, text) {
  const s = await smtpSettings();
  if (!s || !to) { console.error(`Email not sent (${s ? "no recipient" : "SMTP not configured"}): ${subject}`); return false; }
  try {
    await nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }).sendMail({ from: s.from, to, subject, text });
    return true;
  } catch (error) { console.error(`Email failed: ${subject}`, error); return false; }
}
const hotelAddress = async () => (await smtpSettings())?.from ?? null;
const reasonsEl = { no_card: "δεν υπάρχει αποθηκευμένη κάρτα", card_declined: "η κάρτα απορρίφθηκε", insufficient_funds: "ανεπαρκές υπόλοιπο", expired_card: "η κάρτα έχει λήξει", authentication_required: "η τράπεζα ζήτησε επιβεβαίωση (3D Secure)", requires_action: "η τράπεζα ζήτησε επιβεβαίωση (3D Secure)", do_not_honor: "η τράπεζα αρνήθηκε τη χρέωση", lost_card: "δηλωμένη απώλεια κάρτας", stolen_card: "δηλωμένη κλοπή κάρτας" };
const reasonEl = (code) => (reasonsEl[code] ? `${reasonsEl[code]} (${code})` : code);
const money = (cents, lang) => new Intl.NumberFormat(lang === "el" ? "el-GR" : lang, { style: "currency", currency: "EUR" }).format(cents / 100);

/** Queue a guest message (email; WhatsApp if opted in) for the automation worker; returns how many channels were queued. */
async function queueGuest(client, booking, event, payload) {
  if (!guestMessaging(booking.channel)) return 0;
  const channels = [booking.guest_email ? "email" : null, Number(booking.whatsapp_opt_in) === 1 && booking.guest_phone ? "whatsapp" : null].filter(Boolean);
  const now = Date.now();
  for (const channel of channels) await client.query(`INSERT INTO message_deliveries(owner_id,booking_id,event_key,channel,scheduled_at,status,payload_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$5,$5) ON CONFLICT(owner_id,booking_id,event_key,channel) DO UPDATE SET status='pending',attempts=0,last_error=NULL,payload_json=$6,scheduled_at=$5,updated_at=$5`, [owner, booking.id, event, channel, now, JSON.stringify(payload)]);
  return channels.length;
}

/** Charge failed or impossible: payment link valid 48 h to the guest, alert to the hotel, booking marked with the deadline. */
async function requestPayment(booking, amount, reason) {
  const deadline = Date.now() + PAYMENT_DEADLINE_MS, token = randomBytes(32).toString("base64url");
  let queued = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = (await client.query(`SELECT balance_deadline_at,status,balance_cents FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [owner, booking.id])).rows[0];
    if (!locked || locked.balance_deadline_at !== null || locked.status !== "confirmed" || !(Number(locked.balance_cents) > 0)) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE balance_payment_links SET status='revoked' WHERE owner_id=$1 AND booking_id=$2 AND status='active'`, [owner, booking.id]);
    await client.query(`INSERT INTO balance_payment_links(owner_id,booking_id,token_hash,token_encrypted,status,expires_at,created_at) VALUES($1,$2,$3,$4,'active',$5,$6)`, [owner, booking.id, createHash("sha256").update(token).digest("hex"), seal(token), deadline, Date.now()]);
    await client.query(`UPDATE bookings SET balance_deadline_at=$1,version=version+1 WHERE owner_id=$2 AND id=$3`, [deadline, owner, booking.id]);
    await client.query(`INSERT INTO balance_collection_attempts(owner_id,booking_id,amount_cents,status,error,created_at) VALUES($1,$2,$3,'payment_requested',$4,$5)`, [owner, booking.id, amount, reason, Date.now()]);
    await client.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'payment',$2,$3,$4,$5)`, [owner,
      `Αποτυχία χρέωσης υπολοίπου €${(amount / 100).toFixed(2)} · ${booking.reference} (${reasonEl(reason)}) · στάλθηκε σύνδεσμος πληρωμής, αυτόματη ακύρωση αν δεν εξοφληθεί έως ${deadlineLabel(deadline, "el")}`,
      `Balance charge failed €${(amount / 100).toFixed(2)} · ${booking.reference} (${reason}) · payment link sent, automatic cancellation if unpaid by ${deadlineLabel(deadline, "en")}`, `/pms/reservations/${booking.id}`, Date.now()]);
    queued = await queueGuest(client, booking, "payment_failed", { deadline, amountCents: amount });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const link = `${process.env.BOOKING_ORIGIN}/pay-balance?token=${encodeURIComponent(token)}&lang=${["el", "en", "fr", "de", "it", "es"].includes(booking.guest_language) ? booking.guest_language : "en"}`;
  const guestSent = queued > 0;
  const hotel = await hotelAddress();
  if (hotel) await sendMail(hotel, `[Corali PMS] Αποτυχία χρέωσης υπολοίπου · ${booking.reference}`, `Η αυτόματη χρέωση του υπολοίπου ${money(amount, "el")} για την κράτηση ${booking.reference} (${booking.guest_name}, ${booking.check_in} – ${booking.check_out}) απέτυχε: ${reasonEl(reason)}.\n\n${guestSent ? `Ο επισκέπτης ενημερώνεται με σύνδεσμο πληρωμής (email${Number(booking.whatsapp_opt_in) === 1 && booking.guest_phone ? " και WhatsApp" : ""}).` : "ΠΡΟΣΟΧΗ: ο επισκέπτης ΔΕΝ μπορεί να ενημερωθεί αυτόματα (χωρίς email/WhatsApp ή κράτηση OTA) — επικοινωνήστε μαζί του."}\nΑν δεν εξοφληθεί έως ${deadlineLabel(deadline, "el")}, η κράτηση ακυρώνεται αυτόματα.\n\nΣύνδεσμος πληρωμής: ${link}\nPMS: /pms/reservations/${booking.id}`);
  if (!guestSent) await notify(`Ο επισκέπτης ΔΕΝ ενημερώθηκε αυτόματα για την αποτυχία πληρωμής · ${booking.reference}: επικοινωνήστε μαζί του`, `Guest NOT notified automatically about the failed payment · ${booking.reference}: contact them`, booking.id);
  return true;
}

/** Bookings still unpaid after their 48-hour payment deadline are cancelled automatically. */
async function cancelExpired() {
  const due = (await pool.query(`SELECT id,reference,status,guest_name,guest_email,guest_phone,whatsapp_opt_in,channel,guest_language,check_in,check_out,total_cents,balance_cents,rate_policy,cancellation_days,refund_percent,balance_deadline_at FROM bookings WHERE owner_id=$1 AND status='confirmed' AND balance_cents>0 AND balance_deadline_at IS NOT NULL AND balance_deadline_at<=$2`, [owner, Date.now()])).rows.filter((b) => deadlineExpired(b, Date.now()));
  let cancelled = 0;
  for (const booking of due) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = (await client.query(`SELECT status,balance_cents,balance_deadline_at FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [owner, booking.id])).rows[0];
      if (!locked || !deadlineExpired(locked, Date.now())) { await client.query("ROLLBACK"); continue; }
      await client.query(`UPDATE bookings SET status='cancelled',cancelled_at=$1,version=version+1 WHERE owner_id=$2 AND id=$3`, [Date.now(), owner, booking.id]);
      await client.query(`UPDATE balance_payment_links SET status='revoked' WHERE owner_id=$1 AND booking_id=$2 AND status IN ('active','checkout_pending')`, [owner, booking.id]);
      await client.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,next_attempt_at,created_at,updated_at) VALUES($1,$2,$3,'unpaid_balance_cancel','pending',0,$4,$4)`, [owner, booking.check_in, booking.check_out, Date.now()]);
      await client.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'payment',$2,$3,$4,$5)`, [owner, `Αυτόματη ακύρωση: ${booking.reference} · ${booking.guest_name} — το υπόλοιπο δεν εξοφλήθηκε σε 48 ώρες`, `Cancelled automatically: ${booking.reference} · ${booking.guest_name} — balance not paid within 48 hours`, `/pms/reservations/${booking.id}`, Date.now()]);
      const paidCents = Math.max(0, Number(booking.total_cents) - Number(booking.balance_cents));
      const refund = cancellationRefund({ paidCents, ratePolicy: booking.rate_policy, cancellationDays: booking.cancellation_days, checkIn: booking.check_in, cancelledOn: today, refundPercent: booking.refund_percent });
      await queueGuest(client, booking, "cancellation", { reason: "unpaid_balance", paidCents, refund: refund.outcome, refundCents: refund.refundCents, refundPercent: refund.percent, freeUntil: refund.freeUntil, nonRefundable: booking.rate_policy === "non_refundable" });
      await client.query("COMMIT");
      cancelled++;
    } catch (error) { await client.query("ROLLBACK"); console.error(`Could not cancel booking ${booking.id}`, error); continue; } finally { client.release(); }
    const hotel = await hotelAddress();
    if (hotel) await sendMail(hotel, `[Corali PMS] Αυτόματη ακύρωση · ${booking.reference}`, `Η κράτηση ${booking.reference} (${booking.guest_name}, ${booking.check_in} – ${booking.check_out}) ακυρώθηκε αυτόματα: το υπόλοιπο ${money(Number(booking.balance_cents), "el")} δεν εξοφλήθηκε μέσα σε 48 ώρες.\nPMS: /pms/reservations/${booking.id}`);
  }
  return cancelled;
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
    `SELECT id,reference,status,check_in,check_out,guest_name,guest_email,guest_phone,whatsapp_opt_in,channel,guest_language,balance_cents,payment_provider,payment_customer_ref,payment_method_ref,balance_charge_days FROM bookings
      WHERE owner_id=$1 AND status='confirmed' AND balance_cents>0 AND balance_deadline_at IS NULL AND check_in>=$2 AND COALESCE(balance_charge_days,0)>=0
        AND check_in<=($2::date+COALESCE(balance_charge_days,$3)::int)::text`,
    [owner, today, policy.days],
  )).rows.filter((b) => collectionDue(b, b.balance_charge_days === null || b.balance_charge_days === undefined ? policy : { active: true, days: Number(b.balance_charge_days) }, today));
  let charged = 0, failed = 0, noCard = 0;
  for (const booking of candidates) {
    const attempts = (await pool.query(`SELECT status,created_at FROM balance_collection_attempts WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at DESC`, [owner, booking.id])).rows;
    const amount = Number(booking.balance_cents);
    if (!(booking.payment_provider === "stripe" && booking.payment_customer_ref && booking.payment_method_ref && key)) {
      await attempt(booking.id, amount, "no_card", null, null);
      if (await requestPayment(booking, amount, "no_card")) noCard++;
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
      await requestPayment(booking, amount, reason);
      failed++;
    }
  }
  const cancelled = await cancelExpired();
  console.log(`Balance collection ${today}: ${candidates.length} due, ${charged} charged, ${failed} failed (payment link sent), ${noCard} without card (payment link sent), ${cancelled} cancelled after the 48-hour deadline.`);
} finally {
  await pool.end();
}
