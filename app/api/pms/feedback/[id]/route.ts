import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ notes: z.string().trim().min(3).max(2000) });

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("reservations.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = Number((await params).id), x = input.parse(await request.json());
    const r = await db().query(
      `UPDATE review_requests SET status='resolved',resolved_by=$3,resolved_at=$4,resolution_notes=$5 WHERE owner_id=$1 AND id=$2 AND status='feedback' RETURNING id,status,resolved_at,resolution_notes`,
      [u.ownerId, id, u.id, Date.now(), x.notes],
    );
    return r.rowCount ? Response.json({ ok: true, feedback: r.rows[0] }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "UPDATE_FAILED" }, { status: 400 });
  }
}

export const PATCH = audited("guest_feedback", handlePATCH);
