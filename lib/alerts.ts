// v189 alerts in the PMS: delivery (Web Push from here, e-mail), acknowledgement, and the cron watchdog — the part of
// the dead-man switch that runs without the cron: PMS page loads and the room TVs' regular polls look at the cron's
// heartbeat (at most every 5 minutes per process) and raise the alert themselves when the cron stopped or hung.
import { db } from "@/lib/db";
import { sendStaffPush } from "@/lib/staff-push";
import { sendEmail } from "@/lib/notifications/email";
import { acknowledgeAlert, deliverAlerts, raiseAlert } from "../scripts/alert-core.mjs";
import { heartbeatState } from "../scripts/job-control-core.mjs";

type OutboxRow = { title: string; link: string; purpose: string; alert_id: number; recipient: string };

export const alertSenders = (ownerId: string) => ({
  push: (row: OutboxRow) => sendStaffPush(ownerId, { desk: true }, { kind: "reliability", title: { el: String(row.title).slice(0, 120), en: "Corali PMS alert" }, body: { el: row.purpose === "escalation" ? "Υπενθύμιση: δεν έχει επιβεβαιωθεί" : "Κέντρο αξιοπιστίας", en: row.purpose === "escalation" ? "Reminder: not acknowledged" : "Reliability center" }, url: row.link || "/pms/reliability", tag: `alert-${row.alert_id}` }),
  email: async (row: OutboxRow) => {
    const origin = (process.env.PMS_ORIGIN ?? "").replace(/\/$/, "");
    await sendEmail(row.recipient, `${row.purpose === "escalation" ? "[Υπενθύμιση] " : ""}[Corali PMS] ${String(row.title).slice(0, 150)}`, `${row.title}\n\n${origin}${row.link || "/pms/reliability"}\n\nΕπιβεβαιώστε στο PMS → Αξιοπιστία ότι το είδατε.`);
  },
});

const lastCheck = new Map<string, number>();

/** Throttled: never more than one check per 5 minutes per process; never throws. */
export async function cronWatchdog(ownerId: string, now = Date.now()): Promise<void> {
  if (now - (lastCheck.get(ownerId) ?? 0) < 5 * 60_000) return;
  lastCheck.set(ownerId, now);
  try {
    const row = (await db().query(`SELECT * FROM cron_heartbeat WHERE owner_id=$1 AND job='automations'`, [ownerId])).rows[0];
    if (!row) return; // never ran (new installation): shown in the Reliability center, not alerted
    const h = heartbeatState(row, now);
    if (h.status === "stopped" || h.status === "hung") {
      await raiseAlert({
        pool: db(), owner: ownerId, key: "watchdog:cron", area: "automations", severity: "fail", now,
        title: h.status === "stopped" ? "Το cron έχει σταματήσει — κανένας αυτοματισμός δεν εκτελείται (μηνύματα, συγχρονισμός OTA, συσκευές). Ελέγξτε το Cron Jobs στο cPanel." : "Το cron κόλλησε: μια εκτέλεση δεν τελειώνει. Ελέγξτε το cPanel.",
        titleEn: h.status === "stopped" ? "The cron has stopped — no automation is running. Check cPanel Cron Jobs." : "The cron is stuck. Check cPanel.",
      });
      await db().query(`UPDATE cron_heartbeat SET watchdog_alerted_at=$3 WHERE owner_id=$1 AND job=$2`, [ownerId, "automations", now]);
      // The cron cannot deliver while it is down: this process does.
      await deliverAlerts({ pool: db(), owner: ownerId, send: alertSenders(ownerId), now });
    } else {
      await db().query(`UPDATE alerts SET resolved_at=$2 WHERE owner_id=$1 AND alert_key='watchdog:cron' AND resolved_at IS NULL`, [ownerId, now]);
    }
  } catch (e) {
    console.error("Cron watchdog failed", e instanceof Error ? e.message : e);
  }
}

export const acknowledge = (ownerId: string, id: number, by: string) => acknowledgeAlert({ pool: db(), owner: ownerId, id, by });

/** Recent alerts with the result of each delivery. */
export async function recentAlerts(ownerId: string) {
  const alerts = (await db().query(`SELECT id,alert_key,area,severity,title,link,occurrence,created_at,acknowledged_at,acknowledged_by,escalated_at,resolved_at FROM alerts WHERE owner_id=$1 ORDER BY (resolved_at IS NULL) DESC, created_at DESC LIMIT 30`, [ownerId])).rows;
  const ids = alerts.map((a) => Number(a.id));
  const deliveries = ids.length ? (await db().query(`SELECT alert_id,occurrence,channel,recipient,purpose,status,attempts,last_error,sent_at FROM alert_outbox WHERE owner_id=$1 AND alert_id=ANY($2::bigint[]) ORDER BY id`, [ownerId, ids])).rows : [];
  return alerts.map((a) => ({
    id: Number(a.id), area: String(a.area), severity: String(a.severity), title: String(a.title), link: String(a.link), createdAt: Number(a.created_at),
    acknowledgedAt: a.acknowledged_at ? Number(a.acknowledged_at) : null, acknowledgedBy: a.acknowledged_by ? String(a.acknowledged_by) : null,
    escalatedAt: a.escalated_at ? Number(a.escalated_at) : null, resolvedAt: a.resolved_at ? Number(a.resolved_at) : null,
    deliveries: deliveries.filter((d) => Number(d.alert_id) === Number(a.id) && Number(d.occurrence) === Number(a.occurrence)).map((d) => ({ channel: String(d.channel), recipient: String(d.recipient), purpose: String(d.purpose), status: String(d.status), attempts: Number(d.attempts), error: String(d.last_error ?? ""), sentAt: d.sent_at ? Number(d.sent_at) : null })),
  }));
}
