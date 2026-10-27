// Corali open API webhooks in the automation cron (every minute): finds booking changes and new folio charges /
// payments, queues one delivery per subscribed webhook and sends due deliveries, signed, with retries.
import { randomUUID } from "node:crypto";
import { bookingEvent, bookingFingerprint, folioEvent, retryDelayMs, signWebhook } from "./open-api-core.mjs";

const eur = (cents) => (Number(cents) / 100).toFixed(2);

export function bookingData(b) {
  return { id: Number(b.id), reference: String(b.reference), status: String(b.status), channel: String(b.channel), guest: { name: String(b.guest_name), email: b.guest_email ?? null, language: String(b.guest_language ?? "en") }, room: b.room_code ? { code: String(b.room_code), type: String(b.room_type ?? "") } : null, check_in: String(b.check_in), check_out: String(b.check_out), total: eur(b.total_cents), balance: eur(b.balance_cents), currency: "EUR" };
}

/** POST one queued delivery; records the outcome and the next try. */
export async function sendDelivery(pool, d, secret) {
  const body = String(d.payload_json), now = Date.now();
  let status = null, error = "";
  try {
    const r = await fetch(String(d.url), { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json", "User-Agent": "Corali-PMS-Webhooks/1", "Corali-Event": String(d.event), "Corali-Delivery": String(d.id), "Corali-Signature": signWebhook(secret, body, now) }, body });
    status = r.status;
    if (r.status < 200 || r.status >= 300) error = `HTTP ${r.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "SEND_FAILED";
  }
  const attempts = Number(d.attempts) + 1;
  if (!error) {
    await pool.query(`UPDATE api_webhook_deliveries SET status='sent',attempts=$2,response_status=$3,last_error=NULL,sent_at=$4 WHERE id=$1`, [d.id, attempts, status, now]);
    await pool.query(`UPDATE api_webhooks SET last_ok_at=$2,last_error=NULL WHERE id=$1`, [d.webhook_id, now]);
    return { ok: true, status };
  }
  const wait = retryDelayMs(attempts);
  await pool.query(`UPDATE api_webhook_deliveries SET status=$2,attempts=$3,response_status=$4,last_error=$5,next_at=$6 WHERE id=$1`, [d.id, wait === null ? "failed" : "pending", attempts, status, error, wait === null ? now : now + wait]);
  await pool.query(`UPDATE api_webhooks SET last_error=$2 WHERE id=$1`, [d.webhook_id, error]);
  return { ok: false, status, error };
}

async function queue(pool, owner, hooks, event, data, now) {
  const targets = hooks.filter((h) => h.events.includes(event));
  if (!targets.length) return 0;
  const payload = JSON.stringify({ id: `evt_${randomUUID()}`, event, created_at: new Date(now).toISOString(), data });
  for (const h of targets) await pool.query(`INSERT INTO api_webhook_deliveries(owner_id,webhook_id,event,payload_json,next_at,created_at) VALUES($1,$2,$3,$4,$5,$5)`, [owner, h.id, event, payload, now]);
  return targets.length;
}

const BOOKINGS_SQL = `SELECT b.id,b.reference,b.status,b.channel,b.guest_name,b.guest_email,b.guest_language,b.room_id,b.check_in,b.check_out,b.total_cents,b.balance_cents,r.code room_code,r.room_type
  FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
  WHERE b.owner_id=$1 AND (b.check_out>=$2 OR b.created_at>$3) ORDER BY b.id`;

export async function runApiWebhooks({ pool, owner, unseal }) {
  const now = Date.now();
  const hooks = (await pool.query(`SELECT id,url,events_json,secret_encrypted FROM api_webhooks WHERE owner_id=$1 AND active=1`, [owner])).rows.map((h) => ({ ...h, events: JSON.parse(String(h.events_json)) }));
  if (!hooks.length) {
    // Nothing listens: start again at the current moment when a webhook is switched on (no flood of old changes).
    await pool.query(`UPDATE api_event_cursor SET seeded_at=NULL WHERE owner_id=$1 AND seeded_at IS NOT NULL`, [owner]);
  } else {
    const since = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
    const cursor = (await pool.query(`SELECT folio_entry_id,seeded_at FROM api_event_cursor WHERE owner_id=$1`, [owner])).rows[0];
    const bookings = (await pool.query(BOOKINGS_SQL, [owner, since, now - 30 * 86_400_000])).rows;
    const state = new Map((await pool.query(`SELECT booking_id,status,fingerprint FROM api_booking_state WHERE owner_id=$1`, [owner])).rows.map((r) => [Number(r.booking_id), r]));
    const seeding = !cursor?.seeded_at;
    let queued = 0;
    for (const b of bookings) {
      const cur = { status: String(b.status), fingerprint: bookingFingerprint(b) }, prev = state.get(Number(b.id));
      if (prev && prev.status === cur.status && prev.fingerprint === cur.fingerprint) continue;
      const event = seeding ? null : bookingEvent(prev ?? null, cur);
      if (event) queued += await queue(pool, owner, hooks, event, bookingData(b), now);
      await pool.query(`INSERT INTO api_booking_state(owner_id,booking_id,status,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,booking_id) DO UPDATE SET status=$3,fingerprint=$4`, [owner, b.id, cur.status, cur.fingerprint]);
    }
    if (seeding) {
      await pool.query(`INSERT INTO api_event_cursor(owner_id,folio_entry_id,seeded_at) VALUES($1,(SELECT COALESCE(max(id),0) FROM folio_entries WHERE owner_id=$1),$2) ON CONFLICT(owner_id) DO UPDATE SET folio_entry_id=EXCLUDED.folio_entry_id,seeded_at=$2`, [owner, now]);
    } else {
      const entries = (await pool.query(`SELECT f.id,f.entry_type,f.description,f.amount_cents,f.payer,f.payment_method,f.created_at,b.id booking_id,b.reference FROM folio_entries f JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id WHERE f.owner_id=$1 AND f.id>$2 ORDER BY f.id LIMIT 500`, [owner, cursor.folio_entry_id])).rows;
      for (const f of entries) {
        const event = folioEvent(String(f.entry_type));
        if (event) queued += await queue(pool, owner, hooks, event, { id: Number(f.id), booking: { id: Number(f.booking_id), reference: String(f.reference) }, type: String(f.entry_type), description: String(f.description), amount: eur(f.amount_cents), currency: "EUR", payer: String(f.payer), payment_method: f.payment_method ?? null, created_at: new Date(Number(f.created_at)).toISOString() }, now);
      }
      if (entries.length) await pool.query(`UPDATE api_event_cursor SET folio_entry_id=$2 WHERE owner_id=$1`, [owner, entries[entries.length - 1].id]);
    }
    if (queued) console.log(`API webhooks: ${queued} delivery(ies) queued`);
  }
  const due = (await pool.query(`SELECT d.id,d.webhook_id,d.event,d.payload_json,d.attempts,w.url,w.secret_encrypted FROM api_webhook_deliveries d JOIN api_webhooks w ON w.id=d.webhook_id AND w.owner_id=d.owner_id WHERE d.owner_id=$1 AND d.status='pending' AND d.next_at<=$2 AND w.active=1 ORDER BY d.id LIMIT 100`, [owner, now])).rows;
  for (const d of due) await sendDelivery(pool, d, unseal(String(d.secret_encrypted)));
  await pool.query(`DELETE FROM api_webhook_deliveries WHERE owner_id=$1 AND created_at<$2`, [owner, now - 30 * 86_400_000]);
}
