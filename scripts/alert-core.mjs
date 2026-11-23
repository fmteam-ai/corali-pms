// v189 reliable alert delivery. An alert is one row per problem (re-opened when the problem returns); it always shows
// in the PMS (notification + Reliability center) and is delivered to the front desk's phones (push) and, for critical
// ones, to the administrators by e-mail. Every delivery is an outbox row with retries and its own result, so «the
// alert was raised» and «someone received it» are two different, visible facts. A critical alert nobody acknowledged
// within 30 minutes is sent again (escalation) by e-mail and push.
import { failedStatus } from "./delivery-policy-core.mjs";
import { NOTIFY_POLICY, PRIORITIES, priorityRank } from "./alert-intel-core.mjs";

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
 * Raises (or updates) an alert — v202 Alert Intelligence rules:
 *  · new, or back after it was resolved → told (PMS notification + deliveries by priority); a return within 24 h is
 *    not e-mailed again (cooldown, see emailBlocked);
 *  · open and WORSE (higher priority) → told again as «Επιδείνωση», even within the cooldown;
 *  · open and same / better → title, details and priority updated silently (the page shows the current state).
 * priority: critical · high · medium · low (low = PMS only). severity (fail / warn) is kept for older callers:
 * fail → critical, warn → medium, unless a priority is given.
 * Returns { id, fresh, worsened, notified }.
 */
export async function raiseAlert({ pool, owner, key, area = "", severity = "fail", priority = null, title, titleEn = null, link = "/pms/reliability", now = Date.now(), emails = null, notify = true, details = null }) {
  const prio = PRIORITIES.includes(priority) ? priority : severity === "fail" ? "critical" : "medium";
  const sev = priorityRank(prio) >= priorityRank("high") ? "fail" : "warn";
  const d = JSON.stringify({ ...(details ?? {}), priority: prio });
  const tell = async (id, occurrence, purpose) => {
    const notified = notify && prio !== "low";
    if (notified) await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,$4,$5)`, [owner, `${purpose === "worsened" ? "⬆️ Επιδείνωση: " : "⚠️ "}${title}`.slice(0, 300), `⚠️ ${titleEn ?? title}`.slice(0, 300), link, now]);
    await queueDeliveries(pool, owner, id, occurrence, prio, purpose, now, emails);
    return notified;
  };
  const ins = await pool.query(
    `INSERT INTO alerts(owner_id,alert_key,area,severity,priority,details_json,title,link,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(owner_id,alert_key) DO NOTHING RETURNING id,occurrence`,
    [owner, key, area, sev, prio, d, String(title).slice(0, 300), link, now],
  );
  if (ins.rows.length) {
    const id = Number(ins.rows[0].id);
    return { id, fresh: true, worsened: false, notified: await tell(id, Number(ins.rows[0].occurrence), "alert") };
  }
  // Back after it was resolved.
  const back = await pool.query(
    `UPDATE alerts SET occurrence=occurrence+1,resolved_at=NULL,acknowledged_at=NULL,acknowledged_by=NULL,escalated_at=NULL,reminded_at=NULL,created_at=$3,title=$4,severity=$5,priority=$6,details_json=$7,area=$8
     WHERE owner_id=$1 AND alert_key=$2 AND resolved_at IS NOT NULL RETURNING id,occurrence`,
    [owner, key, now, String(title).slice(0, 300), sev, prio, d, area],
  );
  if (back.rows.length) {
    const id = Number(back.rows[0].id);
    return { id, fresh: true, worsened: false, notified: await tell(id, Number(back.rows[0].occurrence), "alert") };
  }
  // Open: worse → told again; otherwise a silent update.
  const cur = (await pool.query(`SELECT id,occurrence,priority FROM alerts WHERE owner_id=$1 AND alert_key=$2`, [owner, key])).rows[0];
  if (!cur) return { id: 0, fresh: false, worsened: false, notified: false };
  const id = Number(cur.id);
  if (priorityRank(prio) > priorityRank(cur.priority)) {
    const w = await pool.query(
      `UPDATE alerts SET occurrence=occurrence+1,priority=$3,severity=$4,details_json=$5,title=$6,acknowledged_at=NULL,acknowledged_by=NULL,escalated_at=NULL,reminded_at=NULL,created_at=$7
       WHERE id=$1 AND owner_id=$2 AND priority=$8 AND resolved_at IS NULL RETURNING occurrence`,
      [id, owner, prio, sev, d, String(title).slice(0, 300), now, cur.priority],
    );
    if (w.rows.length) return { id, fresh: false, worsened: true, notified: await tell(id, Number(w.rows[0].occurrence), "worsened") };
  }
  await pool.query(`UPDATE alerts SET title=$3,details_json=$4,priority=$5,severity=$6 WHERE id=$1 AND owner_id=$2`, [id, owner, String(title).slice(0, 300), d, priorityRank(prio) < priorityRank(cur.priority) ? prio : cur.priority, priorityRank(prio) < priorityRank(cur.priority) ? sev : (priorityRank(cur.priority) >= priorityRank("high") ? "fail" : "warn")]);
  return { id, fresh: false, worsened: false, notified: false };
}

// v202 Notification Control — e-mail limits (the PMS notification and the page are never limited):
//  · cooldown: an alert that comes back (resolved → raised again) within 24 h is not e-mailed again;
//  · reminders: the first after NOTIFY_POLICY[priority].escalateAfterMs, then at most one per 24 h;
//  · worsened: always told (a real change), within the hourly cap;
//  · recovery: one notice, only if the problem had actually been e-mailed / pushed (a flapping alert whose return
//    was not e-mailed does not send «recovered» either);
//  · cap: at most ALERT_EMAILS_PER_HOUR alert e-mails per recipient per hour; the rest are recorded as «skipped»
//    with the reason (visible in the Reliability center), never queued for later.
export const ALERT_EMAIL_COOLDOWN_MS = 24 * 60 * MIN;
export const ALERT_EMAILS_PER_HOUR = 6;
const COUNTED = `status NOT IN ('cancelled','skipped')`;

async function emailBlocked(pool, owner, id, occurrence, purpose, recipient, now) {
  const recent = (await pool.query(
    `SELECT occurrence,purpose FROM alert_outbox WHERE owner_id=$1 AND alert_id=$2 AND channel='email' AND recipient=$3 AND created_at>$4 AND ${COUNTED}`,
    [owner, id, recipient, now - ALERT_EMAIL_COOLDOWN_MS],
  )).rows;
  if (purpose === "alert" && recent.some((r) => Number(r.occurrence) !== Number(occurrence))) return "Ήδη ενημερώθηκε για το ίδιο πρόβλημα τις τελευταίες 24 ώρες";
  if ((purpose === "escalation" || purpose.startsWith("reminder")) && recent.some((r) => r.purpose === "escalation" || String(r.purpose).startsWith("reminder"))) return "Ήδη στάλθηκε υπενθύμιση τις τελευταίες 24 ώρες";
  const hour = Number((await pool.query(`SELECT count(*)::int AS n FROM alert_outbox WHERE owner_id=$1 AND channel='email' AND recipient=$2 AND created_at>$3 AND ${COUNTED}`, [owner, recipient, now - 60 * MIN])).rows[0]?.n ?? 0);
  if (hour >= ALERT_EMAILS_PER_HOUR) return `Όριο ${ALERT_EMAILS_PER_HOUR} email/ώρα — δείτε το Κέντρο αξιοπιστίας`;
  return null;
}

async function queueDeliveries(pool, owner, id, occurrence, priority, purpose, now, emails, only = null) {
  const policy = NOTIFY_POLICY[priority] ?? NOTIFY_POLICY.high;
  const rows = [];
  if (policy.push) rows.push(["push", "desk"]);
  if (policy.email) for (const e of emails ?? (await alertRecipients(pool, owner))) rows.push(["email", e]);
  for (const [channel, recipient] of rows) {
    if (only && !only.has(`${channel}|${recipient}`)) continue;
    const blocked = channel === "email" ? await emailBlocked(pool, owner, id, occurrence, purpose, recipient, now) : null;
    await pool.query(
      `INSERT INTO alert_outbox(owner_id,alert_id,occurrence,channel,recipient,purpose,status,last_error,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$8,$9,$7,$7)
       ON CONFLICT(owner_id,alert_id,occurrence,channel,recipient,purpose) DO NOTHING`,
      [owner, id, occurrence, channel, recipient, purpose, now, blocked ? "skipped" : "pending", blocked ?? ""],
    );
  }
}

export async function resolveAlerts({ pool, owner, activeKeys, prefix = "rel:", now = Date.now(), silentKeys = [] }) {
  const r = await pool.query(`UPDATE alerts SET resolved_at=$3 WHERE owner_id=$1 AND resolved_at IS NULL AND alert_key LIKE $4 AND NOT (alert_key = ANY($2::text[])) RETURNING id,alert_key,occurrence,priority,details_json`, [owner, activeKeys, now, `${prefix}%`]);
  if (!r.rows.length) return 0;
  // A resolved alert's pending deliveries of THIS occurrence are no longer needed (a pending «recovered» notice of an
  // earlier occurrence is still owed and stays).
  for (const a of r.rows) await pool.query(`UPDATE alert_outbox SET status='cancelled',updated_at=$4 WHERE owner_id=$1 AND alert_id=$2 AND occurrence=$3 AND status='pending' AND purpose<>'recovery'`, [owner, a.id, a.occurrence, now]);
  // v202: ONE recovery notice, only to whoever was actually told about this occurrence (sent). A return that was
  // not e-mailed (cooldown) does not send «recovered» either, so a flapping problem stays quiet.
  // Alerts from before v202 (no incident details — e.g. one per queued row) are closed silently.
  // … and so are alerts closed for a reason other than a fix (silentKeys, e.g. the connection was switched off).
  for (const a of r.rows.filter((x) => String(x.details_json ?? "{}") !== "{}" && !silentKeys.includes(String(x.alert_key)))) {
    const told = (await pool.query(`SELECT DISTINCT channel,recipient FROM alert_outbox WHERE owner_id=$1 AND alert_id=$2 AND occurrence=$3 AND status='sent' AND purpose<>'recovery'`, [owner, a.id, a.occurrence])).rows;
    if (told.length) await queueDeliveries(pool, owner, Number(a.id), Number(a.occurrence), a.priority || "high", "recovery", now, told.filter((t) => t.channel === "email").map((t) => String(t.recipient)), new Set(told.map((t) => `${t.channel}|${t.recipient}`)));
  }
  return r.rows.length;
}

export async function acknowledgeAlert({ pool, owner, id, by, now = Date.now() }) {
  const r = await pool.query(`UPDATE alerts SET acknowledged_at=$3,acknowledged_by=$4 WHERE owner_id=$1 AND id=$2 AND acknowledged_at IS NULL RETURNING id`, [owner, id, now, String(by).slice(0, 80)]);
  if (r.rows.length) await pool.query(`UPDATE alert_outbox SET status='cancelled',updated_at=$3 WHERE owner_id=$1 AND alert_id=$2 AND status='pending' AND (purpose='escalation' OR purpose LIKE 'reminder%')`, [owner, id, now]);
  return r.rows.length > 0;
}

/**
 * Unacknowledged, unresolved alerts: the first reminder after NOTIFY_POLICY[priority].escalateAfterMs (critical 30′,
 * high 4 h; medium / low never), then at most one reminder per 24 h while nobody acknowledges it.
 */
export async function escalateAlerts({ pool, owner, now = Date.now(), emails = null }) {
  const open = (await pool.query(`SELECT id,occurrence,priority,created_at,escalated_at,reminded_at FROM alerts WHERE owner_id=$1 AND acknowledged_at IS NULL AND resolved_at IS NULL AND priority IN ('critical','high')`, [owner])).rows;
  let n = 0;
  for (const a of open) {
    const p = NOTIFY_POLICY[a.priority];
    if (!p?.escalateAfterMs) continue;
    if (a.escalated_at == null) {
      if (Number(a.created_at) > now - p.escalateAfterMs) continue;
      const ok = await pool.query(`UPDATE alerts SET escalated_at=$2 WHERE id=$1 AND escalated_at IS NULL RETURNING id`, [a.id, now]);
      if (!ok.rows.length) continue;
      await queueDeliveries(pool, owner, Number(a.id), Number(a.occurrence), a.priority, "escalation", now, emails);
      n++;
    } else if (p.remindEveryMs && Number(a.reminded_at ?? a.escalated_at) <= now - p.remindEveryMs) {
      const ok = await pool.query(`UPDATE alerts SET reminded_at=$2 WHERE id=$1 AND COALESCE(reminded_at,escalated_at)<=$3 RETURNING id`, [a.id, now, now - p.remindEveryMs]);
      if (!ok.rows.length) continue;
      await queueDeliveries(pool, owner, Number(a.id), Number(a.occurrence), a.priority, `reminder:${new Date(now).toISOString().slice(0, 10)}`, now, emails);
      n++;
    }
  }
  return n;
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
    `SELECT o.*,a.title,a.link,a.severity,a.alert_key,a.priority,a.details_json FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id
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
