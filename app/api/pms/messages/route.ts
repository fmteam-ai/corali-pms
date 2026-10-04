import { audited } from "@/lib/audit";
import {z} from "zod";
import {requireApiUser} from "@/lib/auth";
import {db,withTransaction} from "@/lib/db";
import {assertTrustedOrigin} from "@/lib/security/origin";
import {after} from "next/server";
import {emailGuestReply} from "@/lib/guest-message-auto";
const input=z.object({bookingId:z.number().int().positive(),body:z.string().trim().min(1).max(4000)});
export async function GET(){const u=await requireApiUser("reservations.read");if(u instanceof Response)return u;const r=await db().query(`SELECT m.id,m.booking_id,m.sender,m.body,m.read_at,m.email_notified,m.created_at,m.ai_generated,b.reference,b.guest_name,b.guest_email FROM booking_messages m JOIN bookings b ON b.owner_id=m.owner_id AND b.id=m.booking_id WHERE m.owner_id=$1 ORDER BY m.created_at DESC LIMIT 300`,[u.ownerId]);return Response.json({ok:true,messages:r.rows})}
async function handlePOST(request:Request){const u=await requireApiUser("reservations.write");if(u instanceof Response)return u;try{assertTrustedOrigin(request);const x=input.parse(await request.json());const row=await withTransaction(async c=>{const b=await c.query(`SELECT id FROM bookings WHERE owner_id=$1 AND id=$2`,[u.ownerId,x.bookingId]);if(!b.rowCount)throw Error("NOT_FOUND");const r=await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,$4,0,$4) RETURNING *`,[u.ownerId,x.bookingId,x.body,Date.now()]);await c.query(`UPDATE booking_messages SET read_at=COALESCE(read_at,$1) WHERE owner_id=$2 AND booking_id=$3 AND sender='guest'`,[Date.now(),u.ownerId,x.bookingId]);return r.rows[0]});after(()=>emailGuestReply(u.ownerId,x.bookingId,x.body).then(()=>undefined));return Response.json({ok:true,message:row},{status:201})}catch(e){const m=e instanceof Error?e.message:"";return Response.json({ok:false,error:m||"SEND_FAILED"},{status:m==="NOT_FOUND"?404:e instanceof z.ZodError?400:500})}}

export const POST = audited("guest_message", handlePOST);
