import { audited } from "@/lib/audit";
import {z} from "zod";
import {requireApiUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {env} from "@/lib/env";
import {assertTrustedOrigin} from "@/lib/security/origin";
import {providerCredentials} from "@/lib/provider-connections";
const input=z.object({providerKey:z.enum(["booking_com","expedia","airbnb","other"]),name:z.string().min(2).max(100),propertyCode:z.string().max(120),endpoint:z.union([z.url(),z.literal("")]),active:z.boolean()});
function capabilities(){const e=env();return{stripe:Boolean(e.STRIPE_SECRET_KEY&&e.STRIPE_WEBHOOK_SECRET),viva:Boolean(e.VIVA_CLIENT_ID&&e.VIVA_CLIENT_SECRET),whatsapp:Boolean(e.WHATSAPP_ACCESS_TOKEN&&e.WHATSAPP_PHONE_NUMBER_ID),email:Boolean(e.SMTP_HOST&&e.SMTP_USERNAME&&e.SMTP_PASSWORD),mydata:Boolean(e.MYDATA_PROVIDER_TOKEN),channelManager:Boolean(e.CHANNEL_MANAGER_API_KEY),ai:Boolean(e.OPENAI_API_KEY)}}
export async function GET(){const u=await requireApiUser("integrations.read");if(u instanceof Response)return u;const r=await db().query(`SELECT provider_key,name,status,active,connection_method,property_code,provider_endpoint,updated_at FROM channel_connections WHERE owner_id=$1 ORDER BY name`,[u.ownerId]);return Response.json({ok:true,capabilities:capabilities(),channels:r.rows})}
async function handlePOST(request:Request){const u=await requireApiUser("integrations.write");if(u instanceof Response)return u;try{assertTrustedOrigin(request);const x=input.parse(await request.json()),now=Date.now();const provider=await providerCredentials(u.ownerId,"channelManager");const ready=Boolean((provider?provider.active&&provider.secrets.apiKey:env().CHANNEL_MANAGER_API_KEY)&&x.propertyCode&&x.endpoint);if(x.active&&!ready)return Response.json({ok:false,error:"CHANNEL_CREDENTIALS_REQUIRED"},{status:409});await db().query(`INSERT INTO channel_connections(owner_id,provider_key,name,connection_type,status,capabilities,active,connection_method,property_code,provider_endpoint,created_at,updated_at) VALUES($1,$2,$3,'ota',$4,'["reservations","rates","availability"]',$5,'channel_manager',$6,$7,$8,$8) ON CONFLICT(owner_id,provider_key) DO UPDATE SET name=$3,status=$4,active=$5,property_code=$6,provider_endpoint=$7,updated_at=$8`,[u.ownerId,x.providerKey,x.name,ready?"configured":"planned",x.active?1:0,x.propertyCode,x.endpoint,now]);return Response.json({ok:true,status:ready?"configured":"planned"})}catch(e){return Response.json({ok:false,error:e instanceof z.ZodError?"INVALID_INPUT":"SAVE_FAILED"},{status:400})}}

export const POST = audited("integration", handlePOST);
