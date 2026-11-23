// v188 Operational Reliability Center in the PMS: live checks (so a stopped cron is seen too) and recovery.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { checkReliability, recoverReliability } from "../scripts/reliability-core.mjs";
import { withLease } from "../scripts/job-control-core.mjs";
import { saveReconciliation, stripeReconcile } from "../scripts/stripe-reconcile-core.mjs";
import { reconcile } from "../scripts/reconcile-core.mjs";
import { stripeCredentials } from "@/lib/provider-connections";
import { cronWatchdog, recentAlerts } from "@/lib/alerts";

export const RUNNING_VERSION = "v192";

export async function reliabilityState(ownerId: string) {
  void cronWatchdog(ownerId);
  const [state, alerts] = await Promise.all([checkReliability({ pool: db(), owner: ownerId, version: RUNNING_VERSION }), recentAlerts(ownerId).catch(() => [])]);
  return { ...state, version: RUNNING_VERSION, alerts };
}

/** «Έλεγχος τώρα» of payments: the folio and Stripe itself, last 3 days (the cron does it daily at 04:12). */
async function reconcileNow(ownerId: string): Promise<number> {
  const toMs = Date.now(), fromMs = toMs - 3 * 86_400_000;
  const f = await reconcile({ pool: db(), owner: ownerId, fromMs, toMs });
  await saveReconciliation(db(), ownerId, "folio", { fromMs, toMs, issues: f.issues.map((i: object) => ({ ...i, level: "fail" })), totals: f.totals });
  const stripe = await stripeCredentials(ownerId).catch(() => null);
  if (!stripe?.secretKey) return 1;
  try {
    const r = await stripeReconcile({ pool: db(), owner: ownerId, secretKey: stripe.secretKey, fromMs, toMs });
    await saveReconciliation(db(), ownerId, "stripe", { fromMs, toMs, issues: r.issues, totals: r.totals });
  } catch (e) {
    await saveReconciliation(db(), ownerId, "stripe", { fromMs, toMs, error: e instanceof Error ? e.message : String(e) });
  }
  return 2;
}

let lastSync = 0;
/** «Συγχρονισμός τώρα»: the channel sync runs at once (its own lock prevents two runs; at most every 10 s). */
function syncNow(): boolean {
  if (Date.now() - lastSync < 10_000) return false;
  const script = path.join(process.cwd(), "scripts", "run-channel-sync.mjs");
  if (!existsSync(script)) return false;
  lastSync = Date.now();
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), env: process.env, stdio: "ignore", detached: true });
  child.on("error", (e) => console.error("Channel sync from the reliability center failed to start", e));
  child.unref();
  return true;
}

/**
 * v189 safe retry: one recovery of the same task at a time (a double click, two people, or two PMS processes do it
 * once; the second gets 0), and the queue only takes back work that is failed or demonstrably stuck.
 */
export async function recover(ownerId: string, type: string, id: number | null): Promise<number> {
  const r = await withLease(db(), ownerId, `recover:${type}:${id ?? "all"}`, 60_000, async () => {
    if (type === "sync_now") return syncNow() ? 1 : 0;
    if (type === "reconcile_now") return reconcileNow(ownerId);
    return recoverReliability({ pool: db(), owner: ownerId, type, id });
  });
  return r.ran ? Number(r.value) : 0;
}

/** Light check for the menu badge: the problems that matter most, in one query. */
export async function reliabilityBadge(ownerId: string): Promise<number> {
  void cronWatchdog(ownerId);
  const r = await db().query(
    `SELECT (SELECT count(*) FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed','processing') AND created_at<$2::bigint-30*60000)
          + (SELECT count(*) FROM message_deliveries WHERE owner_id=$1 AND status='failed' AND updated_at>$2::bigint-86400000)
          + (SELECT count(*) FROM fiscal_documents WHERE owner_id=$1 AND status='failed')
          + (SELECT count(*) FROM automation_status WHERE owner_id=$1 AND (consecutive_failures>=3 OR (name='Guest messages' AND last_run_at<$2::bigint-10*60000)))
          + (SELECT count(*) FROM alerts WHERE owner_id=$1 AND severity='fail' AND acknowledged_at IS NULL AND resolved_at IS NULL AND alert_key NOT LIKE 'rel:step:%') AS n`,
    [ownerId, Date.now()],
  ).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows[0]?.n ?? 0);
}
