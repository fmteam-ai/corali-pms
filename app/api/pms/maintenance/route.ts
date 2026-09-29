import { z } from "zod";
import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { maintenanceSeverities } from "@/lib/maintenance";
import { createNotice, listNotices } from "@/lib/maintenance-db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

const input = z.object({
  roomId: z.number().int().positive(),
  severity: z.enum(maintenanceSeverities),
  description: z.string().trim().min(3).max(2000),
  photos: z.array(z.string().max(3_500_000)).max(6).default([]),
});

export async function GET(request: Request) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const roomId = Number(url.searchParams.get("roomId")) || null;
  const notices = await listNotices(u.ownerId, { status: status === "open" || status === "resolved" ? status : "all", roomId });
  return Response.json({ ok: true, notices });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  // Housekeeping (capture) and reception/maintenance (resolve) may both log a defect.
  if (!can(u.role, "housekeeping.write", u.permissions) && !can(u.role, "maintenance.resolve", u.permissions)) return forbidden(u, "housekeeping.write", "maintenance.report");
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const notice = await withTransaction((c) => createNotice(c, u.ownerId, { roomId: x.roomId, severity: x.severity, description: x.description, reportedBy: u.id, photos: x.photos }));
    return Response.json({ ok: true, notice }, { status: 201 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m === "INVALID_ROOM" || m === "INVALID_PHOTO") return Response.json({ ok: false, error: m }, { status: 400 });
    return Response.json({ ok: false, error: "CREATE_FAILED" }, { status: 500 });
  }
}

export const POST = audited("maintenance_notice", handlePOST);
