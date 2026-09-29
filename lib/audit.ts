import { headers } from "next/headers";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { auditActionName, clientAddress, redactForAudit } from "@/lib/audit-redact";

type Queryable = Pick<PoolClient, "query">;

export type AuditEntry = {
  ownerId: string;
  userId: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
};

async function requestMeta(): Promise<{ ip: string; agent: string }> {
  try {
    const h = await headers();
    return { ip: clientAddress(h.get("x-forwarded-for"), h.get("x-real-ip")), agent: (h.get("user-agent") ?? "").slice(0, 300) };
  } catch {
    return { ip: "", agent: "" };
  }
}

/** Append an audit record. Pass a transaction client to make it atomic with the change. Never throws. */
export async function recordAudit(entry: AuditEntry, client?: Queryable): Promise<void> {
  try {
    const meta = await requestMeta();
    await (client ?? db()).query(
      `INSERT INTO audit_logs(owner_id,user_id,action,entity_name,entity_id,payload_before,payload_after,ip_address,user_agent,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        entry.ownerId,
        entry.userId,
        entry.action.slice(0, 100),
        entry.entity.slice(0, 50),
        entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId).slice(0, 100),
        entry.before === undefined ? null : JSON.stringify(redactForAudit(entry.before)),
        entry.after === undefined ? null : JSON.stringify(redactForAudit(entry.after)),
        meta.ip,
        meta.agent,
        Date.now(),
      ],
    );
  } catch (error) {
    console.error("audit log write failed", error);
  }
}

type RouteContext = { params: Promise<Record<string, string>> };
type Snapshot = (ownerId: string, body: Record<string, unknown>, params: Record<string, string>) => Promise<unknown>;

/**
 * Wrap a mutating route handler so every successful call is written to audit_logs with the acting user,
 * client address, action, resource, the (redacted) request payload and optionally a before-snapshot.
 */
export function audited(entity: string, handler: (request: Request, context: never) => Promise<Response>, options: { snapshot?: Snapshot } = {}) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    const { currentUser } = await import("@/lib/auth");
    let body: Record<string, unknown> = {};
    try {
      const parsed = await request.clone().json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch { /* not JSON */ }
    const params = (await context?.params) ?? {};
    const user = await currentUser();
    let before: unknown;
    if (user && options.snapshot) {
      try { before = await options.snapshot(user.ownerId, body, params); } catch { before = undefined; }
    }
    const response = await handler(request, context as never);
    if (user && response.ok && !(entity === "dashboard_note" && String(body.action ?? "").startsWith("read_"))) {
      const idValue = body.id ?? body.roomId ?? body.bookingId;
      const entityId = params.id ?? (typeof idValue === "number" || typeof idValue === "string" ? idValue : null);
      await recordAudit({ ownerId: user.ownerId, userId: user.id, action: auditActionName(request.method, body), entity, entityId, before, after: body });
    }
    return response;
  };
}
