import assert from "node:assert/strict";
import test from "node:test";
import { runWhatsAppInboxSetup } from "../scripts/whatsapp-inbox-worker.mjs";

function pool() {
  const updates: unknown[][] = [], notes: unknown[][] = [];
  return { updates, notes, async query(sql: string, params: unknown[] = []) { if (sql.startsWith("UPDATE provider_connections")) updates.push(params); else if (sql.includes("pms_notifications")) notes.push(params); return { rows: [], rowCount: 1 }; } };
}
const wa = (settings: Record<string, string>, secrets: Record<string, string> = { appSecret: "s", accessToken: "EAAx", verifyToken: "vt" }) => async (k: string) => (k === "whatsapp" ? { settings: { appId: "2323931135071303", businessAccountId: "4349908485153353", apiVersion: "v27.0", ...settings }, secrets } : null);

test("WhatsApp inbox setup runs once per request, in the cron, and records the result", async () => {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), body: String(init?.body ?? "") }); return new Response(JSON.stringify({ success: true }), { status: 200 }); }) as typeof fetch;
  // Nothing requested, or already done: no calls.
  assert.deepEqual(await runWhatsAppInboxSetup({ pool: pool(), owner: "o", credentials: wa({}), origin: "https://booking.example", fetchImpl }), { ran: false });
  assert.deepEqual(await runWhatsAppInboxSetup({ pool: pool(), owner: "o", credentials: wa({ inboxSetupRequestedAt: "100", inboxSetupDoneAt: "200" }), origin: "https://booking.example", fetchImpl }), { ran: false });
  assert.equal(calls.length, 0);
  const p = pool();
  assert.deepEqual(await runWhatsAppInboxSetup({ pool: p, owner: "o", credentials: wa({ inboxSetupRequestedAt: "300", inboxSetupDoneAt: "200" }), origin: "https://booking.example/", fetchImpl, now: 400 }), { ran: true, result: "ok" });
  assert.match(calls[0].url, /graph\.facebook\.com\/v27\.0\/2323931135071303\/subscriptions$/);
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("callback_url"), "https://booking.example/api/webhooks/meta");
  assert.equal(form.get("verify_token"), "vt");
  assert.equal(form.get("fields"), "messages");
  assert.match(calls[1].url, /\/4349908485153353\/subscribed_apps$/);
  assert.deepEqual(JSON.parse(String(p.updates[0][2])), { inboxSetupDoneAt: "400", inboxSetupResult: "ok" });
  assert.match(String(p.notes[0][1]), /ενεργοποιήθηκαν/);
});

test("WhatsApp inbox setup reports Meta's reason and missing details", async () => {
  const fail = (async () => new Response(JSON.stringify({ error: { message: "Callback verification failed" } }), { status: 400 })) as typeof fetch;
  const p = pool();
  const r = await runWhatsAppInboxSetup({ pool: p, owner: "o", credentials: wa({ inboxSetupRequestedAt: "5" }), origin: "https://b", fetchImpl: fail, now: 9 });
  assert.match(String(r.result), /Callback verification failed/);
  const q = pool();
  const m = await runWhatsAppInboxSetup({ pool: q, owner: "o", credentials: wa({ inboxSetupRequestedAt: "5" }, { accessToken: "x", verifyToken: "v" }), origin: "https://b", fetchImpl: fail });
  assert.match(String(m.result), /App secret/);
});
