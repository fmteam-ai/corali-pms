import { apiAvailability, apiBad, apiJson, requireApiKey } from "@/lib/open-api";

/** GET /api/v1/availability?from=YYYY-MM-DD&to=YYYY-MM-DD — free rooms per type and night (scope availability.read). */
export async function GET(request: Request) {
  const k = await requireApiKey(request, "availability.read");
  if (k instanceof Response) return k;
  const q = new URL(request.url).searchParams;
  const data = await apiAvailability(k.ownerId, q.get("from"), q.get("to"));
  return data ? apiJson(data) : apiBad("from/to: YYYY-MM-DD, to ≥ from, at most 365 nights");
}
