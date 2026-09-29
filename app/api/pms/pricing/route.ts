import { audited } from "@/lib/audit";
import { pricingSnapshot } from "@/lib/audit-snapshots";
import {z} from "zod";
import {forbidden,requireApiUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {can} from "@/lib/security/permissions";
import {assertTrustedOrigin} from "@/lib/security/origin";
const schema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("plan"),key:z.string().regex(/^[a-z0-9_]{2,50}$/),name:z.string().trim().min(2).max(80),adjustmentPercent:z.number().int().min(-90).max(500),active:z.boolean(),isNew:z.boolean().default(false)}),
 z.object({kind:z.literal("cancellation"),id:z.number().int().positive().optional(),startDate:z.iso.date(),endDate:z.iso.date(),freeCancellationDays:z.number().int().min(0).max(365)}).refine(v=>v.endDate>=v.startDate),
 z.object({kind:z.literal("charge"),id:z.number().int().positive().optional(),name:z.string().min(2).max(120),amountCents:z.number().int().min(0),calculationMode:z.enum(["per_booking","per_night","per_room","per_person","per_room_night"]),active:z.boolean()}),
 z.object({kind:z.literal("base_rate"),roomId:z.number().int().positive(),amountCents:z.number().int().min(0).max(1_000_000_00)}),
]);
export async function GET(){const u=await requireApiUser("pricing.read");if(u instanceof Response)return u;const [plans,policies,charges,rooms]=await Promise.all([db().query(`SELECT plan_key,name,adjustment_percent,active FROM rate_plans WHERE owner_id=$1 ORDER BY plan_key`,[u.ownerId]),db().query(`SELECT id,start_date,end_date,free_cancellation_days FROM cancellation_policies WHERE owner_id=$1 ORDER BY start_date`,[u.ownerId]),db().query(`SELECT id,name,amount_cents,calculation_mode,active FROM mandatory_charges WHERE owner_id=$1 ORDER BY id`,[u.ownerId]),db().query(`SELECT id,code,room_type,base_rate_cents FROM rooms WHERE owner_id=$1 ORDER BY code`,[u.ownerId])]);return Response.json({ok:true,plans:plans.rows,policies:policies.rows,charges:charges.rows,rooms:rooms.rows})}
async function handlePOST(request:Request){const u=await requireApiUser("pricing.read");if(u instanceof Response)return u;try{assertTrustedOrigin(request);const i=schema.parse(await request.json()),now=Date.now(),permission=i.kind==="plan"?(i.isNew?"pricing.create":"pricing.edit"):i.kind==="base_rate"?"pricing.edit":i.id?"pricing.edit":"pricing.create";if(!can(u.role,permission,u.permissions))return forbidden(u,permission);let result;
 if(i.kind==="plan")result=await db().query(i.isNew?`INSERT INTO rate_plans(owner_id,plan_key,name,adjustment_percent,payment_policy,active,updated_at) VALUES($1,$2,$3,$4,'flexible',$5,$6) ON CONFLICT(owner_id,plan_key) DO NOTHING RETURNING id`:`UPDATE rate_plans SET name=$3,adjustment_percent=$4,active=$5,updated_at=$6 WHERE owner_id=$1 AND plan_key=$2 RETURNING id`,[u.ownerId,i.key,i.name,i.adjustmentPercent,i.active?1:0,now]);
 else if(i.kind==="cancellation")result=await db().query(i.id?`UPDATE cancellation_policies SET start_date=$1,end_date=$2,free_cancellation_days=$3,updated_at=$4 WHERE owner_id=$5 AND id=$6 RETURNING id`:`INSERT INTO cancellation_policies(start_date,end_date,free_cancellation_days,updated_at,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,i.id?[i.startDate,i.endDate,i.freeCancellationDays,now,u.ownerId,i.id]:[i.startDate,i.endDate,i.freeCancellationDays,now,u.ownerId]);
 else if(i.kind==="charge")result=await db().query(i.id?`UPDATE mandatory_charges SET name=$1,amount_cents=$2,calculation_mode=$3,active=$4 WHERE owner_id=$5 AND id=$6 RETURNING id`:`INSERT INTO mandatory_charges(name,amount_cents,calculation_mode,active,owner_id,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,i.id?[i.name,i.amountCents,i.calculationMode,i.active?1:0,u.ownerId,i.id]:[i.name,i.amountCents,i.calculationMode,i.active?1:0,u.ownerId,now]);
 else result=await db().query(`UPDATE rooms SET base_rate_cents=$1 WHERE owner_id=$2 AND id=$3 RETURNING id`,[i.amountCents,u.ownerId,i.roomId]);
 if(!result.rowCount)return Response.json({ok:false,error:i.kind==="plan"&&i.isNew?"ALREADY_EXISTS":"NOT_FOUND"},{status:i.kind==="plan"&&i.isNew?409:404});return Response.json({ok:true})
 }catch(e){return Response.json({ok:false,error:e instanceof z.ZodError?"INVALID_INPUT":"SAVE_FAILED"},{status:e instanceof z.ZodError?400:500})}}

export const POST = audited("pricing", handlePOST, { snapshot: pricingSnapshot });
