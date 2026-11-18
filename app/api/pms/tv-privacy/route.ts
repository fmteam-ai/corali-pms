import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { privacyOverview } from "@/lib/tv-privacy";
import { isRemovableGuestPackage } from "../../../../scripts/tv-privacy-core.mjs";

const input = z.discriminatedUnion("action", [
  // Admin: which rooms' TVs are cleared at check-out.
  z.object({ action: z.literal("room"), roomId: z.number().int().positive(), enabled: z.boolean(), executor: z.enum(["gateway", "tv_agent"]).optional() }),
  // Admin: the same for several rooms at once (only the fields given change).
  z.object({ action: z.literal("rooms"), roomIds: z.array(z.number().int().positive()).min(1).max(200), enabled: z.boolean().optional(), executor: z.enum(["gateway", "tv_agent"]).optional() }),
  // Reception / housekeeping lead: the app screens were checked on the TV after the clearing.
  z.object({ action: z.literal("review"), jobId: z.number().int().positive() }),
  // Admin: try a failed / unverified job again (the gateway re-checks for a new guest before every clear).
  z.object({ action: z.literal("retry"), jobId: z.number().int().positive() }),
  // Admin: remove ONE guest-installed app the gateway reported for this check-out (never a protected package).
  z.object({ action: z.literal("approve_uninstall"), jobId: z.number().int().positive(), package: z.string().max(150) }),
]);

export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await privacyOverview(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const x = parsed.data;
  const u = await requireApiUser(x.action === "review" ? "reservations.write" : "integrations.write");
  if (u instanceof Response) return u;
  try { assertTrustedOrigin(request); } catch { return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }); }
  let r;
  if (x.action === "room") {
    r = await db().query(`UPDATE tv_screens SET privacy_clear=$3,privacy_executor=COALESCE($4,privacy_executor) WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, x.roomId, x.enabled ? 1 : 0, x.executor ?? null]);
  } else if (x.action === "rooms") {
    if (x.enabled === undefined && x.executor === undefined) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    r = await db().query(`UPDATE tv_screens SET privacy_clear=COALESCE($3,privacy_clear),privacy_executor=COALESCE($4,privacy_executor) WHERE owner_id=$1 AND room_id = ANY($2::bigint[])`, [u.ownerId, x.roomIds, x.enabled === undefined ? null : x.enabled ? 1 : 0, x.executor ?? null]);
  } else if (x.action === "review") {
    // Only a finished clearing can be marked as checked; the review never changes the job's own result.
    r = await db().query(
      `UPDATE tv_privacy_jobs SET staff_checked_at_ms=$3,staff_checked_by=$4 WHERE owner_id=$1 AND id=$2 AND status IN ('CLEARED_LOCAL_NEEDS_REVIEW','PARTIAL','UNVERIFIED') AND staff_checked_at_ms IS NULL`,
      [u.ownerId, x.jobId, Date.now(), u.id],
    );
  } else if (x.action === "approve_uninstall") {
    if (!isRemovableGuestPackage(x.package)) return Response.json({ ok: false, error: "PROTECTED_PACKAGE" }, { status: 400 });
    // Only a package the gateway itself reported as added for this check-out, and only while no new guest arrived.
    r = await db().query(
      `INSERT INTO tv_privacy_uninstalls(owner_id,job_id,room_id,package,approved_by,approved_at_ms)
         SELECT j.owner_id,j.id,j.room_id,$3,$4,$5 FROM tv_privacy_jobs j
          WHERE j.owner_id=$1 AND j.id=$2 AND j.added_packages ? $3 AND j.status NOT IN ('BLOCKED_NEW_GUEST','QUEUED','RUNNING')
            AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.owner_id=j.owner_id AND b.room_id=j.room_id AND b.id<>j.booking_id AND (b.status='checked_in' OR COALESCE(b.checked_in_at,0)>j.checkout_at_ms))
       ON CONFLICT (owner_id,job_id,package) DO NOTHING`,
      [u.ownerId, x.jobId, x.package, u.id, Date.now()],
    );
    // v162: a TV that clears itself removes it on its next run (the room is pending again until then).
    if (r.rowCount) await db().query(`UPDATE tv_privacy_jobs SET status='RETRY_PENDING',next_retry_ms=0,error_code='GUEST_APP_REMOVAL' WHERE owner_id=$1 AND id=$2 AND executor='tv_agent' AND status IN ('READY','NEEDS_STAFF','RETRY_PENDING')`, [u.ownerId, x.jobId]);
  } else {
    // Gateway jobs start again; TV jobs (v162) that wait for a retry / a staff re-check run at the TV's next check.
    r = await db().query(
      `UPDATE tv_privacy_jobs SET status=CASE WHEN executor='tv_agent' THEN status ELSE 'QUEUED' END,attempt_count=CASE WHEN executor='tv_agent' THEN attempt_count ELSE 0 END,
              error_code=CASE WHEN executor='tv_agent' THEN error_code ELSE '' END,next_retry_ms=0,claim_hash=NULL,lease_until_ms=NULL,finished_at_ms=CASE WHEN executor='tv_agent' THEN finished_at_ms ELSE NULL END
        WHERE owner_id=$1 AND id=$2 AND (status IN ('FAILED','PARTIAL','UNVERIFIED','DRY_RUN','BLOCKED_SECURITY') OR (executor='tv_agent' AND status IN ('RETRY_PENDING','NEEDS_STAFF')))`,
      [u.ownerId, x.jobId],
    );
  }
  if (!r.rowCount) return Response.json({ ok: false, error: "NOT_ALLOWED" }, { status: 409 });
  return Response.json({ ok: true, ...(await privacyOverview(u.ownerId)) });
}

export const POST = audited("tv_privacy", handlePOST);
