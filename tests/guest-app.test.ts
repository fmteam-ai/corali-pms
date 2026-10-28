import assert from "node:assert/strict";
import test from "node:test";
import { guestAppTexts, urlBase64ToUint8Array } from "../lib/guest-app-core.ts";

test("guest app texts exist in the six guest languages", () => {
  for (const l of ["el", "en", "fr", "de", "it", "es"] as const) for (const v of Object.values(guestAppTexts[l])) assert.ok(v.length > 3, l);
});

test("VAPID key (base64url) becomes bytes for PushManager.subscribe", () => {
  const bytes = urlBase64ToUint8Array(Buffer.from([4, 250, 251, 255, 0, 1]).toString("base64url"));
  assert.deepEqual([...bytes], [4, 250, 251, 255, 0, 1]);
});
