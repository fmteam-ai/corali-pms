import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { can, parsePermissions, type Permission, type Role } from "@/lib/security/permissions";
import { hashToken } from "@/lib/security/tokens";
import { recordAudit } from "@/lib/audit";

export const sessionCookieName = "corali_pms_session";

export type CurrentUser = {
  id: number;
  ownerId: string;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  permissions: Partial<Record<Permission, boolean>>;
  sessionId: number;
};

export async function currentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;
  const now = Date.now();
  const result = await db().query({
    text: `SELECT s.id AS session_id, s.last_seen_at, u.id, u.owner_id, u.username, u.display_name, u.email,
                  COALESCE(NULLIF(u.role, ''), 'readonly') AS role, u.permissions_json
             FROM pms_sessions s
             JOIN pms_staff_users u ON u.id = s.staff_user_id AND u.owner_id = s.owner_id
            WHERE s.owner_id = $1 AND s.token_hash = $2 AND s.revoked_at IS NULL
              AND s.expires_at > $3 AND u.active = 1
            LIMIT 1`,
    values: [env().PMS_OWNER_ID, hashToken(token), now],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (!['owner', 'admin', 'reception', 'housekeeping', 'readonly'].includes(row.role)) return null;
  if (now - Number(row.last_seen_at ?? 0) > 60_000) {
    void db().query("UPDATE pms_sessions SET last_seen_at = $1 WHERE id = $2", [now, row.session_id]);
  }
  return {
    id: Number(row.id),
    ownerId: row.owner_id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role as Role,
    permissions: parsePermissions(row.permissions_json),
    sessionId: Number(row.session_id),
  };
}

/** Record a denied access attempt as a security audit event. */
export async function logForbidden(user: CurrentUser, permission: string, resource: string): Promise<void> {
  await recordAudit({ ownerId: user.ownerId, userId: user.id, action: "security.forbidden", entity: "permission", entityId: permission, after: { resource, role: user.role } });
}

/** 403 response for a permission check done inside a route; the denial is audited. */
export async function forbidden(user: CurrentUser, permission: Permission, resource = "api"): Promise<Response> {
  await logForbidden(user, permission, resource);
  return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
}

export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission, user.permissions)) {
    await logForbidden(user, permission, "page");
    redirect("/pms/forbidden");
  }
  return user;
}

export async function requireApiUser(permission: Permission): Promise<CurrentUser | Response> {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(user.role, permission, user.permissions)) return forbidden(user, permission);
  return user;
}
