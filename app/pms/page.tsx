import { requireUser } from "@/lib/auth";
import {db} from "@/lib/db";
import {can} from "@/lib/security/permissions";
import {getPmsT} from "@/lib/pms-lang";
import {loadNotifications,type FeedItem} from "@/lib/pms-notification-feed";
import {dailyOccupancy,type DayOccupancy} from "@/lib/occupancy";
import {hotelToday} from "@/lib/tape-chart";
import {Dashboard} from "./dashboard";
import {FrontDeskPanels} from "./front-desk-panels";
import {DashboardRefresh} from "./dashboard-refresh";

const stayColumns=`b.id,b.reference,b.guest_name,r.code room_code,b.check_in,b.check_out,b.status,b.balance_cents,b.version`;
const hotelDay=(offset:number)=>`((now() AT TIME ZONE 'Europe/Athens')::date+${offset})::text`;

export default async function PmsPage() {
  const user = await requireUser("dashboard.read");
  const {lang,t}=await getPmsT();
  const failures:string[]=[];
  const query=(sql:string,values:unknown[])=>db().query(sql,values).catch(error=>{const tag=sql.slice(0,90).replaceAll(/\s+/g," ");console.error("PMS dashboard query failed",tag,error);failures.push(tag);return {rows:[]}});
  const guard=<T,>(work:Promise<T>,fallback:T,tag:string)=>work.catch(error=>{console.error("PMS dashboard query failed",tag,error);failures.push(tag);return fallback});
  const today=hotelToday();
  const financial=can(user.role,"folios.read",user.permissions);
  const [notes,counts,bookings,forecast,recent,notifications,arrivalsToday,departuresToday,arrivalsTomorrow,departuresTomorrow,roomState,outstanding,services,tasks,holds,paymentsToday]=await Promise.all([
    query(`SELECT id,body FROM pms_dashboard_notes WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 30`,[user.ownerId]),
    query(`SELECT
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_in=${hotelDay(0)} AND status IN ('confirmed','checked_in')) AS arrivals_today,
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_out=${hotelDay(0)} AND status IN ('confirmed','checked_in','checked_out')) AS departures_today,
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_in=${hotelDay(1)} AND status='confirmed') AS arrivals_tomorrow,
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_out=${hotelDay(1)} AND status IN ('confirmed','checked_in')) AS departures_tomorrow,
 (SELECT count(DISTINCT room_id) FROM bookings WHERE owner_id=$1 AND check_in<=${hotelDay(0)} AND check_out>${hotelDay(0)} AND status IN ('confirmed','checked_in')) AS occupied,
 (SELECT count(*) FROM rooms WHERE owner_id=$1 AND active=1) AS total_rooms`,[user.ownerId]),
    query(`SELECT id,guest_name,check_in,check_out,status,reference FROM bookings WHERE owner_id=$1 AND check_in>=${hotelDay(0)} AND status IN ('confirmed','checked_in') ORDER BY check_in,created_at DESC LIMIT 10`,[user.ownerId]),
    guard<DayOccupancy[]>(dailyOccupancy(user.ownerId,today,30),[],"forecast"),
    query(`SELECT id,guest_name,check_in,check_out,status,reference FROM bookings WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10`,[user.ownerId]),
    guard<FeedItem[]>(loadNotifications(user.ownerId,lang),[],"notifications"),
    query(`SELECT ${stayColumns} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.check_in=${hotelDay(0)} AND b.status IN ('confirmed','checked_in') ORDER BY r.code,b.guest_name`,[user.ownerId]),
    query(`SELECT ${stayColumns} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.check_out=${hotelDay(0)} AND b.status IN ('confirmed','checked_in','checked_out') ORDER BY r.code,b.guest_name`,[user.ownerId]),
    query(`SELECT ${stayColumns} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.check_in=${hotelDay(1)} AND b.status='confirmed' ORDER BY r.code,b.guest_name`,[user.ownerId]),
    query(`SELECT ${stayColumns} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.check_out=${hotelDay(1)} AND b.status IN ('confirmed','checked_in') ORDER BY r.code,b.guest_name`,[user.ownerId]),
    query(`SELECT r.id,r.code,r.room_type,r.operational_status,b.guest_name,b.id booking_id,b.balance_cents FROM rooms r LEFT JOIN LATERAL (SELECT id,guest_name,balance_cents FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=${hotelDay(0)} AND b.check_out>${hotelDay(0)} ORDER BY b.id DESC LIMIT 1) b ON true WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,[user.ownerId]),
    financial?query(`SELECT id,reference,guest_name,check_in,check_out,status,balance_cents FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in') AND balance_cents>0 ORDER BY check_out LIMIT 50`,[user.ownerId]):Promise.resolve({rows:[]}),
    query(`SELECT id,name_el,name_en,name,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id LIMIT 30`,[user.ownerId]),
    query(`SELECT t.id,r.code room_code,t.status,t.task_type,t.assigned_to FROM housekeeping_tasks t JOIN rooms r ON r.id=t.room_id AND r.owner_id=t.owner_id WHERE t.owner_id=$1 AND t.status NOT IN ('ready','completed') ORDER BY t.id DESC LIMIT 30`,[user.ownerId]),
    query(`SELECT count(*)::int AS total FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>(extract(epoch from now())*1000)::bigint`,[user.ownerId]),
    financial?query(`SELECT COALESCE(sum(CASE WHEN entry_type IN ('payment','refund') THEN -amount_cents ELSE 0 END),0)::bigint AS net_cents FROM folio_entries WHERE owner_id=$1 AND created_at>=(extract(epoch from ((now() AT TIME ZONE 'Europe/Athens')::date AT TIME ZONE 'Europe/Athens'))*1000)::bigint AND created_at<(extract(epoch from (((now() AT TIME ZONE 'Europe/Athens')::date+1) AT TIME ZONE 'Europe/Athens'))*1000)::bigint`,[user.ownerId]):Promise.resolve({rows:[{net_cents:0}]})
  ]);
  const c=counts.rows[0]??{};
  const totalRooms=Number(c.total_rooms??0);
  return <section><p className="eyebrow">{t("dash.eyebrow")}</p><h1>{t("dash.title")}</h1><p>{t("dash.welcome",{name:user.displayName})}</p><DashboardRefresh label={t("dash.autoRefresh")} button={t("dash.refreshNow")}/>{failures.length>0&&<p role="alert" className="notice">{t("dash.partialFailure")} <a href="/api/pms/diagnostics" target="_blank" rel="noopener noreferrer">{t("dash.diagnostics")}</a></p>}
    <Dashboard lang={lang} today={today} canCreateReservation={can(user.role,"reservations.create",user.permissions)} canEditNotes={can(user.role,"dashboard.write",user.permissions)} initialNotes={notes.rows} initialNotifications={notifications} bookings={bookings.rows} recent={recent.rows} forecast={forecast} counts={{arrivalsToday:Number(c.arrivals_today??0),departuresToday:Number(c.departures_today??0),arrivalsTomorrow:Number(c.arrivals_tomorrow??0),departuresTomorrow:Number(c.departures_tomorrow??0),occupied:Number(c.occupied??0),totalRooms}}/>
    <FrontDeskPanels lang={lang} canEdit={can(user.role,"reservations.edit",user.permissions)} stays={{today:{arrivals:arrivalsToday.rows,departures:departuresToday.rows},tomorrow:{arrivals:arrivalsTomorrow.rows,departures:departuresTomorrow.rows}}} rooms={roomState.rows} balances={outstanding.rows} services={services.rows.map(row=>({...row,name:String((lang==="en"?row.name_en:row.name_el)||row.name)}))} tasks={tasks.rows} holds={Number(holds.rows[0]?.total??0)} paymentsToday={Number(paymentsToday.rows[0]?.net_cents??0)} showFinancial={financial}/></section>;
}
