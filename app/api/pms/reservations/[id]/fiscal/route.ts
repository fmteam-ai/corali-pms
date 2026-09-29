import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelDocument, issueDocument, listDocuments, transmit } from "@/lib/fiscal";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), payer: z.enum(["guest", "company", "agency"]) }),
  z.object({ action: z.literal("retry"), documentId: z.number().int().positive() }),
  z.object({ action: z.literal("cancel"), documentId: z.number().int().positive() }),
]);
const known = ["NOT_FOUND", "NOTHING_TO_ISSUE", "NEEDS_CREDIT_NOTE", "COUNTERPART_VAT_REQUIRED", "MYDATA_NOT_CONFIGURED", "ISSUER_VAT_REQUIRED", "CLIMATE_TAX_CATEGORY_REQUIRED"];

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, documents: await listDocuments(db(), u.ownerId, Number((await params).id)) });
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const bookingId = Number((await params).id);
    const x = input.parse(await request.json());
    if (x.action === "issue") await issueDocument(u.ownerId, bookingId, x.payer, String(u.id));
    else {
      const owned = await db().query(`SELECT 1 FROM fiscal_documents WHERE owner_id=$1 AND id=$2 AND booking_id=$3`, [u.ownerId, x.documentId, bookingId]);
      if (!owned.rowCount) throw Error("NOT_FOUND");
      if (x.action === "retry") await transmit(u.ownerId, x.documentId);
      else await cancelDocument(u.ownerId, x.documentId);
    }
    return Response.json({ ok: true, documents: await listDocuments(db(), u.ownerId, bookingId) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (known.includes(m)) return Response.json({ ok: false, error: m }, { status: m === "NOT_FOUND" ? 404 : 409 });
    if (m.startsWith("CANCEL_FAILED")) return Response.json({ ok: false, error: "CANCEL_FAILED", detail: m.slice(15) }, { status: 502 });
    console.error("fiscal document action failed", e);
    return Response.json({ ok: false, error: "FISCAL_FAILED" }, { status: 500 });
  }
}

export const POST = audited("fiscal_document", handlePOST);
