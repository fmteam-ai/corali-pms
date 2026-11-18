// Corali TV — guest app data clearing at check-out (v161). Server side of the bridge used by the hotel's on-prem
// gateway (tools/tv-privacy-gateway). Ported from the "Unified Staging" kit (pms/lib/tv-privacy-server.mjs) onto the
// PMS's own database pool, env and permissions; rooms are enabled per TV in PMS → Corali TV (tv_screens.privacy_clear)
// instead of an env list. The gateway authenticates with TV_PRIVACY_BRIDGE_TOKEN (runtime.env, never in the browser).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AGENT_LEASE_MS, AGENT_MIN_VERSION, agentOutcome, agentRetryDelayMs, APPROVED_PACKAGES, classifyResults, isRemovableGuestPackage, LEASE_MS, MAX_ATTEMPTS, normalizeAppResult, normalizeUninstallResult, STAFF_RECHECK_MS } from "../scripts/tv-privacy-core.mjs";

type Job = Record<string, unknown> & { id: string | number; owner_id: string; booking_id: string | number; room_id: string | number; tv_screen_id: string | number; checkout_at_ms: string | number };

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const positive = (x: unknown) => (Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null);

/** The bridge is on only in the PMS role with a strong token (≥ 32 characters). */
export function bridgeConfig(): { token: string; owner: string } | null {
  const token = process.env.TV_PRIVACY_BRIDGE_TOKEN ?? "";
  if (process.env.APP_ROLE === "booking" || token.length < 32) return null;
  return { token, owner: env().PMS_OWNER_ID };
}

/** Constant-time bearer check. */
export function authorizeToken(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice(7);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

async function allowedRooms(client: PoolClient, owner: string): Promise<number[]> {
  // v162: rooms whose TV clears itself (Corali TV 1.13, «tv_agent») are not the gateway's.
  return (await client.query(`SELECT room_id FROM tv_screens WHERE owner_id=$1 AND active=1 AND privacy_clear=1 AND privacy_executor='gateway'`, [owner])).rows.map((r) => Number(r.room_id));
}

/** Another guest in the room since this check-out: no more clearing for the old job (late checkout / new check-in). */
async function newGuestInRoom(client: PoolClient, j: Job) {
  const rows = (await client.query(
    `SELECT id FROM bookings WHERE owner_id=$1 AND room_id=$2 AND (status='checked_in' OR COALESCE(checked_in_at,0)>$3)`,
    [j.owner_id, j.room_id, j.checkout_at_ms],
  )).rows;
  return rows.some((r) => Number(r.id) !== Number(j.booking_id));
}

/** The TV is still the room's active, enabled screen and the booking is still checked out. */
async function stillRegistered(client: PoolClient, j: Job) {
  const tv = (await client.query(`SELECT 1 FROM tv_screens WHERE id=$1 AND owner_id=$2 AND room_id=$3 AND active=1 AND privacy_clear=1`, [j.tv_screen_id, j.owner_id, j.room_id])).rowCount;
  const b = (await client.query(`SELECT status FROM bookings WHERE id=$1 AND owner_id=$2 AND room_id=$3`, [j.booking_id, j.owner_id, j.room_id])).rows[0];
  return Boolean(tv) && b?.status === "checked_out";
}

async function block(client: PoolClient, j: Job, code: "NEW_GUEST" | "TV_OR_CHECKOUT_NOT_VALID") {
  await client.query(
    `UPDATE tv_privacy_jobs SET status=$3,error_code=$4,claim_hash=NULL,lease_until_ms=NULL,finished_at_ms=$5 WHERE owner_id=$1 AND id=$2`,
    [j.owner_id, j.id, code === "NEW_GUEST" ? "BLOCKED_NEW_GUEST" : "BLOCKED_UNREGISTERED", code, Date.now()],
  );
}

async function claim(client: PoolClient, owner: string) {
  await client.query("BEGIN");
  try {
    const now = Date.now();
    await client.query(
      `UPDATE tv_privacy_jobs SET status='UNVERIFIED',error_code='LEASE_EXHAUSTED',finished_at_ms=$2,claim_hash=NULL,lease_until_ms=NULL
        WHERE owner_id=$1 AND status='RUNNING' AND lease_until_ms<$2 AND attempt_count>=$3`,
      [owner, now, MAX_ATTEMPTS],
    );
    const rooms = await allowedRooms(client, owner);
    const j = (await client.query(
      `SELECT * FROM tv_privacy_jobs WHERE owner_id=$1 AND room_id=ANY($2::bigint[]) AND executor='gateway'
         AND (status='QUEUED' OR (status='RUNNING' AND lease_until_ms<$3 AND attempt_count<$4))
       ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
      [owner, rooms, now, MAX_ATTEMPTS],
    )).rows[0] as Job | undefined;
    if (!j) { await client.query("COMMIT"); return { job: null }; }
    if (await newGuestInRoom(client, j)) { await block(client, j, "NEW_GUEST"); await client.query("COMMIT"); return { job: null }; }
    if (!(await stillRegistered(client, j))) { await block(client, j, "TV_OR_CHECKOUT_NOT_VALID"); await client.query("COMMIT"); return { job: null }; }
    const leaseToken = randomBytes(32).toString("hex");
    await client.query(
      `UPDATE tv_privacy_jobs SET status='RUNNING',attempt_count=attempt_count+1,claim_hash=$3,lease_until_ms=$4,started_at_ms=COALESCE(started_at_ms,$5) WHERE owner_id=$1 AND id=$2`,
      [owner, j.id, sha(leaseToken), now + LEASE_MS, now],
    );
    await client.query("COMMIT");
    return { job: { id: Number(j.id), roomId: Number(j.room_id), screenId: Number(j.tv_screen_id), bookingId: Number(j.booking_id), packages: [...APPROVED_PACKAGES], leaseToken } };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}

type LeaseData = { jobId?: unknown; leaseToken?: unknown; results?: unknown; dryRun?: unknown; securityBlocked?: unknown; addedPackages?: unknown; taskId?: unknown; status?: unknown; code?: unknown };

async function withLease(client: PoolClient, op: "authorize" | "report", owner: string, data: LeaseData) {
  const jobId = positive(data.jobId);
  if (!jobId || typeof data.leaseToken !== "string" || !/^[0-9a-f]{64}$/.test(data.leaseToken)) return { allowed: false, error: "INVALID_LEASE" };
  await client.query("BEGIN");
  try {
    const rooms = await allowedRooms(client, owner);
    const j = (await client.query(`SELECT * FROM tv_privacy_jobs WHERE owner_id=$1 AND id=$2 AND room_id=ANY($3::bigint[]) AND executor='gateway' FOR UPDATE`, [owner, jobId, rooms])).rows[0] as Job | undefined;
    if (!j || j.status !== "RUNNING" || j.claim_hash !== sha(data.leaseToken) || Number(j.lease_until_ms) <= Date.now()) { await client.query("COMMIT"); return { allowed: false, error: "NO_VALID_LEASE" }; }
    if (await newGuestInRoom(client, j)) { await block(client, j, "NEW_GUEST"); await client.query("COMMIT"); return { allowed: false, error: "NEW_GUEST" }; }
    if (!(await stillRegistered(client, j))) { await block(client, j, "TV_OR_CHECKOUT_NOT_VALID"); await client.query("COMMIT"); return { allowed: false, error: "UNREGISTERED" }; }
    if (op === "authorize") { await client.query("COMMIT"); return { allowed: true }; }
    const given = Array.isArray(data.results) && data.results.length <= APPROVED_PACKAGES.length ? data.results : [];
    const safe = given.map(normalizeAppResult);
    let status = data.securityBlocked === true ? "BLOCKED_SECURITY" : classifyResults(safe, data.dryRun === true);
    // An ADB "Success" is never proof of an OS account removal or a complete sign-out.
    if (status === "CLEARED_LOCAL_NEEDS_REVIEW" && safe.every((r) => r.status === "NOT_INSTALLED")) status = "UNVERIFIED";
    // Guest-installed apps reported by the gateway: only plain, non-protected package ids are kept (max 30).
    const added = Array.isArray(data.addedPackages) ? [...new Set(data.addedPackages.filter((p) => isRemovableGuestPackage(p)))].slice(0, 30) : [];
    await client.query(
      `UPDATE tv_privacy_jobs SET status=$3,package_results=$4::jsonb,error_code=$5,claim_hash=NULL,lease_until_ms=NULL,finished_at_ms=$6,added_packages=$7::jsonb WHERE owner_id=$1 AND id=$2`,
      [owner, j.id, status, JSON.stringify(safe), status === "CLEARED_LOCAL_NEEDS_REVIEW" ? "ACCOUNT_REVIEW_REQUIRED" : status, Date.now(), JSON.stringify(added)],
    );
    await client.query("COMMIT");
    return { status };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}

/** Next admin-approved removal of a guest-installed app (one at a time), after the same safety checks as clearing. */
async function claimUninstall(client: PoolClient, owner: string) {
  await client.query("BEGIN");
  try {
    const now = Date.now();
    await client.query(`UPDATE tv_privacy_uninstalls SET status='FAILED',error_code='LEASE_EXHAUSTED',finished_at_ms=$2,claim_hash=NULL,lease_until_ms=NULL WHERE owner_id=$1 AND status='RUNNING' AND lease_until_ms<$2 AND attempt_count>=$3`, [owner, now, MAX_ATTEMPTS]);
    const rooms = await allowedRooms(client, owner);
    const t = (await client.query(
      `SELECT u.*,j.booking_id,j.checkout_at_ms,j.tv_screen_id FROM tv_privacy_uninstalls u JOIN tv_privacy_jobs j ON j.id=u.job_id AND j.owner_id=u.owner_id
        WHERE u.owner_id=$1 AND u.room_id=ANY($2::bigint[]) AND j.executor='gateway' AND (u.status='APPROVED' OR (u.status='RUNNING' AND u.lease_until_ms<$3 AND u.attempt_count<$4))
        ORDER BY u.id ASC FOR UPDATE OF u SKIP LOCKED LIMIT 1`,
      [owner, rooms, now, MAX_ATTEMPTS],
    )).rows[0];
    if (!t) { await client.query("COMMIT"); return { task: null }; }
    const asJob = { ...t, id: t.job_id, owner_id: owner } as Job;
    const finish = async (status: string, code: string) => client.query(`UPDATE tv_privacy_uninstalls SET status=$3,error_code=$4,finished_at_ms=$5,claim_hash=NULL,lease_until_ms=NULL WHERE owner_id=$1 AND id=$2`, [owner, t.id, status, code, now]);
    if (!isRemovableGuestPackage(t.package)) { await finish("BLOCKED_PROTECTED", "PROTECTED_PACKAGE"); await client.query("COMMIT"); return { task: null }; }
    if (await newGuestInRoom(client, asJob)) { await finish("BLOCKED_NEW_GUEST", "NEW_GUEST"); await client.query("COMMIT"); return { task: null }; }
    if (!(await stillRegistered(client, asJob))) { await finish("FAILED", "TV_OR_CHECKOUT_NOT_VALID"); await client.query("COMMIT"); return { task: null }; }
    const leaseToken = randomBytes(32).toString("hex");
    await client.query(`UPDATE tv_privacy_uninstalls SET status='RUNNING',attempt_count=attempt_count+1,claim_hash=$3,lease_until_ms=$4 WHERE owner_id=$1 AND id=$2`, [owner, t.id, sha(leaseToken), now + LEASE_MS]);
    await client.query("COMMIT");
    return { task: { id: Number(t.id), roomId: Number(t.room_id), package: String(t.package), leaseToken } };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}

async function reportUninstall(client: PoolClient, owner: string, data: LeaseData) {
  const id = positive(data.taskId);
  if (!id || typeof data.leaseToken !== "string" || !/^[0-9a-f]{64}$/.test(data.leaseToken)) return { ok: false, error: "INVALID_LEASE" };
  const r = normalizeUninstallResult({ status: data.status, code: data.code });
  const u = await client.query(
    `UPDATE tv_privacy_uninstalls SET status=$4,error_code=$5,finished_at_ms=$6,claim_hash=NULL,lease_until_ms=NULL
      WHERE owner_id=$1 AND id=$2 AND status='RUNNING' AND claim_hash=$3 AND lease_until_ms>$6`,
    [owner, id, sha(data.leaseToken), r.status, r.code, Date.now()],
  );
  return u.rowCount ? { ok: true, status: r.status } : { ok: false, error: "NO_VALID_LEASE" };
}

// ---- v162: the TV clears itself (Corali TV ≥ 1.13 through its own ADB). Authenticated by the screen's token, which
// only ever reaches the job of its own room.

export type AgentPrivacyTask = { id: number; leaseToken: string; packages: string[]; uninstall: { id: number; package: string }[] };

/** Called from the TV's 20-second check: the room's pending clearing (once per lease), or null. */
export async function agentPrivacyClaim(ownerId: string, roomId: number, version: number | null): Promise<AgentPrivacyTask | null> {
  if (version === null || version < AGENT_MIN_VERSION) return null;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const now = Date.now();
    const j = (await client.query(
      `SELECT j.* FROM tv_privacy_jobs j JOIN tv_screens s ON s.id=j.tv_screen_id AND s.owner_id=j.owner_id
        WHERE j.owner_id=$1 AND j.room_id=$2 AND j.executor='tv_agent' AND s.active=1 AND s.privacy_clear=1 AND s.privacy_executor='tv_agent'
          AND (j.status='QUEUED' OR (j.status IN ('RETRY_PENDING','NEEDS_STAFF') AND COALESCE(j.next_retry_ms,0)<=$3) OR (j.status='RUNNING' AND j.lease_until_ms<$3))
        ORDER BY j.id ASC FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
      [ownerId, roomId, now],
    )).rows[0] as Job | undefined;
    if (!j) { await client.query("COMMIT"); return null; }
    if (await newGuestInRoom(client, j)) { await block(client, j, "NEW_GUEST"); await client.query("COMMIT"); return null; }
    if (!(await stillRegistered(client, j))) { await block(client, j, "TV_OR_CHECKOUT_NOT_VALID"); await client.query("COMMIT"); return null; }
    const leaseToken = randomBytes(32).toString("hex");
    await client.query(
      `UPDATE tv_privacy_jobs SET status='RUNNING',attempt_count=attempt_count+1,claim_hash=$3,lease_until_ms=$4,started_at_ms=COALESCE(started_at_ms,$5) WHERE owner_id=$1 AND id=$2`,
      [ownerId, j.id, sha(leaseToken), now + AGENT_LEASE_MS, now],
    );
    // Guest-installed apps an admin approved for removal (one by one in the PMS), carried out in the same run.
    const un = (await client.query(
      `UPDATE tv_privacy_uninstalls SET status='RUNNING',attempt_count=attempt_count+1 WHERE owner_id=$1 AND job_id=$2 AND status IN ('APPROVED','RUNNING') RETURNING id,package`,
      [ownerId, j.id],
    )).rows.filter((u) => isRemovableGuestPackage(u.package)).map((u) => ({ id: Number(u.id), package: String(u.package) }));
    await client.query("COMMIT");
    return { id: Number(j.id), leaseToken, packages: [...APPROVED_PACKAGES], uninstall: un };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** POST /api/public/tv/<token>/privacy: the TV's evidence for one run. Returns the job's new status. */
export async function agentPrivacyReport(ownerId: string, roomId: number, data: Record<string, unknown>): Promise<{ ok: boolean; status?: string; error?: string }> {
  const jobId = positive(data.jobId);
  if (!jobId || typeof data.leaseToken !== "string" || !/^[0-9a-f]{64}$/.test(data.leaseToken)) return { ok: false, error: "INVALID_LEASE" };
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const now = Date.now();
    const j = (await client.query(`SELECT * FROM tv_privacy_jobs WHERE owner_id=$1 AND id=$2 AND room_id=$3 AND executor='tv_agent' FOR UPDATE`, [ownerId, jobId, roomId])).rows[0] as Job | undefined;
    if (!j || j.status !== "RUNNING" || j.claim_hash !== sha(data.leaseToken) || Number(j.lease_until_ms) <= now) { await client.query("COMMIT"); return { ok: false, error: "NO_VALID_LEASE" }; }
    if (await newGuestInRoom(client, j)) { await block(client, j, "NEW_GUEST"); await client.query("COMMIT"); return { ok: true, status: "BLOCKED_NEW_GUEST" }; }
    const out = agentOutcome(data);
    const attempts = Number(j.attempt_count) || 1;
    const next = out.status === "RETRY_PENDING" ? now + agentRetryDelayMs(attempts) : out.status === "NEEDS_STAFF" ? now + STAFF_RECHECK_MS : null;
    await client.query(
      `UPDATE tv_privacy_jobs SET status=$3::text,error_code=$4,checks=$5::jsonb,package_results=CASE WHEN $10::boolean THEN $6::jsonb ELSE package_results END,added_packages=CASE WHEN $10::boolean THEN $7::jsonb ELSE added_packages END,next_retry_ms=$8::bigint,
              ready_at_ms=CASE WHEN $3::text='READY' THEN $9::bigint ELSE NULL END,finished_at_ms=$9::bigint,claim_hash=NULL,lease_until_ms=NULL WHERE owner_id=$1 AND id=$2`,
      [ownerId, j.id, out.status, out.code, JSON.stringify({ ...out.checks, pending: out.pending }),
       JSON.stringify(out.checks.apps.filter((a) => a.status !== "MISSING").map((a) => ({ package: a.package, status: a.status, code: "" }))),
       JSON.stringify(out.checks.guestApps.map((g) => g.package)), next, now, out.checks.adb === "PASS"],
    );
    // (Without ADB the TV learnt nothing: the last known app results and guest apps stay.)
    // Results of the approved removals in this run (only ids of this job; anything unreported is retried next run).
    const un = Array.isArray(data.uninstall) ? data.uninstall.slice(0, 30) : [];
    for (const u of un as { id?: unknown; status?: unknown; code?: unknown }[]) {
      const id = positive(u?.id);
      if (!id) continue;
      const r = normalizeUninstallResult({ status: u.status, code: u.code });
      await client.query(`UPDATE tv_privacy_uninstalls SET status=$4,error_code=$5,finished_at_ms=$6 WHERE owner_id=$1 AND job_id=$2 AND id=$3 AND status='RUNNING'`, [ownerId, j.id, id, r.status, r.code, now]);
    }
    await client.query(`UPDATE tv_privacy_uninstalls SET status='APPROVED' WHERE owner_id=$1 AND job_id=$2 AND status='RUNNING'`, [ownerId, j.id]);
    await client.query("COMMIT");
    return { ok: true, status: out.status };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** The TV saved its guest-free reference state (apps, accounts, profiles, Bluetooth) on its set-up screen. */
export async function agentBaselineSeen(ownerId: string, roomId: number, at: number) {
  await db().query(`UPDATE tv_screens SET privacy_baseline_at=$3 WHERE owner_id=$1 AND room_id=$2 AND COALESCE(privacy_baseline_at,0)<>$3`, [ownerId, roomId, at]);
}

const noStore = { "Cache-Control": "no-store" };

/** POST /api/gateway/tv-privacy — {op: claim | authorize | report}, bearer token only. */
export async function handleBridgeRequest(req: Request): Promise<Response> {
  const config = bridgeConfig();
  if (!config) return Response.json({ error: "NOT_AVAILABLE" }, { status: 503, headers: noStore });
  if (!authorizeToken(req.headers.get("authorization"), config.token)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  if (Number(req.headers.get("content-length") || 0) > 8192) return Response.json({ error: "TOO_LARGE" }, { status: 413, headers: noStore });
  const data = (await req.json().catch(() => null)) as (LeaseData & { op?: unknown }) | null;
  if (!data || !["claim", "authorize", "report", "claim_uninstall", "report_uninstall"].includes(String(data.op))) return Response.json({ error: "BAD_REQUEST" }, { status: 400, headers: noStore });
  const client = await db().connect();
  try {
    // The gateway's last contact, shown in the PMS (never its token or the TV's details).
    await client.query(
      `INSERT INTO tv_privacy_gateway(owner_id,last_seen_at,dry_run) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET last_seen_at=$2,dry_run=COALESCE($3,tv_privacy_gateway.dry_run)`,
      [config.owner, Date.now(), typeof data.dryRun === "boolean" ? (data.dryRun ? 1 : 0) : null],
    );
    const answer = data.op === "claim" ? await claim(client, config.owner)
      : data.op === "claim_uninstall" ? await claimUninstall(client, config.owner)
      : data.op === "report_uninstall" ? await reportUninstall(client, config.owner, data)
      : await withLease(client, data.op as "authorize" | "report", config.owner, data);
    return Response.json(answer, { headers: noStore });
  } catch (e) {
    console.error("TV_PRIVACY_BRIDGE", String((e as Error)?.message ?? e).slice(0, 120));
    return Response.json({ error: "BRIDGE_FAILED" }, { status: 500, headers: noStore });
  } finally {
    client.release();
  }
}

export type Uninstall = { id: number; job_id: number; package: string; status: string; error_code: string; approved_at_ms: number; finished_at_ms: number | null };
export type PrivacyJob = { added_packages: string[]; uninstalls: Uninstall[]; id: number; room_id: number; room_code: string; booking_id: number; booking_ref: string; checkout_at_ms: number; status: string; attempt_count: number; error_code: string; package_results: { package: string; status: string; code: string }[]; created_at_ms: number; finished_at_ms: number | null; staff_checked_at_ms: number | null; staff_checked_by: string | null; executor: string; checks: Record<string, unknown>; next_retry_ms: number | null; ready_at_ms: number | null };

/** PMS → Corali TV: recent jobs, enabled rooms and the gateway's last contact. No guest data beyond the booking ref. */
export async function privacyOverview(ownerId: string) {
  const jobs = (await db().query(
    `SELECT j.id,j.room_id,r.code AS room_code,j.booking_id,COALESCE(b.reference,b.id::text) AS booking_ref,j.checkout_at_ms,j.status,j.attempt_count,j.error_code,j.package_results,
            j.created_at_ms,j.finished_at_ms,j.staff_checked_at_ms,u.display_name AS staff_checked_by,j.added_packages,j.executor,j.checks,j.next_retry_ms,j.ready_at_ms
       FROM tv_privacy_jobs j JOIN rooms r ON r.id=j.room_id AND r.owner_id=j.owner_id
       LEFT JOIN bookings b ON b.id=j.booking_id AND b.owner_id=j.owner_id
       LEFT JOIN pms_staff_users u ON u.id=j.staff_checked_by AND u.owner_id=j.owner_id
      WHERE j.owner_id=$1 ORDER BY j.id DESC LIMIT 60`,
    [ownerId],
  )).rows.map((x): PrivacyJob => ({
    added_packages: Array.isArray(x.added_packages) ? x.added_packages.map(String) : [], uninstalls: [],
    id: Number(x.id), room_id: Number(x.room_id), room_code: String(x.room_code), booking_id: Number(x.booking_id), booking_ref: String(x.booking_ref ?? x.booking_id),
    checkout_at_ms: Number(x.checkout_at_ms), status: String(x.status), attempt_count: Number(x.attempt_count), error_code: String(x.error_code ?? ""),
    package_results: Array.isArray(x.package_results) ? x.package_results : [], created_at_ms: Number(x.created_at_ms),
    finished_at_ms: x.finished_at_ms === null ? null : Number(x.finished_at_ms), staff_checked_at_ms: x.staff_checked_at_ms === null ? null : Number(x.staff_checked_at_ms), staff_checked_by: x.staff_checked_by ? String(x.staff_checked_by) : null,
    executor: String(x.executor ?? "gateway"), checks: x.checks && typeof x.checks === "object" ? x.checks : {},
    next_retry_ms: x.next_retry_ms === null || x.next_retry_ms === undefined ? null : Number(x.next_retry_ms), ready_at_ms: x.ready_at_ms === null || x.ready_at_ms === undefined ? null : Number(x.ready_at_ms),
  }));
  const uninstalls = jobs.length ? (await db().query(`SELECT id,job_id,package,status,error_code,approved_at_ms,finished_at_ms FROM tv_privacy_uninstalls WHERE owner_id=$1 AND job_id = ANY($2::bigint[]) ORDER BY id`, [ownerId, jobs.map((j) => j.id)])).rows : [];
  for (const x of uninstalls) jobs.find((j) => j.id === Number(x.job_id))?.uninstalls.push({ id: Number(x.id), job_id: Number(x.job_id), package: String(x.package), status: String(x.status), error_code: String(x.error_code ?? ""), approved_at_ms: Number(x.approved_at_ms), finished_at_ms: x.finished_at_ms === null ? null : Number(x.finished_at_ms) });
  const rooms = (await db().query(`SELECT s.room_id,r.code,s.privacy_clear,s.privacy_executor,s.privacy_baseline_at,s.app_version FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.active=1 AND r.active=1 ORDER BY r.code`, [ownerId])).rows
    .map((x) => ({ room_id: Number(x.room_id), room_code: String(x.code), enabled: Number(x.privacy_clear) === 1, executor: String(x.privacy_executor ?? "gateway"),
      baseline_at: x.privacy_baseline_at === null ? null : Number(x.privacy_baseline_at), app_version: x.app_version === null ? null : Number(x.app_version) }));
  const gw = (await db().query(`SELECT last_seen_at,dry_run FROM tv_privacy_gateway WHERE owner_id=$1`, [ownerId])).rows[0];
  return { jobs, rooms, gateway: gw ? { lastSeenAt: Number(gw.last_seen_at), dryRun: gw.dry_run === null ? null : Number(gw.dry_run) === 1 } : null, bridgeConfigured: Boolean(bridgeConfig()) };
}
