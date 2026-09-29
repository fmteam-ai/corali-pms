import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getReservation } from "@/lib/reservations";
import { validReservationTransition } from "@/lib/reservation-transition";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { z } from "zod";

const updateSchema = z.object({
  version: z.number().int().positive(),
  action: z.enum(["move", "check_in", "check_out", "cancel", "confirm", "no_show"]),
  roomId: z.number().int().positive().nullable().optional(),
  checkIn: z.iso.date().optional(),
  checkOut: z.iso.date().optional(),
});

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser("reservations.read"); if (user instanceof Response) return user;
  const id = Number((await context.params).id); if (!Number.isSafeInteger(id) || id < 1) return Response.json({ok:false,error:"INVALID_ID"},{status:400});
  const reservation = await getReservation(user.ownerId,id);
  return reservation ? Response.json({ok:true,...reservation}) : Response.json({ok:false,error:"NOT_FOUND"},{status:404});
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser("reservations.edit"); if (user instanceof Response) return user;
  try {
    assertTrustedOrigin(request);
    const id = Number((await context.params).id); const input = updateSchema.parse(await request.json()); const now=Date.now();
    const updated = await withTransaction(async (client) => {
      const locked=await client.query("SELECT * FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE",[user.ownerId,id]); const before=locked.rows[0];
      if(!before) throw new Error("NOT_FOUND"); if(Number(before.version)!==input.version) throw new Error("VERSION_CONFLICT");
      if (!validReservationTransition(String(before.status), input.action)) throw new Error("INVALID_TRANSITION");
      const next={roomId:input.roomId===undefined?before.room_id:input.roomId,checkIn:input.checkIn??before.check_in,checkOut:input.checkOut??before.check_out,status:before.status,checkedInAt:before.checked_in_at,checkedOutAt:before.checked_out_at};
      if(next.checkOut<=next.checkIn) throw new Error("INVALID_DATES");
      if (next.roomId) {
        await client.query("SELECT pg_advisory_xact_lock($1)", [next.roomId]);
        const room = await client.query("SELECT operational_status FROM rooms WHERE owner_id=$1 AND id=$2 AND active=1", [user.ownerId,next.roomId]);
        if (!room.rowCount) throw new Error("INVALID_ROOM");
        if (input.action==="move" && Number(next.roomId)!==Number(before.room_id) && room.rows[0].operational_status==="out_of_order") throw new Error("ROOM_OUT_OF_ORDER");
      }
      if(input.action==="check_in"){next.status="checked_in";next.checkedInAt=now;} if(input.action==="check_out"){next.status="checked_out";next.checkedOutAt=now;} if(input.action==="cancel")next.status="cancelled"; if(input.action==="no_show")next.status="no_show"; if(input.action==="confirm")next.status="confirmed";
      if(next.roomId && !["cancelled","checked_out","no_show"].includes(next.status)){
        const conflict=await client.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND id<>$3 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$5 AND check_out>$4
          UNION ALL SELECT 1 FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>$6 AND check_in<$5 AND check_out>$4 AND room_allocations::jsonb @> $7::jsonb LIMIT 1`,[user.ownerId,next.roomId,id,next.checkIn,next.checkOut,now,JSON.stringify([next.roomId])]);
        if(conflict.rowCount) throw new Error("ROOM_UNAVAILABLE");
      }
      const result=await client.query(`UPDATE bookings SET room_id=$1,check_in=$2,check_out=$3,status=$4,checked_in_at=$5,checked_out_at=$6,version=version+1 WHERE owner_id=$7 AND id=$8 AND version=$9 RETURNING *`,[next.roomId,next.checkIn,next.checkOut,next.status,next.checkedInAt,next.checkedOutAt,user.ownerId,id,input.version]);
      if(!result.rowCount) throw new Error("VERSION_CONFLICT");
      await client.query(`INSERT INTO reservation_audit(owner_id,booking_id,actor_id,action,before_json,after_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[user.ownerId,id,String(user.id),input.action,JSON.stringify(before),JSON.stringify(result.rows[0]),now]);
      if(input.action==="check_out" && next.roomId) await client.query(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,assigned_to,due_at,checklist_json,inspection_status) VALUES($1,$2,'departure_clean','todo',(SELECT staff_user_id::text FROM housekeeping_staff_room_defaults WHERE owner_id=$1 AND room_id=$2 ORDER BY staff_user_id LIMIT 1),$3,'{}','pending')`,[user.ownerId,next.roomId,now]);
      return result.rows[0];
    });
    return Response.json({ok:true,booking:updated});
  } catch(error){
    if(error instanceof z.ZodError || (error instanceof Error && error.message==="INVALID_DATES")) return Response.json({ok:false,error:"INVALID_INPUT"},{status:400});
    if(error instanceof Error && error.message==="NOT_FOUND") return Response.json({ok:false,error:"NOT_FOUND"},{status:404});
    if(error instanceof Error && error.message==="INVALID_ROOM") return Response.json({ok:false,error:"INVALID_ROOM"},{status:400});
    if(error instanceof Error && ["VERSION_CONFLICT","ROOM_UNAVAILABLE","ROOM_OUT_OF_ORDER","INVALID_TRANSITION"].includes(error.message)) return Response.json({ok:false,error:error.message},{status:409});
    return Response.json({ok:false,error:"UPDATE_FAILED"},{status:500});
  }
}
