import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeLayout } from "@/lib/dashboard-widgets";
import { getPmsT } from "@/lib/pms-lang";
import { loadNotifications, type FeedItem } from "@/lib/pms-notification-feed";
import { can } from "@/lib/security/permissions";
import { hotelToday } from "@/lib/tape-chart";
import { DashboardRefresh } from "./dashboard-refresh";
import { WidgetDashboard, type DashboardData } from "./_dashboard/widget-dashboard";

const stayColumns = `b.id,b.reference,b.guest_name,r.code room_code,b.check_in,b.check_out,b.status,b.balance_cents,b.version,b.adults,b.children`;
const hotelDay = (offset: number) => `((now() AT TIME ZONE 'Europe/Athens')::date+${offset})::text`;

export default async function PmsPage() {
  const user = await requireUser("dashboard.read");
  const { lang, t } = await getPmsT();
  const failures: string[] = [];
  const query = (sql: string, values: unknown[], area = "") => db().query(sql, values).catch((error) => { const tag = sql.slice(0, 90).replaceAll(/\s+/g, " "); console.error("PMS dashboard query failed", area, tag, error); failures.push(area || tag.split(" FROM ")[1]?.split(" ")[0] || "query"); return { rows: [] as Record<string, unknown>[] }; });
  const financial = can(user.role, "folios.read", user.permissions);
  const stays = (column: "check_in" | "check_out", offset: number, statuses: string) => query(`SELECT ${stayColumns} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.${column}=${hotelDay(offset)} AND b.status IN (${statuses}) ORDER BY r.code,b.guest_name`, [user.ownerId], column === "check_in" ? "arrivals" : "departures");
  const arrivalStatuses = `'confirmed','checked_in','checked_out','no_show'`, departureStatuses = `'confirmed','checked_in','checked_out'`;
  const [notes, rooms, recent, roomState, balances, payments, hk, layout, notifications, aY, aT, aM, dY, dT, dM] = await Promise.all([
    query(`SELECT id,body,color FROM pms_dashboard_notes WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 40`, [user.ownerId], "notes"),
    query(`SELECT count(*)::int total,COALESCE(array_agg(DISTINCT room_type),'{}') types FROM rooms WHERE owner_id=$1 AND active=1`, [user.ownerId], "rooms"),
    query(`SELECT id,reference,guest_name,check_in,check_out,status,channel,created_at FROM bookings WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 8`, [user.ownerId], "latest_bookings"),
    query(`SELECT r.id,r.code,r.room_type,r.operational_status,b.guest_name,b.id booking_id FROM rooms r LEFT JOIN LATERAL (SELECT id,guest_name FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=${hotelDay(0)} AND b.check_out>${hotelDay(0)} ORDER BY b.id DESC LIMIT 1) b ON true WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`, [user.ownerId], "rooms_today"),
    financial ? query(`SELECT id,reference,guest_name,check_out,balance_cents FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in') AND balance_cents>0 ORDER BY check_out LIMIT 20`, [user.ownerId], "balances") : Promise.resolve({ rows: [] }),
    financial ? query(`SELECT COALESCE(sum(CASE WHEN entry_type IN ('payment','refund') THEN -amount_cents ELSE 0 END),0)::bigint AS net_cents FROM folio_entries WHERE owner_id=$1 AND created_at>=(extract(epoch from ((now() AT TIME ZONE 'Europe/Athens')::date AT TIME ZONE 'Europe/Athens'))*1000)::bigint`, [user.ownerId], "payments") : Promise.resolve({ rows: [{ net_cents: 0 }] }),
    query(`SELECT count(*) FILTER (WHERE status='todo')::int todo,count(*) FILTER (WHERE status='in_progress')::int in_progress,count(*) FILTER (WHERE status IN ('cleaned','repaired'))::int review,count(*) FILTER (WHERE status='out_of_order')::int ooo,(SELECT count(*)::int FROM maintenance_notices m WHERE m.owner_id=$1 AND m.status='open') open_defects FROM housekeeping_tasks WHERE owner_id=$1`, [user.ownerId], "housekeeping"),
    query(`SELECT layout_json FROM pms_dashboard_layouts WHERE owner_id=$1 AND staff_user_id=$2`, [user.ownerId, user.id], "layout"),
    loadNotifications(user.ownerId, lang).catch((e) => { console.error("PMS dashboard notifications failed", e); failures.push("notifications"); return [] as FeedItem[]; }),
    stays("check_in", -1, arrivalStatuses), stays("check_in", 0, arrivalStatuses), stays("check_in", 1, arrivalStatuses),
    stays("check_out", -1, departureStatuses), stays("check_out", 0, departureStatuses), stays("check_out", 1, departureStatuses),
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  const asStays = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, id: num(r.id), balance_cents: num(r.balance_cents), version: num(r.version), adults: num(r.adults), children: num(r.children) })) as DashboardData["arrivals"]["today"];
  const h = hk.rows[0] ?? {};
  const data: DashboardData = {
    today: hotelToday(),
    totalRooms: num(rooms.rows[0]?.total),
    roomTypes: ((rooms.rows[0]?.types as string[] | undefined) ?? []).filter(Boolean).sort(),
    notes: notes.rows.map((n) => ({ id: num(n.id), body: String(n.body), color: String(n.color ?? "yellow") })),
    arrivals: { yesterday: asStays(aY.rows), today: asStays(aT.rows), tomorrow: asStays(aM.rows) },
    departures: { yesterday: asStays(dY.rows), today: asStays(dT.rows), tomorrow: asStays(dM.rows) },
    recent: recent.rows.map((r) => ({ ...r, id: num(r.id), created_at: num(r.created_at) })) as DashboardData["recent"],
    rooms: roomState.rows.map((r) => ({ ...r, id: num(r.id), booking_id: r.booking_id ? num(r.booking_id) : null })) as DashboardData["rooms"],
    balances: balances.rows.map((b) => ({ ...b, id: num(b.id), balance_cents: num(b.balance_cents) })) as DashboardData["balances"],
    paymentsToday: num(payments.rows[0]?.net_cents),
    housekeeping: { todo: num(h.todo), inProgress: num(h.in_progress), review: num(h.review), ooo: num(h.ooo), openDefects: num(h.open_defects) },
    notifications,
  };
  return (
    <section className="dashboardPage">
      <div className="pageTitle"><div><h1>{t("dash.title")}</h1><p>{t("dash.welcome", { name: user.displayName })}</p></div><DashboardRefresh label={t("dash.autoRefresh")} button={t("dash.refreshNow")} /></div>
      {failures.length > 0 && <p role="alert" className="notice">{t("dash.partialFailure")} <small>({[...new Set(failures)].join(", ")})</small> <a href="/api/pms/diagnostics" target="_blank" rel="noopener noreferrer">{t("dash.diagnostics")}</a></p>}
      <WidgetDashboard
        lang={lang}
        data={data}
        initialLayout={normalizeLayout(layout.rows[0]?.layout_json ?? null)}
        can={{ editNotes: can(user.role, "dashboard.write", user.permissions), editStays: can(user.role, "reservations.edit", user.permissions), createReservation: can(user.role, "reservations.create", user.permissions), financial, housekeeping: can(user.role, "housekeeping.read", user.permissions) }}
      />
    </section>
  );
}
