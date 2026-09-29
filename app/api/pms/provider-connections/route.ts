import { audited } from "@/lib/audit";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { providerFields, providerKeySchema } from "@/lib/provider-fields";
import { listProviders, providerCredentials, sealProviderSecrets, unsealProviderSecrets, validateProviderFields } from "@/lib/provider-connections";
import { testVivaCredentials, testWhatsAppCredentials } from "@/lib/provider-tests";

const saveInput = z.object({
  providerKey: providerKeySchema,
  active: z.boolean(),
  settings: z.record(z.string(),z.string()),
  secrets: z.record(z.string(),z.string()),
  clearSecrets: z.array(z.string()).default([]),
});
const testInput = z.object({providerKey: providerKeySchema});

export async function GET() {
  const user = await requireApiUser("integrations.read");
  if (user instanceof Response) return user;
  return Response.json({ok:true,providers:await listProviders(user.ownerId)});
}

async function handlePUT(request:Request) {
  const user = await requireApiUser("integrations.write");
  if (user instanceof Response) return user;
  try {
    assertTrustedOrigin(request);
    const input = saveInput.parse(await request.json());
    validateProviderFields(input.providerKey,input.settings,input.secrets);
    const fields = providerFields[input.providerKey];
    if (input.clearSecrets.some(key => !(fields.secrets as readonly string[]).includes(key))) throw new Error("INVALID_FIELDS");
    await withTransaction(async client => {
      const current = await client.query<{secrets_encrypted:string}>("SELECT secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key=$2 FOR UPDATE",[user.ownerId,input.providerKey]);
      const secrets = current.rows[0] ? unsealProviderSecrets(current.rows[0].secrets_encrypted) : {};
      for (const key of input.clearSecrets) delete secrets[key];
      for (const [key,value] of Object.entries(input.secrets)) if (value.trim()) secrets[key]=value.trim();
      const required:Record<string,{secrets:string[];settings:string[]}> = {
        stripe:{secrets:["secretKey","webhookSecret"],settings:[]},viva:{secrets:["clientId","clientSecret"],settings:["environment"]},
        whatsapp:{secrets:["accessToken","verifyToken","appSecret"],settings:["phoneNumberId","businessAccountId"]},
        smtp:{secrets:["password"],settings:["host","username","from"]},mydata:{secrets:["subscriptionKey"],settings:[]},
        meta:{secrets:["appSecret","pageAccessToken"],settings:["pageId"]},tiktok:{secrets:["clientSecret"],settings:["clientKey"]},
        channelManager:{secrets:["apiKey"],settings:["propertyCode"]},openai:{secrets:["apiKey"],settings:[]},
      };
      const needed=required[input.providerKey];
      if (input.active && (needed.secrets.some(key => !secrets[key])||needed.settings.some(key => !input.settings[key]))) throw new Error("CREDENTIALS_REQUIRED");
      const now=Date.now();
      await client.query(`INSERT INTO provider_connections(owner_id,provider_key,active,status,settings_json,secrets_encrypted,updated_by,updated_at)
        VALUES($1,$2,$3,'configured',$4,$5,$6,$7)
        ON CONFLICT(owner_id,provider_key) DO UPDATE SET active=$3,status='configured',settings_json=$4,secrets_encrypted=$5,updated_by=$6,updated_at=$7,last_test_at=NULL,last_test_result=NULL`,
        [user.ownerId,input.providerKey,input.active?1:0,JSON.stringify(input.settings),sealProviderSecrets(secrets),String(user.id),now]);
      await client.query("INSERT INTO provider_connection_audit(owner_id,provider_key,actor_id,action,created_at) VALUES($1,$2,$3,'settings_updated',$4)",[user.ownerId,input.providerKey,String(user.id),now]);
    });
    return Response.json({ok:true});
  } catch(error) {
    const code=error instanceof z.ZodError||error instanceof Error&&error.message==="INVALID_FIELDS"?"INVALID_INPUT":error instanceof Error&&error.message==="CREDENTIALS_REQUIRED"?"CREDENTIALS_REQUIRED":"SAVE_FAILED";
    return Response.json({ok:false,error:code},{status:code==="SAVE_FAILED"?500:400});
  }
}

async function handlePOST(request:Request) {
  const user = await requireApiUser("integrations.write");
  if (user instanceof Response) return user;
  try {
    assertTrustedOrigin(request);
    const {providerKey} = testInput.parse(await request.json());
    if (!["stripe","smtp","viva","whatsapp"].includes(providerKey)) return Response.json({ok:false,error:"TEST_NOT_AVAILABLE"},{status:501});
    const connection=await providerCredentials(user.ownerId,providerKey);
    if (!connection?.active) return Response.json({ok:false,error:"NOT_ACTIVE"},{status:409});
    let success=false;
    try {
      if (providerKey==="stripe") {
        const key=connection.secrets.secretKey;
        if (!key) throw new Error("MISSING_KEY");
        await new Stripe(key).balance.retrieve();
      } else if(providerKey==="smtp") {
        const {host,port,username,from}=connection.settings;
        if (!host||!username||!from||!connection.secrets.password) throw new Error("MISSING_FIELDS");
        await nodemailer.createTransport({host,port:Number(port||587),secure:Number(port||587)===465,auth:{user:username,pass:connection.secrets.password},connectionTimeout:8000,greetingTimeout:8000}).verify();
      } else if(providerKey==="viva") {
        if(!await testVivaCredentials(connection))throw new Error("VIVA_TEST_FAILED");
      } else if(providerKey==="whatsapp") {
        if(!await testWhatsAppCredentials(connection))throw new Error("WHATSAPP_TEST_FAILED");
      }
      success=true;
    } catch { success=false; }
    await db().query("UPDATE provider_connections SET last_test_at=$1,last_test_result=$2,status=$3 WHERE owner_id=$4 AND provider_key=$5",[Date.now(),success?"passed":"failed",success?"verified":"configured",user.ownerId,providerKey]);
    await db().query("INSERT INTO provider_connection_audit(owner_id,provider_key,actor_id,action,created_at) VALUES($1,$2,$3,$4,$5)",[user.ownerId,providerKey,String(user.id),success?"test_passed":"test_failed",Date.now()]);
    return Response.json({ok:success,status:success?"verified":"failed"},{status:success?200:502});
  } catch(error) {
    return Response.json({ok:false,error:error instanceof z.ZodError?"INVALID_INPUT":"TEST_FAILED"},{status:400});
  }
}

export const PUT = audited("provider_connection", handlePUT);

export const POST = audited("provider_connection", handlePOST);
