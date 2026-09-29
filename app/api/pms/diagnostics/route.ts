import {requireApiUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {publicAvailability} from "@/lib/public-rate";

export const dynamic="force-dynamic";

const checks=[
 {name:"dashboard_notes",table:"pms_dashboard_notes",columns:["owner_id","body","updated_at"]},
 {name:"notifications",table:"pms_notification_reads",columns:["owner_id","notification_key"]},
 {name:"bookings",table:"bookings",columns:["owner_id","check_in","check_out","room_id","balance_cents","guest_name","status"]},
 {name:"booking_messages",table:"booking_messages",columns:["owner_id","booking_id","sender","created_at"]},
 {name:"rooms",table:"rooms",columns:["owner_id","code","room_type","operational_status","active"]},
 {name:"housekeeping",table:"housekeeping_tasks",columns:["owner_id","room_id","status","task_type","assigned_to"]},
 {name:"extras",table:"extras",columns:["owner_id","name_el","name","price_cents","pricing_mode","active","sort_order"]},
 {name:"payment_holds",table:"booking_sessions",columns:["owner_id","status","recovery_due_at"]},
 {name:"folio",table:"folio_entries",columns:["owner_id","entry_type","amount_cents","created_at"]},
] as const;

const dashboardQueries=[
 {name:"dashboard_1",sql:`SELECT id,body FROM pms_dashboard_notes WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 30`},
 {name:"dashboard_2",sql:`SELECT 'message-'||m.id AS key,'Νέο μήνυμα κράτησης '||b.reference AS title,m.created_at FROM booking_messages m JOIN bookings b ON b.id=m.booking_id AND b.owner_id=m.owner_id LEFT JOIN pms_notification_reads r ON r.owner_id=m.owner_id AND r.notification_key='message-'||m.id WHERE m.owner_id=$1 AND m.sender='guest' AND r.notification_key IS NULL ORDER BY m.created_at DESC LIMIT 20`},
 {name:"dashboard_3",sql:`SELECT 'arrival-'||id AS key,'Άφιξη σήμερα: '||guest_name AS title,created_at FROM bookings b LEFT JOIN pms_notification_reads r ON r.owner_id=b.owner_id AND r.notification_key='arrival-'||b.id WHERE b.owner_id=$1 AND b.check_in=(now() AT TIME ZONE 'Europe/Athens')::date::text AND b.status='confirmed' AND r.notification_key IS NULL`},
 {name:"dashboard_4",sql:`SELECT
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_in=(now() AT TIME ZONE 'Europe/Athens')::date::text AND status IN ('confirmed','checked_in')) AS arrivals_today,
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_out=(now() AT TIME ZONE 'Europe/Athens')::date::text AND status IN ('confirmed','checked_in','checked_out')) AS departures_today,
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_in=((now() AT TIME ZONE 'Europe/Athens')::date+1)::text AND status='confirmed') AS arrivals_tomorrow,
 (SELECT count(*) FROM bookings WHERE owner_id=$1 AND check_out=((now() AT TIME ZONE 'Europe/Athens')::date+1)::text AND status IN ('confirmed','checked_in')) AS departures_tomorrow,
 (SELECT count(DISTINCT room_id) FROM bookings WHERE owner_id=$1 AND check_in<=(now() AT TIME ZONE 'Europe/Athens')::date::text AND check_out>(now() AT TIME ZONE 'Europe/Athens')::date::text AND status IN ('confirmed','checked_in')) AS occupied,
 (SELECT count(*) FROM rooms WHERE owner_id=$1 AND active=1) AS total_rooms`},
 {name:"dashboard_5",sql:`SELECT id,guest_name,check_in,check_out,status,reference FROM bookings WHERE owner_id=$1 AND check_in>=(now() AT TIME ZONE 'Europe/Athens')::date::text AND status IN ('confirmed','checked_in') ORDER BY check_in,created_at DESC LIMIT 10`},
 {name:"dashboard_6",sql:`SELECT d.day::text AS day,count(DISTINCT b.room_id)::int AS occupied FROM generate_series((now() AT TIME ZONE 'Europe/Athens')::date,(now() AT TIME ZONE 'Europe/Athens')::date+6,interval '1 day') AS d(day) LEFT JOIN bookings b ON b.owner_id=$1 AND b.check_in::date<=d.day::date AND b.check_out::date>d.day::date AND b.status IN ('confirmed','checked_in') GROUP BY d.day ORDER BY d.day`},
 {name:"dashboard_7",sql:`SELECT id,guest_name,check_in,check_out,status,reference FROM bookings WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10`},
 {name:"dashboard_8",sql:`SELECT d.day::text AS day, count(DISTINCT b.id) FILTER(WHERE b.check_in::date=d.day::date)::int AS arrivals, count(DISTINCT b.id) FILTER(WHERE b.check_out::date=d.day::date)::int AS departures, count(DISTINCT b.room_id) FILTER(WHERE b.check_in::date<=d.day::date AND b.check_out::date>d.day::date)::int AS occupied FROM generate_series((now() AT TIME ZONE 'Europe/Athens')::date,(now() AT TIME ZONE 'Europe/Athens')::date+13,interval '1 day') AS d(day) LEFT JOIN bookings b ON b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in::date<=d.day::date AND b.check_out::date>=d.day::date GROUP BY d.day ORDER BY d.day`},
 {name:"dashboard_9",sql:`SELECT b.id,b.reference,b.guest_name,r.code room_code,b.check_in,b.check_out,b.status,b.balance_cents FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.check_in=(now() AT TIME ZONE 'Europe/Athens')::date::text AND b.status IN ('confirmed','checked_in') ORDER BY r.code,b.guest_name`},
 {name:"dashboard_10",sql:`SELECT b.id,b.reference,b.guest_name,r.code room_code,b.check_in,b.check_out,b.status,b.balance_cents FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.check_out=(now() AT TIME ZONE 'Europe/Athens')::date::text AND b.status IN ('confirmed','checked_in','checked_out') ORDER BY r.code,b.guest_name`},
 {name:"dashboard_11",sql:`SELECT r.id,r.code,r.room_type,r.operational_status,b.guest_name,b.id booking_id,b.balance_cents FROM rooms r LEFT JOIN LATERAL (SELECT id,guest_name,balance_cents FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=(now() AT TIME ZONE 'Europe/Athens')::date::text AND b.check_out>(now() AT TIME ZONE 'Europe/Athens')::date::text ORDER BY b.id DESC LIMIT 1) b ON true WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`},
 {name:"dashboard_12",sql:`SELECT id,reference,guest_name,check_in,check_out,status,balance_cents FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in') AND balance_cents>0 ORDER BY check_out LIMIT 50`},
 {name:"dashboard_13",sql:`SELECT id,name_el,name,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id LIMIT 30`},
 {name:"dashboard_14",sql:`SELECT t.id,r.code room_code,t.status,t.task_type,t.assigned_to FROM housekeeping_tasks t JOIN rooms r ON r.id=t.room_id AND r.owner_id=t.owner_id WHERE t.owner_id=$1 AND t.status NOT IN ('ready','completed') ORDER BY t.id DESC LIMIT 30`},
 {name:"dashboard_15",sql:`SELECT count(*)::int AS total FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>(extract(epoch from now())*1000)::bigint`},
 {name:"dashboard_16",sql:`SELECT COALESCE(sum(CASE WHEN entry_type IN ('payment','refund') THEN -amount_cents ELSE 0 END),0)::bigint AS net_cents FROM folio_entries WHERE owner_id=$1 AND created_at>=(extract(epoch from ((now() AT TIME ZONE 'Europe/Athens')::date AT TIME ZONE 'Europe/Athens'))*1000)::bigint AND created_at<(extract(epoch from (((now() AT TIME ZONE 'Europe/Athens')::date+1) AT TIME ZONE 'Europe/Athens'))*1000)::bigint`}
] as const;

const availabilityQueries=[
 {name:"availability_1",sql:`SELECT r.id,r.code,r.room_type,r.capacity,r.description,r.base_rate_cents,r.amenities,r.images,c.name_el,c.name_en,c.description_el,c.description_en,c.name_translations_json,c.description_translations_json
      FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id AND c.owner_id=r.owner_id
      WHERE r.owner_id=$1 AND r.active=1 AND r.operational_status<>'out_of_order' AND r.capacity >= $4
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status NOT IN ('cancelled','checked_out','no_show') AND b.check_in<$3 AND b.check_out>$2)
      AND NOT EXISTS(SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>$5 AND s.check_in<$3 AND s.check_out>$2 AND s.room_allocations::jsonb @> jsonb_build_array(r.id))
      ORDER BY COALESCE(c.display_order,999),r.code`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId,date,next,2,Date.now()]},
 {name:"availability_2",sql:`SELECT plan_key,name,name_translations_json,adjustment_percent,payment_policy FROM rate_plans WHERE owner_id=$1 AND active=1 ORDER BY CASE plan_key WHEN 'flexible' THEN 1 WHEN 'direct_web' THEN 2 ELSE 3 END`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId]},
 {name:"availability_3",sql:`SELECT start_date,end_date,free_cancellation_days FROM cancellation_policies WHERE owner_id=$1 AND start_date<=$2 AND end_date>=$2 ORDER BY updated_at DESC LIMIT 1`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId,date]},
 {name:"availability_4",sql:`SELECT id,code,name,name_el,name_en,description,description_el,description_en,name_translations_json,description_translations_json,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId]},
 {name:"availability_5",sql:`SELECT id,name,name_el,name_en,name_translations_json,category,amount_cents,calculation_mode FROM mandatory_charges WHERE owner_id=$1 AND active=1 AND (valid_from IS NULL OR valid_from<=$3) AND (valid_to IS NULL OR valid_to>=$2) ORDER BY id`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId,date,next]},
 {name:"availability_6",sql:`SELECT room_type,starts_on,ends_on,price_cents,minimum_stay,maximum_stay,closed,closed_to_arrival,closed_to_departure FROM rate_rules WHERE owner_id=$1 AND starts_on<$3 AND ends_on>=$2`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId,date,next]},
 {name:"availability_7",sql:`SELECT starts_on,ends_on,adjustment_type,adjustment_value,operation,weekdays,room_codes,rate_plan_keys,minimum_stay,priority FROM special_prices WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY priority,id`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId,date,next]},
 {name:"availability_8",sql:`SELECT starts_on,ends_on,minimum_stay,maximum_stay,closed_arrival_weekdays,closed_departure_weekdays,room_codes,rate_plan_keys,priority FROM booking_restrictions WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY priority,id`,values:(user:{ownerId:string},date:string,next:string)=>[user.ownerId,date,next]}
] as const;

export async function GET(){
 const user=await requireApiUser("dashboard.read");if(user instanceof Response)return user;
 try{
  const result=await db().query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,[checks.map(c=>c.table)]);
  const actual=new Set(result.rows.map(r=>`${r.table_name}.${r.column_name}`));
  const missing=checks.flatMap(check=>check.columns.filter(column=>!actual.has(`${check.table}.${column}`)).map(column=>`${check.name}.${column}`));
  const failed:{area:string;code:string}[]=[];
  for(const check of dashboardQueries){
   try{await db().query(check.sql,[user.ownerId])}
   catch(error){const code=typeof error==="object"&&error!==null&&"code" in error?String(error.code):"QUERY_FAILED";failed.push({area:check.name,code});console.error("PMS diagnostic query failed",check.name,error)}
  }
  try{const date=new Date(Date.now()+86400000).toISOString().slice(0,10);const next=new Date(Date.now()+172800000).toISOString().slice(0,10);
   for(const check of availabilityQueries){try{await db().query(check.sql,check.values(user,date,next))}catch(error){const code=typeof error==="object"&&error!==null&&"code" in error?String(error.code):"QUERY_FAILED";failed.push({area:check.name,code});console.error("PMS diagnostic availability query failed",check.name,error)}}
   if(!failed.some(item=>item.area.startsWith("availability_")))await publicAvailability({ownerId:user.ownerId,checkIn:date,checkOut:next,adults:2,children:0,rooms:1,lang:"en"})}
  catch(error){const code=typeof error==="object"&&error!==null&&"code" in error?String(error.code):error instanceof Error&&["INVALID_ROOM_PRICE","INVALID_DATES"].includes(error.message)?error.message:error instanceof TypeError?"DATA_PROCESSING_TYPE_ERROR":"AVAILABILITY_FAILED";failed.push({area:"availability",code});console.error("PMS diagnostic availability failed",error)}
  return Response.json({ok:missing.length===0&&failed.length===0,version:"v46",area:"pms_and_booking",missing,failed,activeRooms:Number((await db().query("SELECT count(*)::int AS total FROM rooms WHERE owner_id=$1 AND active=1",[user.ownerId])).rows[0]?.total??0)},{status:missing.length||failed.length?503:200,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){console.error("PMS dashboard diagnostic failed",e);return Response.json({ok:false,area:"pms_dashboard",error:"DATABASE_CHECK_FAILED"},{status:503,headers:{"Cache-Control":"private, no-store"}})}
}
