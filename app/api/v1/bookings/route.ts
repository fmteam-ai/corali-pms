import { apiBad, apiBookings, apiJson, requireApiKey } from "@/lib/open-api";

/** GET /api/v1/bookings?from&to&status&in_house=true — bookings overlapping the dates (scope bookings.read). */
export async function GET(request: Request) {
  const k = await requireApiKey(request, "bookings.read");
  if (k instanceof Response) return k;
  const data = await apiBookings(k.ownerId, new URL(request.url).searchParams);
  return data ? apiJson(data) : apiBad("from/to: YYYY-MM-DD");
}
