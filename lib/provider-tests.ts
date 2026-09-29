type Connection={settings:Record<string,string>;secrets:Record<string,string>};

export async function testVivaCredentials(connection:Connection, request:typeof fetch=fetch){
  const {clientId,clientSecret}=connection.secrets;
  if(!clientId||!clientSecret) return false;
  const environment=connection.settings.environment;
  if(environment!=="demo"&&environment!=="live") return false;
  const host=environment==="demo"?"demo-accounts.vivapayments.com":"accounts.vivapayments.com";
  const response=await request(`https://${host}/connect/token`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials",signal:AbortSignal.timeout(8000)});
  if(!response.ok)return false;
  const body=await response.json() as {access_token?:string};
  return typeof body.access_token==="string"&&body.access_token.length>20;
}

export async function testWhatsAppCredentials(connection:Connection,request:typeof fetch=fetch){
  const {businessAccountId,phoneNumberId,apiVersion="v26.0"}=connection.settings;
  const token=connection.secrets.accessToken;
  if(!token||!/^\d{5,30}$/.test(businessAccountId??"")||!/^\d{5,30}$/.test(phoneNumberId??"")||!/^v\d+\.\d+$/.test(apiVersion))return false;
  const response=await request(`https://graph.facebook.com/${apiVersion}/${businessAccountId}/phone_numbers?fields=id&limit=100`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return false;
  const body=await response.json() as {data?:Array<{id?:string}>};
  return Array.isArray(body.data)&&body.data.some(phone=>String(phone.id)===phoneNumberId);
}
