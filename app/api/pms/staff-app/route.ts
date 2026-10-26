import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listNotices } from "@/lib/maintenance-db";
import { can } from "@/lib/security/permissions";
import { defaultAlertKinds, isDesk, addDaysIso } from "@/lib/staff-core";
import { listShifts, staffMe } from "@/lib/staff";
import { hotelToday } from "@/lib/tape-chart";
import { listTvRequests } from "@/lib/tv-requests";

/**
 * Corali Staff app data. Always: who I am, my teams and sections, my shifts (2 weeks) and who works today.
 * ?part=reception → today's arrivals & departures, open TV requests, rooms to inspect; ?part=maintenance → open defects.
 */
export async function GET(request: Request) {
  const u = await requireApiUser("staff.app");
  if (u instanceof Response) return u;
  const part = new URL(request.url).searchParams.get("part");
  const today = hotelToday();
  const [me, shifts, team] = await Promise.all([staffMe(u), listShifts(u.ownerId, today, addDaysIso(today, 13), u.id), listShifts(u.ownerId, today, today)]);
  const allow = {
    housekeeping: me.modules.includes("housekeeping") && can(u.role, "housekeeping.read", u.permissions),
    reception: me.modules.includes("reception") && can(u.role, "reservations.read", u.permissions),
    maintenance: me.modules.includes("maintenance") && can(u.role, "housekeeping.read", u.permissions),
  };
  const out: Record<string, unknown> = {
    ok: true, today,
    me: { id: u.id, name: u.displayName, role: u.role, desk: isDesk(u.role), specialties: me.specialties.map((s) => ({ id: s.id, name: s.name, color: s.color })), sections: allow, defaultKinds: defaultAlertKinds(u.role, me.modules),
      can: { checkInOut: can(u.role, "reservations.edit", u.permissions), housekeepingWrite: can(u.role, "housekeeping.write", u.permissions), resolve: can(u.role, "maintenance.resolve", u.permissions) } },
    shifts, team,
  };
  if (part === "reception" && allow.reception) {
    const [moves, requests, inspect] = await Promise.all([
      db().query(
        `SELECT b.id,b.version,b.guest_name,b.status,b.check_in,b.check_out,(b.adults+b.children) AS people,r.code room_code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
          WHERE b.owner_id=$1 AND (b.check_in=$2 OR b.check_out=$2) AND b.status IN ('confirmed','checked_in','checked_out') ORDER BY r.code`,
        [u.ownerId, today],
      ),
      listTvRequests(u.ownerId, false),
      db().query(
        `SELECT t.id,t.status,t.task_type,t.cleaned_by_staff_id,r.code room_code,su.display_name cleaned_by FROM housekeeping_tasks t JOIN rooms r ON r.owner_id=t.owner_id AND r.id=t.room_id
           LEFT JOIN pms_staff_users su ON su.owner_id=t.owner_id AND su.id=t.cleaned_by_staff_id
          WHERE t.owner_id=$1 AND t.status IN ('cleaned','repaired') ORDER BY t.completed_at`,
        [u.ownerId],
      ),
    ]);
    out.reception = {
      arrivals: moves.rows.filter((b) => b.check_in === today).map((b) => ({ id: Number(b.id), version: Number(b.version), guest: String(b.guest_name), room: b.room_code, people: Number(b.people), status: String(b.status) })),
      departures: moves.rows.filter((b) => b.check_out === today).map((b) => ({ id: Number(b.id), version: Number(b.version), guest: String(b.guest_name), room: b.room_code, people: Number(b.people), status: String(b.status) })),
      requests: requests.filter((q) => q.status === "open"),
      inspect: inspect.rows.map((t) => ({ id: Number(t.id), status: String(t.status), type: String(t.task_type), room: String(t.room_code), cleanedBy: t.cleaned_by ?? "", mine: Number(t.cleaned_by_staff_id) === u.id })),
    };
  }
  if (part === "maintenance" && allow.maintenance) out.maintenance = { notices: await listNotices(u.ownerId, { status: "open", limit: 100 }) };
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
