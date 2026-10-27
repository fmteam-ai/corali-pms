import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { apiBad, apiCharge, apiJson, apiNotFound, requireApiKey } from "@/lib/open-api";

const input = z.object({ description: z.string().trim().min(1).max(180), amount: z.number().positive().max(10_000), external_id: z.string().trim().min(1).max(60).optional() });

/**
 * POST /api/v1/bookings/{reference or room code of a guest in house}/charges — a POS charge on the guest's folio
 * (scope folio.write). Send external_id (the POS receipt number) so a retried request is not charged twice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const k = await requireApiKey(request, "folio.write");
  if (k instanceof Response) return k;
  const x = input.safeParse(await request.json().catch(() => null));
  if (!x.success) return apiBad("Body: { description: string, amount: number (EUR), external_id?: string }");
  const { reference } = await params;
  const r = await apiCharge(k, decodeURIComponent(reference).slice(0, 60), x.data);
  if ("error" in r) return r.error === "NOT_FOUND" ? apiNotFound("Booking not found") : Response.json({ ok: false, error: r.error, message: "The booking is not open (confirmed or checked in)" }, { status: 409 });
  if (!r.duplicate) await recordAudit({ ownerId: k.ownerId, userId: null, action: "api_charge", entity: "folio_entries", entityId: r.id, after: { key: k.name, reference: r.reference, ...x.data } });
  return apiJson(r);
}
