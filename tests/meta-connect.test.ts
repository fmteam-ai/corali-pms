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
