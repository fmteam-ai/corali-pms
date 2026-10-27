import { apiInvoices, apiJson, requireApiKey } from "@/lib/open-api";

/** GET /api/v1/invoices?after=<id> — issued receipts / invoices with their myDATA mark (scope accounting.read). */
export async function GET(request: Request) {
  const k = await requireApiKey(request, "accounting.read");
  if (k instanceof Response) return k;
  return apiJson(await apiInvoices(k.ownerId, Math.max(0, Number.parseInt(new URL(request.url).searchParams.get("after") ?? "0", 10) || 0)));
}
