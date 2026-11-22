import { recordAudit } from "@/lib/audit";
import { posJson, requirePosKey, voidPosSale } from "@/lib/department-sales";

/** DELETE /api/v1/pos/sales/{receipt_id} — the receipt was voided on the POS: out of the sales, a room charge reversed. */
export async function DELETE(request: Request, { params }: { params: Promise<{ receipt: string }> }) {
  const k = await requirePosKey(request);
  if (k instanceof Response) return k;
  const receipt = decodeURIComponent((await params).receipt).trim().slice(0, 60);
  const r = await voidPosSale(k, receipt);
  if ("error" in r) return Response.json({ ok: false, error: "NOT_FOUND", message: "Unknown receipt" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (r.voided) await recordAudit({ ownerId: k.ownerId, userId: null, action: "pos_void", entity: "pos_sales", entityId: receipt, after: { department: k.department } });
  return posJson(r);
}
