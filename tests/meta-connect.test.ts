import assert from "node:assert/strict";
import test from "node:test";
import { cleanToken, parseAccounts, pickPage, validGraphVersion } from "../lib/meta-connect-core.ts";

test("meta quick connect: pages, choice, token and version clean-up", () => {
  const pages = parseAccounts({ data: [{ id: "111", name: "Corali Hotel Paros", access_token: "PAGE", instagram_business_account: { id: "999", username: "hotelcorali" } }, { id: "222", name: "Other", access_token: "X" }, { id: 3 }] });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0], { id: "111", name: "Corali Hotel Paros", accessToken: "PAGE", instagramId: "999", instagramName: "hotelcorali" });
  assert.equal(pickPage(pages), null);
  assert.equal(pickPage(pages, "222")?.name, "Other");
  assert.equal(pickPage([pages[0]])?.id, "111");
  assert.deepEqual(parseAccounts({ error: { message: "x" } }), []);
  assert.equal(cleanToken(' "EAAabc" '), "EAAabc");
  assert.equal(cleanToken("access_token=EAAx"), "EAAx");
  assert.equal(validGraphVersion("v21.0"), "v21.0");
  assert.equal(validGraphVersion("latest"), "v26.0");
});

test("whatsapp quick connect: business accounts, phones and token expiry", async () => {
  const { parsePhones, tokenExpiry, wabaIdsFromDebug } = await import("../lib/meta-connect-core.ts");
  const debug = { data: { is_valid: true, expires_at: 1767225600, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["102030405060"] }, { scope: "whatsapp_business_messaging", target_ids: ["102030405060", "bad"] }, { scope: "pages_show_list", target_ids: ["999"] }] } };
  assert.deepEqual(wabaIdsFromDebug(debug), ["102030405060"]);
  assert.equal(tokenExpiry(debug), 1767225600000);
  assert.equal(tokenExpiry({ data: { expires_at: 0 } }), 0);
  assert.deepEqual(parsePhones({ data: [{ id: "555666777", display_phone_number: "+30 22840 41000", verified_name: "Hotel Corali" }] }, "102030405060"), [{ id: "555666777", number: "+30 22840 41000", name: "Hotel Corali", wabaId: "102030405060" }]);
});
