// PMS → Ιστορικό συνδέσεων: every sign-in (who, when, from which address and device, last activity, how it ended)
// and the failed attempts, for the owner / administrators.
import { db } from "@/lib/db";
import { IDLE_TIMEOUT_MS } from "@/lib/auth";
import { deviceFromUserAgent, primaryAddress, type DeviceInfo } from "@/lib/user-agent";

export type LoginRow = {
  id: number; userId: number | null; user: string; username: string; role: string;
  at: number; lastSeen: number; endedAt: number | null; expiresAt: number;
  status: "active" | "logout" | "idle" | "revoked" | "expired";
  ip: string; chain: string; local: boolean; device: DeviceInfo; agent: string;
};
export type FailedRow = { at: number; username: string; reason: string; ip: string; device: DeviceInfo; agent: string };

const HISTORY_DAYS = 90;

export function sessionStatus(r: { revoked_at: unknown; ended_reason: unknown; expires_at: unknown; last_seen_at: unknown; role: string }, now: number): LoginRow["status"] {
  if (r.revoked_at) return r.ended_reason === "idle" ? "idle" : r.ended_reason === "revoked" ? "revoked" : "logout";
  if (Number(r.expires_at) <= now) return "expired";
  if (!["housekeeping", "staff"].includes(r.role) && Number(r.last_seen_at) <= now - IDLE_TIMEOUT_MS) return "idle";
  return "active";
}

export async function loginHistory(ownerId: string, now = Date.now()): Promise<{ sessions: LoginRow[]; failed: FailedRow[] }> {
  const since = now - HISTORY_DAYS * 86_400_000;
  const [s, f] = await Promise.all([
    db().query(`SELECT s.id,s.staff_user_id,s.created_at,s.last_seen_at,s.revoked_at,s.ended_reason,s.expires_at,s.user_agent,s.ip_address,u.display_name,u.username,COALESCE(NULLIF(u.role,''),'readonly') AS role
      FROM pms_sessions s LEFT JOIN pms_staff_users u ON u.id=s.staff_user_id AND u.owner_id=s.owner_id
      WHERE s.owner_id=$1 AND s.created_at>$2::bigint ORDER BY s.created_at DESC LIMIT 500`, [ownerId, since]),
    db().query(`SELECT created_at,payload_after,ip_address,user_agent,action FROM audit_logs WHERE owner_id=$1 AND action IN ('security.login_failed','security.login_blocked') AND created_at>$2::bigint ORDER BY created_at DESC LIMIT 300`, [ownerId, now - 30 * 86_400_000]),
  ]);
  const sessions = s.rows.map((r): LoginRow => {
    const a = primaryAddress(String(r.ip_address ?? ""));
    return {
      id: Number(r.id), userId: r.staff_user_id ? Number(r.staff_user_id) : null, user: String(r.display_name ?? "—"), username: String(r.username ?? ""), role: String(r.role),
      at: Number(r.created_at), lastSeen: Number(r.last_seen_at), endedAt: r.revoked_at ? Number(r.revoked_at) : null, expiresAt: Number(r.expires_at),
      status: sessionStatus(r, now), ip: a.ip, chain: String(r.ip_address ?? ""), local: a.local, device: deviceFromUserAgent(String(r.user_agent ?? "")), agent: String(r.user_agent ?? ""),
    };
  });
  const failed = f.rows.map((r): FailedRow => {
    let p: Record<string, unknown> = {};
    try { p = typeof r.payload_after === "string" ? JSON.parse(r.payload_after) : (r.payload_after ?? {}); } catch { p = {}; }
    return { at: Number(r.created_at), username: String(p.username ?? ""), reason: r.action === "security.login_blocked" ? "blocked" : String(p.reason ?? "credentials"), ip: primaryAddress(String(r.ip_address ?? "")).ip, device: deviceFromUserAgent(String(r.user_agent ?? "")), agent: String(r.user_agent ?? "") };
  });
  return { sessions, failed };
}

/** Ends a session at once (e.g. a lost phone or an unknown device); the person must sign in again. */
export async function revokeSession(ownerId: string, id: number): Promise<boolean> {
  const r = await db().query(`UPDATE pms_sessions SET revoked_at=$3,ended_reason='revoked' WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL`, [ownerId, id, Date.now()]);
  return Boolean(r.rowCount);
}
