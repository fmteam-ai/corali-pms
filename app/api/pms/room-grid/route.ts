import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request){
  const user=await requireApiUser("rooms.read"); if(user instanceof Response)return user;
  const url=new URL(request.url); const start=url.searchParams.get("start")??new Date().toISOString().slice(0,10); const days=Math.min(62,Math.max(7,Number(url.searchParams.get("days")??31)));
  const end=new Date(`${start}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+days); const endText=end.toISOString().slice(0,10);
  const [rooms,bookings]=await Promise.all([
    db().query(`SELECT id,code,room_type,capacity,operational_status FROM rooms WHERE owner_id=$1 AND active=1 ORDER BY code`,[user.ownerId]),
    db().query(`SELECT id,reference,guest_name,room_id,check_in,check_out,status,total_cents,balance_cents,version FROM bookings WHERE owner_id=$1 AND room_id IS NOT NULL AND status NOT IN ('cancelled','no_show') AND check_in<$3 AND check_out>$2 ORDER BY check_in`,[user.ownerId,start,endText]),
  ]);
  return Response.json({ok:true,start,end:endText,days,rooms:rooms.rows,bookings:bookings.rows});
}
