import { apiBooking, apiJson, apiNotFound, requireApiKey } from "@/lib/open-api";

/** GET /api/v1/bookings/{reference or room code of a guest in house} — booking with its folio (scope bookings.read). */
export async function GET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const k = await requireApiKey(request, "bookings.read");
  if (k instanceof Response) return k;
  const { reference } = await params;
  const data = reference.length <= 60 ? await apiBooking(k.ownerId, decodeURIComponent(reference)) : null;
  return data ? apiJson(data) : apiNotFound("Booking not found");
}
