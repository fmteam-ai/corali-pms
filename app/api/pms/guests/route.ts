import { audited } from "@/lib/audit";
import {z} from "zod";
import {requireApiUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {assertTrustedOrigin} from "@/lib/security/origin";
const input=z.object({email:z.email(),preferences:z.string().max(3000)});
export async function GET(request:Request){const u=await requireApiUser("reservations.read");if(u instanceof Response)return u;const q=new URL(request.url).searchParams.get("q")?.trim()??"";const r=await db().query(`SELECT lower(b.guest_email) email,max(b.guest_name) guest_name,max(b.guest_phone) guest_phone,max(b.guest_country) guest_country,count(*)::int stays,COALESCE(sum(b.total_cents),0)::bigint lifetime_cents,max(b.check_out) last_stay,COALESCE(p.preferences,'') preferences FROM bookings b LEFT JOIN guest_preferences p ON p.owner_id=b.owner_id AND p.email=lower(b.guest_email) WHERE b.owner_id=$1 AND b.guest_email IS NOT NULL AND b.guest_email<>'' AND ($2='' OR b.guest_name ILIKE '%'||$2||'%' OR b.guest_email ILIKE '%'||$2||'%') GROUP BY lower(b.guest_email),p.preferences ORDER BY max(b.check_out) DESC`,[u.ownerId,q]);return Response.json({ok:true,guests:r.rows})}
async function handlePOST(request:Request){const u=await requireApiUser("reservations.write");if(u instanceof Response)return u;try{assertTrustedOrigin(request);const x=input.parse(await request.json());await db().query(`INSERT INTO guest_preferences(owner_id,email,preferences,updated_by,updated_at) VALUES($1,lower($2),$3,$4,$5) ON CONFLICT(owner_id,email) DO UPDATE SET preferences=$3,updated_by=$4,updated_at=$5`,[u.ownerId,x.email,x.preferences,String(u.id),Date.now()]);return Response.json({ok:true})}catch(e){return Response.json({ok:false,error:e instanceof z.ZodError?"INVALID_INPUT":"SAVE_FAILED"},{status:400})}}

export const POST = audited("guest", handlePOST);
