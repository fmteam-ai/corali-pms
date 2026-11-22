import { recordAudit } from "@/lib/audit";
import { posBad, posJson, recordPosSale, requirePosKey } from "@/lib/department-sales";
import { normalizePosSale } from "../../../../../scripts/department-sales-core.mjs";

/**
 * POST /api/v1/pos/sales — one receipt of the department the POS key belongs to (Authorization: Bearer cpos_…).
 * Body: { receipt_id, sold_at?, items: [{ name, sku?, quantity, unit_price }], total?, payment: cash|card|room|other,
 * room? (room number of a guest in house or booking reference; required for payment "room"), covers? }. Amounts in EUR.
 * The same receipt_id again returns the first receipt (200, duplicate: true), so a POS may retry safely.
 * payment "room" charges the guest's folio at once.
 */
export async function POST(request: Request) {
  const k = await requirePosKey(request);
  if (k instanceof Response) return k;
  const n = normalizePosSale(await request.json().catch(() => null));
  if (!n.sale) return posBad(n.error);
  const r = await recordPosSale(k, n.sale);
  if ("error" in r) return Response.json({ ok: false, error: r.error, message: r.error === "ROOM_NOT_FOUND" ? "No guest in house in that room / with that reference" : "The booking is not open (confirmed or checked in)" }, { status: r.error === "ROOM_NOT_FOUND" ? 404 : 409, headers: { "Cache-Control": "no-store" } });
  if (!r.duplicate && r.folioEntryId) await recordAudit({ ownerId: k.ownerId, userId: null, action: "pos_room_charge", entity: "folio_entries", entityId: r.folioEntryId, after: { department: k.department, receipt: r.receiptId, reference: r.booking, total: r.total } });
  return posJson(r, r.duplicate ? 200 : 201);
}
