// v188 Operational Reliability Center in the PMS: live checks (so a stopped cron is seen too) and recovery.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { checkReliability, recoverReliability } from "../scripts/reliability-core.mjs";

export const reliabilityState = (ownerId: string) => checkReliability({ pool: db(), owner: ownerId });

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

export async function recover(ownerId: string, type: string, id: number | null): Promise<number> {
  if (type === "sync_now") return syncNow() ? 1 : 0;
  return recoverReliability({ pool: db(), owner: ownerId, type, id });
}

/** Light check for the menu badge: the problems that matter most, in one query. */
export async function reliabilityBadge(ownerId: string): Promise<number> {
  const r = await db().query(
    `SELECT (SELECT count(*) FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed','processing') AND created_at<$2::bigint-30*60000)
          + (SELECT count(*) FROM message_deliveries WHERE owner_id=$1 AND status='failed' AND updated_at>$2::bigint-86400000)
          + (SELECT count(*) FROM fiscal_documents WHERE owner_id=$1 AND status='failed')
          + (SELECT count(*) FROM automation_status WHERE owner_id=$1 AND (consecutive_failures>=3 OR (name='Guest messages' AND last_run_at<$2::bigint-10*60000))) AS n`,
    [ownerId, Date.now()],
  ).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows[0]?.n ?? 0);
}
