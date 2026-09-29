import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getNotice, resolveNotice } from "@/lib/maintenance-db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({
  resolutionNotes: z.string().trim().min(5).max(4000),
  laborHours: z.number().min(0).max(999).nullable().default(null),
  costCents: z.number().int().min(0).max(100_000_000).nullable().default(null),
  vendorReference: z.string().trim().max(200).nullable().default(null),
  postRepairState: z.enum(["clean", "dirty"]),
});
const errorStatus: Record<string, number> = { NOT_FOUND: 404, ALREADY_RESOLVED: 409, SECOND_REVIEW_REQUIRED: 409 };

async function id(params: Promise<{ id: string }>) {
  const value = Number((await params).id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  const noticeId = await id(params);
  const notice = noticeId ? await getNotice(u.ownerId, noticeId) : null;
  return notice ? Response.json({ ok: true, notice }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("maintenance.resolve");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const noticeId = await id(params);
    if (!noticeId) return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    const x = input.parse(await request.json());
    const result = await withTransaction((c) => resolveNotice(c, u.ownerId, { id: noticeId, resolverId: u.id, notes: x.resolutionNotes, laborHours: x.laborHours, costCents: x.costCents, vendorReference: x.vendorReference, override: x.postRepairState }));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "RESOLUTION_REQUIRED" }, { status: 400 });
    return Response.json({ ok: false, error: errorStatus[m] ? m : "UPDATE_FAILED" }, { status: errorStatus[m] ?? 500 });
  }
}

export const PATCH = audited("maintenance_notice", handlePATCH);
