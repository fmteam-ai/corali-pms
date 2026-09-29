import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptField } from "@/lib/security/encryption";
import { assertTrustedOrigin } from "@/lib/security/origin";

/** Full identity details of the latest pre-check-in (for police registration). Every call is audited without the values. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("reservations.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
  } catch {
    return Response.json({ ok: false, error: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  const key = env().PMS_DOCUMENT_KEY;
  if (!key) return Response.json({ ok: false, error: "DOCUMENT_KEY_NOT_CONFIGURED" }, { status: 503 });
  const id = Number((await params).id);
  const r = await db().query(`SELECT document_type,document_number,date_of_birth_encrypted,identity_purged_at FROM guest_checkins WHERE owner_id=$1 AND booking_id=$2 ORDER BY submitted_at DESC LIMIT 1`, [u.ownerId, id]);
  const row = r.rows[0];
  if (!row) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  if (row.identity_purged_at) return Response.json({ ok: false, error: "PURGED" }, { status: 410 });
  const open = (value: string | null) => {
    if (!value) return "";
    try { return decryptField(value, key); } catch { return ""; }
  };
  return Response.json({ ok: true, documentType: row.document_type, documentNumber: open(row.document_number), dateOfBirth: open(row.date_of_birth_encrypted) }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = audited("guest_identity", handlePOST);
