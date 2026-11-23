import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { athensToday, groupMismatches, otaReconcile, queueOtaResync } from "../scripts/ota-reconcile-core.mjs";
import { saveReconciliation, stripeReconcile } from "../scripts/stripe-reconcile-core.mjs";
import { backupTime, evaluateRehearsal, newestBackup, sameDatabase, tablesWithData } from "../scripts/restore-rehearsal-core.mjs";
import { contentHash, fileManifest, verifyManifest } from "../scripts/release-evidence-core.mjs";

const o = "hotel-corali";
type Row = Record<string, unknown>;
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
  return { db, pool };
}

test("v189 OTA reconciliation: a change that never reached the OTAs is found; queued changes are not differences", async () => {
  const { db, pool } = await fresh();
  try {
    const now = Date.now(), today = athensToday(now);
    assert.equal((await otaReconcile({ pool, owner: o, now })).active, false, "no mapped room types: inactive");
    await db.query(`INSERT INTO channel_room_mappings(owner_id,room_type,external_room_type_id,updated_at) VALUES($1,'double','rt-1',1)`, [o]);
    await db.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(1,$1,'101','double',2,1,1,'clean'),(2,$1,'102','double',2,1,1,'clean')`, [o]);
    // Last push: 2 free for days +10..+14.
    for (let i = 10; i <= 14; i++) await db.query(`INSERT INTO channel_availability_state(owner_id,room_type,date,available,pushed_at) VALUES($1,'double',$2,2,1)`, [o, addDays(today, i)]);
    let r = await otaReconcile({ pool, owner: o, now, days: 20 });
    assert.deepEqual(r.mismatches, []);
    assert.ok(r.neverPushed > 0, "dates never pushed are counted, not flagged");
    // A booking for +11..+13 written without its availability change (the fault this check exists for).
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna',$2,$3,'confirmed',1,1,0,1)`, [o, addDays(today, 11), addDays(today, 13)]);
    r = await otaReconcile({ pool, owner: o, now, days: 20 });
    assert.deepEqual(r.mismatches, [{ roomType: "double", from: addDays(today, 11), to: addDays(today, 12), pms: 1, ota: 2 }]);
    // Queued again: no longer a difference (it is on its way), and the queue holds exactly that range.
    assert.equal(await queueOtaResync({ pool, owner: o, mismatches: r.mismatches, now }), 1);
    assert.deepEqual((await otaReconcile({ pool, owner: o, now, days: 20 })).mismatches, []);
    const q = (await db.query<Row>(`SELECT date_from,date_to,reason FROM channel_sync_outbox`)).rows;
    assert.deepEqual(q, [{ date_from: addDays(today, 11), date_to: addDays(today, 12), reason: "reconcile" }]);
    assert.deepEqual(groupMismatches([{ roomType: "a", date: "2026-08-02", pms: 1, ota: 2 }, { roomType: "a", date: "2026-08-01", pms: 1, ota: 2 }, { roomType: "a", date: "2026-08-04", pms: 1, ota: 2 }]).map((m) => `${m.from}..${m.to}`), ["2026-08-01..2026-08-02", "2026-08-04..2026-08-04"]);
  } finally { await db.close(); }
});

test("v189 Stripe reconciliation: a payment Stripe took that the PMS never recorded, a wrong amount, pagination", async () => {
  const { db, pool } = await fresh();
  try {
    const t = Date.parse("2026-07-15T10:00:00Z"), sec = Math.floor(t / 1000);
    await db.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,check_in,check_out,status,total_cents,balance_cents,created_at) VALUES(1,$1,'CR-1','Anna','2026-08-01','2026-08-03','confirmed',30000,0,1),(2,$1,'CR-2','Ben','2026-08-01','2026-08-03','confirmed',20000,0,1)`, [o]);
    await db.query(`INSERT INTO payment_transactions(owner_id,booking_id,provider,provider_reference,kind,status,amount_cents,created_at) VALUES($1,1,'stripe','pi_ok','payment','succeeded',10000,$2),($1,2,'stripe','pi_amount','payment','succeeded',5000,$2),($1,2,'stripe','pi_gone','payment','succeeded',7000,$2)`, [o, t - 3_600_000]);
    const page1 = { data: [{ id: "pi_ok", status: "succeeded", amount_received: 10000, created: sec - 3600 }, { id: "pi_amount", status: "succeeded", amount_received: 6000, created: sec - 3600 }], has_more: true };
    const page2 = { data: [{ id: "pi_missing", status: "succeeded", amount_received: 12000, created: sec - 1800, metadata: { booking_reference: "CR-9" } }, { id: "pi_other_hotel", status: "succeeded", amount_received: 999, created: sec, metadata: { owner_id: "another" } }, { id: "pi_failed", status: "requires_payment_method", amount: 5000, created: sec }], has_more: false };
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(url);
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer sk_test_x");
      return new Response(JSON.stringify(url.includes("starting_after=pi_amount") ? page2 : page1), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await stripeReconcile({ pool, owner: o, secretKey: "sk_test_x", fromMs: t - 86_400_000, toMs: t + 60_000, fetchImpl });
    assert.equal(calls.length, 2);
    assert.equal(r.complete, true);
    assert.deepEqual(r.issues.map((i) => `${i.kind}:${i.providerRef}:${i.amountCents}`), ["amount_differs:pi_amount:1000", "stripe_not_recorded:pi_missing:12000", "pms_not_in_stripe:pi_gone:7000"]);
    assert.match(r.issues[1].detail, /CR-9.*webhook/);
    assert.equal(r.totals.stripeCents, 28000);
    assert.equal(await saveReconciliation(pool, o, "stripe", { issues: r.issues, totals: r.totals }), "fail");
    assert.equal(await saveReconciliation(pool, o, "folio", { issues: [] }), "ok");
    // Stripe unreachable: an error the PMS shows, never «no differences».
    const down = (async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(stripeReconcile({ pool, owner: o, secretKey: "sk_bad", fromMs: t - 1000, toMs: t, fetchImpl: down }), /STRIPE_HTTP_401: Invalid API Key/);
  } finally { await db.close(); }
});

test("v189 restore rehearsal verdicts and the release evidence of the installed files", () => {
  assert.equal(newestBackup(["x.txt", "corali-db-2026-07-14-03-40-00.dump.enc", "corali-db-2026-07-15-03-40-00.dump.enc"]), "corali-db-2026-07-15-03-40-00.dump.enc");
  assert.equal(backupTime("corali-db-2026-07-15-03-40-00.dump.enc"), Date.UTC(2026, 6, 15, 3, 40, 0));
  const toc = tablesWithData(`;\n; Archive created at 2026-07-15\n215; 1259 16390 TABLE public bookings corali\n3401; 0 16390 TABLE DATA public bookings corali\n3402; 0 16400 TABLE DATA public rooms corali\n3403; 0 16410 TABLE DATA public "folio_entries" corali\n`);
  assert.deepEqual([...toc].sort(), ["bookings", "folio_entries", "rooms"]);
  assert.equal(sameDatabase("postgres://a:b@localhost:5432/corali", "postgresql://c:d@127.0.0.1/corali"), true);
  assert.equal(sameDatabase("postgres://a:b@localhost/corali", "postgres://a:b@localhost/corali_rehearsal"), false);
  // Archive fine but not restored → partial; restored with the expected rows → ok; rows missing → failed.
  assert.equal(evaluateRehearsal({ toc, liveBefore: { bookings: 100, rooms: 20, folio_entries: 500 } }).status, "partial");
  assert.equal(evaluateRehearsal({ toc, restored: { bookings: 100, rooms: 20, folio_entries: 497 }, liveBefore: { bookings: 100, rooms: 20, folio_entries: 500 } }).status, "ok");
  const bad = evaluateRehearsal({ toc, restored: { bookings: 40, rooms: 20, folio_entries: 500 }, liveBefore: { bookings: 100, rooms: 20, folio_entries: 500 } });
  assert.equal(bad.status, "failed");
  assert.match(JSON.stringify(bad.checks.filter((c) => !c.ok)), /bookings.*επαναφορά 40/);
  assert.equal(evaluateRehearsal({ toc, liveBefore: { payment_transactions: 3 } }).status, "failed", "a table with live data missing from the archive");

  const dir = mkdtempSync(path.join(os.tmpdir(), "evidence-"));
  try {
    mkdirSync(path.join(dir, "scripts"));
    writeFileSync(path.join(dir, "server.js"), "console.log(1)");
    writeFileSync(path.join(dir, "scripts", "a.mjs"), "export {}");
    writeFileSync(path.join(dir, "runtime.env"), "SECRET=1");
    const m = fileManifest(dir);
    assert.deepEqual(Object.keys(m).sort(), ["scripts/a.mjs", "server.js"], "runtime.env is never part of it");
    assert.equal(contentHash(m), contentHash({ ...m }));
    assert.equal(verifyManifest(dir, m).ok, true);
    writeFileSync(path.join(dir, "added-on-server.txt"), "x");
    assert.equal(verifyManifest(dir, m).ok, true, "files added on the server are ignored");
    writeFileSync(path.join(dir, "server.js"), "console.log(2)");
    rmSync(path.join(dir, "scripts", "a.mjs"));
    assert.deepEqual(verifyManifest(dir, m), { total: 2, missing: ["scripts/a.mjs"], changed: ["server.js"], ok: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
