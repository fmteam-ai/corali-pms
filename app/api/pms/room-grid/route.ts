import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { roomNoticeSql } from "@/lib/maintenance-db";
import { addDays, hotelToday, housekeepingState, isIsoDate, nightsBetween } from "@/lib/tape-chart";

export async function GET(request: Request){
  const user=await requireApiUser("rooms.read"); if(user instanceof Response)return user;
  const url=new URL(request.url); const requested=url.searchParams.get("start"); const start=isIsoDate(requested)?requested:hotelToday();
  const requestedEnd=url.searchParams.get("end");
  const days=isIsoDate(requestedEnd)?Math.min(62,Math.max(1,nightsBetween(start,requestedEnd))):Math.min(62,Math.max(7,Number(url.searchParams.get("days"))||31));
  const endText=addDays(start,days);
  const [rooms,bookings]=await Promise.all([
    db().query(`SELECT r.id,r.code,r.room_type,r.capacity,r.operational_status,(SELECT t.status FROM housekeeping_tasks t WHERE t.owner_id=r.owner_id AND t.room_id=r.id AND t.status NOT IN ('ready') ORDER BY t.id DESC LIMIT 1) AS open_task_status,${roomNoticeSql} FROM rooms r WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,[user.ownerId]),
    db().query(`SELECT id,reference,guest_name,room_id,check_in,check_out,status,total_cents,balance_cents,version FROM bookings WHERE owner_id=$1 AND room_id IS NOT NULL AND status NOT IN ('cancelled','no_show') AND check_in<$3 AND check_out>$2 ORDER BY check_in`,[user.ownerId,start,endText]),
  ]);
  let occupied=0;
  for(let i=0;i<days;i++){const date=addDays(start,i);occupied+=bookings.rows.filter(b=>b.check_in<=date&&b.check_out>date).length;}
  const occupancyPercent=rooms.rowCount?Math.round(occupied/(rooms.rows.length*days)*1000)/10:0;
  return Response.json({ok:true,start,end:endText,days,occupancyPercent,rooms:rooms.rows.map(r=>({...r,housekeeping_state:housekeepingState(r.operational_status,r.open_task_status)})),bookings:bookings.rows});
}
