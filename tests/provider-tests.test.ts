import assert from "node:assert/strict";
import test from "node:test";
import { testVivaCredentials, testWhatsAppCredentials } from "../lib/provider-tests.ts";

test("Viva test uses the fixed demo token endpoint and client credentials", async () => {
  const request:typeof fetch=async (input,init)=>{
    assert.equal(input,"https://demo-accounts.vivapayments.com/connect/token");
    assert.equal(init?.method,"POST");
    assert.equal((init?.headers as Record<string,string>).Authorization,`Basic ${Buffer.from("client:private").toString("base64")}`);
    return Response.json({access_token:"a-long-test-token-for-verification"});
  };
  assert.equal(await testVivaCredentials({settings:{environment:"demo"},secrets:{clientId:"client",clientSecret:"private"}},request),true);
  assert.equal(await testVivaCredentials({settings:{environment:"invalid"},secrets:{clientId:"client",clientSecret:"private"}},request),false);
});

test("WhatsApp test verifies the configured number in its WABA",async()=>{
  const request:typeof fetch=async(input,init)=>{
    assert.equal(input,"https://graph.facebook.com/v26.0/123456789/phone_numbers?fields=id&limit=100");
    assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer private-token");
    return Response.json({data:[{id:"987654321"}]});
  };
  const connection={settings:{businessAccountId:"123456789",phoneNumberId:"987654321",apiVersion:"v26.0"},secrets:{accessToken:"private-token"}};
  assert.equal(await testWhatsAppCredentials(connection,request),true);
  assert.equal(await testWhatsAppCredentials({...connection,settings:{...connection.settings,phoneNumberId:"111111111"}},request),false);
});
