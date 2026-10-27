import { apiJson, apiTransactions, requireApiKey } from "@/lib/open-api";

/** GET /api/v1/transactions?after=<id>&from=YYYY-MM-DD — folio charges and payments, oldest first (scope accounting.read). */
export async function GET(request: Request) {
  const k = await requireApiKey(request, "accounting.read");
  if (k instanceof Response) return k;
  const q = new URL(request.url).searchParams;
  return apiJson(await apiTransactions(k.ownerId, Math.max(0, Number.parseInt(q.get("after") ?? "0", 10) || 0), q.get("from")));
}
