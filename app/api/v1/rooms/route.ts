import { apiJson, apiRooms, requireApiKey } from "@/lib/open-api";

/** GET /api/v1/rooms — the hotel's rooms (scope rooms.read). */
export async function GET(request: Request) {
  const k = await requireApiKey(request, "rooms.read");
  if (k instanceof Response) return k;
  return apiJson(await apiRooms(k.ownerId));
}
