// v189 reliable alert delivery. An alert is one row per problem (re-opened when the problem returns); it always shows
// in the PMS (notification + Reliability center) and is delivered to the front desk's phones (push) and, for critical
// ones, to the administrators by e-mail. Every delivery is an outbox row with retries and its own result, so «the
// alert was raised» and «someone received it» are two different, visible facts. A critical alert nobody acknowledged
// within 30 minutes is sent again (escalation) by e-mail and push.
import { failedStatus } from "./delivery-policy-core.mjs";

const MIN = 60_000;
export const ALERT_BACKOFF_MIN = [1, 5, 15, 60, 180];
export const ALERT_MAX_ATTEMPTS = 6;
export const ESCALATE_AFTER_MS = 30 * MIN;

/** Next attempt after a failure (attempts = failures so far, ≥ 1). */
export function nextAlertAttempt(attempts, now) {
  return now + ALERT_BACKOFF_MIN[Math.min(attempts - 1, ALERT_BACKOFF_MIN.length - 1)] * MIN;
}

/** E-mail recipients of critical alerts: ALERT_EMAILS (comma separated) or the active owners / administrators. */
export async function alertRecipients(pool, owner, envList = process.env.ALERT_EMAILS ?? "") {
  const listed = envList.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (listed.length) return [...new Set(listed)];
  const r = await pool.query(`SELECT DISTINCT lower(email) email FROM pms_staff_users WHERE owner_id=$1 AND active=1 AND role IN ('owner','admin') AND email LIKE '%@%'`, [owner]);
  return r.rows.map((x) => String(x.email));
}

/**
 * Raises an alert. Returns { id, fresh }: fresh only when it is new or came back after it was resolved; only then the
 * PMS notification and the deliveries are created (so an ongoing problem is not told every 10 minutes).
 */
export async function raiseAlert({ pool, owner, key, area = "", severity = "fail", title, titleEn = null, link = "/pms/reliability", now = Date.now(), emails = null, notify = true }) {
  const r = await pool.query(
    `INSERT INTO alerts(owner_id,alert_key,area,severity,title,link,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(owner_id,alert_key) DO UPDATE SET occurrence=alerts.occurrence+1,resolved_at=NULL,acknowledged_at=NULL,acknowledged_by=NULL,escalated_at=NULL,created_at=EXCLUDED.created_at,title=EXCLUDED.title,severity=EXCLUDED.severity
     WHERE alerts.resolved_at IS NOT NULL RETURNING id,occurrence`,
    [owner, key, area, severity, String(title).slice(0, 300), link, now],
  );
  if (!r.rows.length) {
    const cur = await pool.query(`SELECT id FROM alerts WHERE owner_id=$1 AND alert_key=$2`, [owner, key]);
    return { id: Number(cur.rows[0]?.id ?? 0), fresh: false };
  }
  const id = Number(r.rows[0].id), occurrence = Number(r.rows[0].occurrence);
  if (notify) await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,$4,$5)`, [owner, `⚠️ ${title}`.slice(0, 300), `⚠️ ${titleEn ?? title}`.slice(0, 300), link, now]);
  await queueDeliveries(pool, owner, id, occurrence, severity, "alert", now, emails);
  return { id, fresh: true };
}

async function queueDeliveries(pool, owner, id, occurrence, severity, purpose, now, emails) {
  const rows = [["push", "desk"]];
  if (severity === "fail") for (const e of emails ?? (await alertRecipients(pool, owner))) rows.push(["email", e]);
  for (const [channel, recipient] of rows) {
    await pool.query(
      `INSERT INTO alert_outbox(owner_id,alert_id,occurrence,channel,recipient,purpose,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT(owner_id,alert_id,occurrence,channel,recipient,purpose) DO NOTHING`,
      [owner, id, occurrence, channel, recipient, purpose, now],
    );
  }
}

/** Problems no longer present are resolved (a later return re-opens them and is told again). */
export async function resolveAlerts({ pool, owner, activeKeys, prefix = "rel:", now = Date.now() }) {
  const r = await pool.query(`UPDATE alerts SET resolved_at=$3 WHERE owner_id=$1 AND resolved_at IS NULL AND alert_key LIKE $4 AND NOT (alert_key = ANY($2::text[])) RETURNING id`, [owner, activeKeys, now, `${prefix}%`]);
  // A resolved alert's pending deliveries are no longer needed.
  if (r.rows.length) await pool.query(`UPDATE alert_outbox SET status='cancelled',updated_at=$3 WHERE owner_id=$1 AND alert_id=ANY($2::bigint[]) AND status='pending'`, [owner, r.rows.map((x) => Number(x.id)), now]);
  return r.rows.length;
}

export async function acknowledgeAlert({ pool, owner, id, by, now = Date.now() }) {
  const r = await pool.query(`UPDATE alerts SET acknowledged_at=$3,acknowledged_by=$4 WHERE owner_id=$1 AND id=$2 AND acknowledged_at IS NULL RETURNING id`, [owner, id, now, String(by).slice(0, 80)]);
  if (r.rows.length) await pool.query(`UPDATE alert_outbox SET status='cancelled',updated_at=$3 WHERE owner_id=$1 AND alert_id=$2 AND status='pending' AND purpose='escalation'`, [owner, id, now]);
  return r.rows.length > 0;
}

/** Critical, unacknowledged, unresolved alerts older than 30 minutes: sent once more (escalation). */
export async function escalateAlerts({ pool, owner, now = Date.now(), emails = null }) {
  const due = (await pool.query(`UPDATE alerts SET escalated_at=$2 WHERE owner_id=$1 AND severity='fail' AND acknowledged_at IS NULL AND resolved_at IS NULL AND escalated_at IS NULL AND created_at<=$3 RETURNING id,occurrence`, [owner, now, now - ESCALATE_AFTER_MS])).rows;
  for (const a of due) await queueDeliveries(pool, owner, Number(a.id), Number(a.occurrence), "fail", "escalation", now, emails);
  return due.length;
}

/**
 * Delivers due outbox rows. send = { push(row) → number reached, email(row) → void }. Each row is claimed first
 * (pending → sending), so two runs never send the same alert twice; a row left «sending» by a crash goes back to
 * pending after 10 minutes. Push with no subscribed phone is «skipped» (nothing to deliver), not a failure.
 */
export async function deliverAlerts({ pool, owner, send, now = Date.now(), max = 30 }) {
  // v190: a delivery left «sending» by a crash: push is sent again (same tag, it replaces the first on the phone);
  // an e-mail may already be in the mailbox, so it becomes «uncertain» instead of a second copy.
  await pool.query(`UPDATE alert_outbox SET status=CASE WHEN channel='push' THEN 'pending' ELSE 'uncertain' END,last_error=CASE WHEN channel='push' THEN last_error ELSE 'Αποτέλεσμα άγνωστο (η αποστολή διακόπηκε)' END,updated_at=$2 WHERE owner_id=$1 AND status='sending' AND updated_at<$3`, [owner, now, now - 10 * MIN]);
  const due = (await pool.query(
    `SELECT o.*,a.title,a.link,a.severity,a.alert_key FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id
      WHERE o.owner_id=$1 AND o.status='pending' AND o.next_attempt_at<=$2 ORDER BY o.id LIMIT $3`,
    [owner, now, max],
  )).rows;
  const out = { sent: 0, failed: 0, skipped: 0, retry: 0 };
  for (const row of due) {
    const claimed = await pool.query(`UPDATE alert_outbox SET status='sending',updated_at=$2 WHERE id=$1 AND status='pending' RETURNING id`, [row.id, now]);
    if (!claimed.rows.length) continue;
    try {
      const fn = send[row.channel];
      if (!fn) throw Error(`NO_SENDER_${row.channel}`);
      const reached = await fn(row);
      if (row.channel === "push" && Number(reached) === 0) {
        await pool.query(`UPDATE alert_outbox SET status='skipped',attempts=attempts+1,last_error='Κανένα κινητό με ειδοποιήσεις',updated_at=$2 WHERE id=$1`, [row.id, now]);
        out.skipped++;
      } else {
        await pool.query(`UPDATE alert_outbox SET status='sent',attempts=attempts+1,last_error='',sent_at=$2,updated_at=$2 WHERE id=$1`, [row.id, now]);
        out.sent++;
      }
    } catch (e) {
      const attempts = Number(row.attempts) + 1, final = attempts >= ALERT_MAX_ATTEMPTS;
      // v190: an e-mail that may have gone (timeout after the server took it) is not sent a second time.
      if (failedStatus(e, row.channel) === "uncertain") {
        await pool.query(`UPDATE alert_outbox SET status='uncertain',attempts=$2,last_error=$3,updated_at=$4 WHERE id=$1`, [row.id, attempts, `Αβέβαιο: ${String(e instanceof Error ? e.message : e)}`.slice(0, 300), now]);
        out.uncertain = (out.uncertain ?? 0) + 1;
        continue;
      }
      await pool.query(`UPDATE alert_outbox SET status=$2,attempts=$3,last_error=$4,next_attempt_at=$5,updated_at=$6 WHERE id=$1`, [row.id, final ? "failed" : "pending", attempts, String(e instanceof Error ? e.message : e).slice(0, 300), final ? 0 : nextAlertAttempt(attempts, now), now]);
      if (final) out.failed++; else out.retry++;
    }
  }
  return out;
}

/** Delivery problems for the Reliability center: failed deliveries, and pending ones retried for over 30 minutes. */
export async function alertDeliveryIssues(pool, owner, now = Date.now()) {
  return (await pool.query(
    `SELECT o.id,o.channel,o.recipient,o.status,o.attempts,o.last_error,o.created_at,a.title FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id
      WHERE o.owner_id=$1 AND a.resolved_at IS NULL AND (o.status IN ('failed','uncertain') OR (o.status='pending' AND o.attempts>0 AND o.created_at<$2)) ORDER BY o.id DESC LIMIT 20`,
    [owner, now - 30 * MIN],
  )).rows;
}
