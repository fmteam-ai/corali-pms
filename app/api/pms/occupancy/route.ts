import { requireApiUser } from "@/lib/auth";
import { activeRoomCount, dailyOccupancy } from "@/lib/occupancy";
import { addDays, hotelToday, isIsoDate } from "@/lib/tape-chart";

/** GET ?month=YYYY-MM (calendar month) or ?start=YYYY-MM-DD&days=N (max 62). */
export async function GET(request: Request) {
  const user = await requireApiUser("dashboard.read");
  if (user instanceof Response) return user;
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  let start: string, days: number;
  if (month && /^\d{4}-\d{2}$/.test(month) && isIsoDate(`${month}-01`)) {
    start = `${month}-01`;
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    days = Math.round((next.getTime() - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  } else {
    const requested = url.searchParams.get("start");
    start = isIsoDate(requested) ? requested : hotelToday();
    days = Math.min(62, Math.max(1, Number(url.searchParams.get("days")) || 30));
  }
  const [rows, totalRooms] = await Promise.all([dailyOccupancy(user.ownerId, start, days), activeRoomCount(user.ownerId)]);
  return Response.json({ ok: true, start, end: addDays(start, days), totalRooms, days: rows }, { headers: { "Cache-Control": "no-store" } });
}
