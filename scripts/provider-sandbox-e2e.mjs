#!/usr/bin/env node
// v187 end-to-end checks against the REAL payment / channel / messaging providers in their sandbox (test) modes.
// Nothing here touches live money or live channels: each check refuses a live key. Run on any machine with internet:
//
//   STRIPE_TEST_SECRET_KEY=sk_test_… VIVA_DEMO_CLIENT_ID=… VIVA_DEMO_CLIENT_SECRET=… \
//   CHANNEX_STAGING_API_KEY=… WHATSAPP_TEST_TOKEN=… WHATSAPP_TEST_PHONE_ID=… \
//   node scripts/provider-sandbox-e2e.mjs [report.json]
//
// A provider without its key is NOT RUN (never PASS). Exit code 1 when any check FAILS.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const results = [];
const env = process.env;
async function check(flow, name, needs, fn) {
  const missing = needs.filter((k) => !env[k]);
  if (missing.length) { results.push({ flow, name, status: "NOT RUN", detail: `missing ${missing.join(", ")}` }); return; }
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ flow, name, status: "PASS", detail: String(detail ?? ""), ms: Date.now() - t0 }); }
  catch (e) { results.push({ flow, name, status: "FAIL", detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }); }
}
const must = (cond, msg) => { if (!cond) throw Error(msg); };
const timeout = () => AbortSignal.timeout(20_000);

// ── Stripe (test mode) ──────────────────────────────────────────────────────────────────────────────────────────
async function stripe(path, body, idem) {
  must(String(env.STRIPE_TEST_SECRET_KEY).startsWith("sk_test_"), "STRIPE_TEST_SECRET_KEY must be a test key (sk_test_…)");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${env.STRIPE_TEST_SECRET_KEY}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? new URLSearchParams(body).toString() : undefined, signal: timeout() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(`Stripe ${path}: HTTP ${r.status} ${j?.error?.message ?? ""}`);
  return j;
}
await check("payments", "Stripe test: card payment succeeds and the amount matches", ["STRIPE_TEST_SECRET_KEY"], async () => {
  const pi = await stripe("payment_intents", { amount: "1234", currency: "eur", "payment_method_types[]": "card", payment_method: "pm_card_visa", confirm: "true", "metadata[corali_e2e]": "1" });
  must(pi.status === "succeeded", `status ${pi.status}`);
  const again = await stripe(`payment_intents/${pi.id}`);
  must(again.amount_received === 1234 && again.currency === "eur", `received ${again.amount_received} ${again.currency}`);
  globalThis.__pi = pi.id;
  return `${pi.id} €12.34 succeeded`;
});
await check("payments", "Stripe test: the same request twice (idempotency key) creates one payment", ["STRIPE_TEST_SECRET_KEY"], async () => {
  const key = randomUUID(), body = { amount: "500", currency: "eur", "payment_method_types[]": "card", payment_method: "pm_card_visa", confirm: "true" };
  const a = await stripe("payment_intents", body, key), b = await stripe("payment_intents", body, key);
  must(a.id === b.id, `two payments: ${a.id} / ${b.id}`);
  return `one payment ${a.id}`;
});
await check("payments", "Stripe test: refund and reconciliation of the balance", ["STRIPE_TEST_SECRET_KEY"], async () => {
  must(globalThis.__pi, "no payment to refund (previous check failed)");
  const rf = await stripe("refunds", { payment_intent: globalThis.__pi, amount: "234" });
  must(rf.status === "succeeded" || rf.status === "pending", `refund ${rf.status}`);
  const pi = await stripe(`payment_intents/${globalThis.__pi}?expand[]=latest_charge`);
  const refunded = Number(pi.latest_charge?.amount_refunded ?? 0);
  must(refunded === 234, `refunded ${refunded}`);
  return `€12.34 − €2.34 refunded = €10.00 kept`;
});
await check("payments", "Stripe test: declined card is reported, not booked", ["STRIPE_TEST_SECRET_KEY"], async () => {
  try { await stripe("payment_intents", { amount: "700", currency: "eur", "payment_method_types[]": "card", payment_method: "pm_card_chargeDeclined", confirm: "true" }); }
  catch (e) { must(/declin/i.test(String(e.message)), String(e.message)); return "declined as expected"; }
  throw Error("a declined card was accepted");
});

// ── Viva (demo) ─────────────────────────────────────────────────────────────────────────────────────────────────
await check("payments", "Viva demo: OAuth token", ["VIVA_DEMO_CLIENT_ID", "VIVA_DEMO_CLIENT_SECRET"], async () => {
  const r = await fetch("https://demo-accounts.vivapayments.com/connect/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${env.VIVA_DEMO_CLIENT_ID}:${env.VIVA_DEMO_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: timeout() });
  const j = await r.json().catch(() => ({}));
  must(r.ok && typeof j.access_token === "string", `HTTP ${r.status}`);
  return "token received";
});

// ── Channex (staging) ───────────────────────────────────────────────────────────────────────────────────────────
await check("channel manager", "Channex staging: properties and room types readable", ["CHANNEX_STAGING_API_KEY"], async () => {
  const h = { "user-api-key": env.CHANNEX_STAGING_API_KEY };
  const p = await fetch("https://staging.channex.io/api/v1/properties", { headers: h, signal: timeout() });
  must(p.ok, `properties HTTP ${p.status}`);
  const props = (await p.json()).data ?? [];
  must(props.length > 0, "no property on the staging account");
  const rt = await fetch(`https://staging.channex.io/api/v1/room_types?filter[property_id]=${props[0].id}`, { headers: h, signal: timeout() });
  must(rt.ok, `room types HTTP ${rt.status}`);
  return `${props.length} property(ies), ${((await rt.json()).data ?? []).length} room type(s)`;
});

// ── WhatsApp (test number) ──────────────────────────────────────────────────────────────────────────────────────
await check("messaging", "WhatsApp Cloud API: test phone number reachable", ["WHATSAPP_TEST_TOKEN", "WHATSAPP_TEST_PHONE_ID"], async () => {
  const r = await fetch(`https://graph.facebook.com/v26.0/${env.WHATSAPP_TEST_PHONE_ID}?fields=display_phone_number,quality_rating`, { headers: { Authorization: `Bearer ${env.WHATSAPP_TEST_TOKEN}` }, signal: timeout() });
  const j = await r.json().catch(() => ({}));
  must(r.ok && j.display_phone_number, `HTTP ${r.status} ${j?.error?.message ?? ""}`);
  return `${j.display_phone_number} (quality ${j.quality_rating ?? "?"})`;
});

const out = process.argv[2];
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.flow} · ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
