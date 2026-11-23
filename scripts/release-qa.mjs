#!/usr/bin/env node
// v187 release QA: reproducible end-to-end checks of the critical flows on the PACKAGE that will be installed — a
// fresh PostgreSQL, the packaged PMS and Booking applications running, real HTTP requests and the packaged cron —
// written as a PASS / FAIL report per flow (QA-REPORT-<version>.md + .json). Any FAIL → exit code 1 (the package
// build stops). Sandbox checks of the external providers run too when their test keys are in the environment
// (scripts/provider-sandbox-e2e.mjs); without keys they are NOT RUN, never PASS.
//
//   node scripts/release-qa.mjs corali-pms-cpanel-v187-root.tar.gz v187 [output-dir]
//
// PostgreSQL: QA_DATABASE_URL (an empty database), or the local PostgreSQL binaries (a temporary cluster).
import { execFileSync, spawn, spawnSync as spawnSyncRaw } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chownSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const [archive, version, outDir = process.cwd()] = process.argv.slice(2);
if (!archive || !version || !existsSync(archive)) { console.error("Usage: node scripts/release-qa.mjs <package.tar.gz> <version> [output-dir]"); process.exit(2); }
const project = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const require = createRequire(path.join(project, "package.json"));
const pg = require("pg");
const Stripe = require("stripe");
const owner = "hotel-corali";
const work = `/var/tmp/corali-qa-${randomBytes(4).toString("hex")}`;
const results = [], started = Date.now(), children = [];
let testTap = "";
const rnd = (n = 32, enc = "hex") => randomBytes(n).toString(enc);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (cond, msg) => { if (!cond) throw Error(msg); };
const athens = (ms = Date.now()) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const today = (() => { const p = athens(); return `${p.year}-${p.month}-${p.day}`; })();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// v196 evidence logs: every flow keeps its own log (start/end, each command it ran with exit code and output tail,
// the error with its stack); the applications' output and the full TAP of the tests are kept too. Written to
// <output-dir>/qa-logs-<version>/ and shipped as a separate archive with the reproduction instructions. Secrets of the
// temporary environment (keys, passwords) are masked.
const flowLogs = new Map(); let currentFlow = "setup";
const secrets = new Set();
const mask = (t) => { let x = String(t); for (const v of secrets) if (v && v.length >= 8) x = x.split(v).join("«masked»"); return x.replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/g, "$1«masked»@"); };
const log = (line) => { const k = currentFlow; if (!flowLogs.has(k)) flowLogs.set(k, []); flowLogs.get(k).push(`${new Date().toISOString()} ${mask(line)}`); };
const tail = (t, n = 4000) => { const x = String(t ?? ""); return x.length > n ? `…${x.slice(-n)}` : x; };
function spawnSync(cmd, args = [], opts = {}) {
  const t0 = Date.now(), r = spawnSyncRaw(cmd, args, opts);
  log(`$ ${path.basename(String(cmd))} ${args.map((a) => String(a).replace(/^--env-file=.*/, "--env-file=…")).join(" ")}\n  → exit ${r.status}${r.signal ? ` (${r.signal})` : ""} in ${Date.now() - t0} ms${r.stdout ? `\n  stdout: ${tail(r.stdout)}` : ""}${r.stderr ? `\n  stderr: ${tail(r.stderr)}` : ""}`);
  return r;
}
async function flow(id, name, fn) {
  const t0 = Date.now(); currentFlow = id; log(`START ${id} ${name}`);
  // v198: a flow may say exactly WHAT it proved (evidence levels), so a cron that ran is never read as a message that
  // reached a guest: JOB_EXECUTION (the automation ran), FAILURE_HANDLING (a failed send was recorded and scheduled
  // again), DELIVERY (CONFIRMED only by a provider; NOT_TESTED in these internal flows — see the sandbox section).
  try { const out = await fn(); const detail = out && typeof out === "object" ? out.detail : out; const evidence = out && typeof out === "object" ? out.evidence ?? null : null; results.push({ id, name, status: "PASS", detail: String(detail ?? ""), evidence, ms: Date.now() - t0 }); log(`PASS (${Date.now() - t0} ms): ${detail ?? ""}${evidence ? ` · ${JSON.stringify(evidence)}` : ""}`); console.log(`PASS ${id} ${name}`); }
  catch (e) { results.push({ id, name, status: "FAIL", detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }); log(`FAIL (${Date.now() - t0} ms): ${e instanceof Error ? e.stack : e}`); console.log(`FAIL ${id} ${name}: ${e instanceof Error ? e.message : e}`); }
  finally { currentFlow = "teardown"; }
}

// ── PostgreSQL ──────────────────────────────────────────────────────────────────────────────────────────────────
let dbUrl = process.env.QA_DATABASE_URL, stopPg = () => {};
function pgBin() {
  if (process.env.QA_PG_BIN) return process.env.QA_PG_BIN;
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const v = readdirSync(base).sort((a, b) => Number(b) - Number(a))[0];
  return v ? path.join(base, v, "bin") : null;
}
function asPostgres(cmd) {
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const r = root ? spawnSync("su", ["postgres", "-c", cmd], { encoding: "utf8" }) : spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
  if (r.status !== 0) throw Error(`${cmd.split(" ")[0]}: ${(r.stderr || r.stdout).slice(-300)}`);
}
async function startPostgres() {
  if (dbUrl) return `external (${new URL(dbUrl).host})`;
  const bin = pgBin();
  must(bin, "No PostgreSQL: set QA_DATABASE_URL or install PostgreSQL");
  const dir = path.join(work, "pg");
  mkdirSync(dir, { recursive: true });
  if (process.getuid?.() === 0) { const pw = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" }); const uid = Number(pw.stdout); chownSync(work, uid, uid); chownSync(dir, uid, uid); }
  const port = await freePort();
  asPostgres(`${bin}/initdb -D ${dir}/data -A trust -U postgres >/dev/null`);
  asPostgres(`${bin}/pg_ctl -D ${dir}/data -o '-p ${port} -k ${dir}' -l ${dir}/log -w start >/dev/null`);
  stopPg = () => { try { asPostgres(`${bin}/pg_ctl -D ${dir}/data -m fast stop >/dev/null`); } catch { /* already stopped */ } };
  const admin = new pg.Client({ host: dir, port, user: "postgres", database: "postgres" });
  await admin.connect(); await admin.query("CREATE DATABASE corali_qa"); const v = (await admin.query("SHOW server_version")).rows[0].server_version; await admin.end();
  dbUrl = `postgresql://postgres@localhost:${port}/corali_qa?host=${encodeURIComponent(dir)}`;
  return `PostgreSQL ${v} (temporary cluster)`;
}
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

// ── packaged applications ───────────────────────────────────────────────────────────────────────────────────────
const stripeSecret = `whsec_${rnd(24)}`;
function stage(role) {
  const dir = path.join(work, role);
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", path.resolve(archive), "-C", dir]);
  writeFileSync(path.join(dir, "runtime.env"), [
    "NODE_ENV=production", `DATABASE_URL=${dbUrl}`, "DATABASE_SSL=false", `SESSION_SECRET=${rnd()}`, `PMS_DOCUMENT_KEY=${documentKey}`, `APP_ROLE=${role}`,
    "PMS_ORIGIN=https://pms.qa.invalid", "BOOKING_ORIGIN=https://booking.qa.invalid", `PMS_OWNER_ID=${owner}`, `CRON_SECRET=${rnd()}`,
    `STRIPE_SECRET_KEY=sk_test_${rnd(12)}`, `STRIPE_WEBHOOK_SECRET=${stripeSecret}`, "",
  ].join("\n"), { mode: 0o600 });
  return dir;
}
const documentKey = rnd(32, "base64");
secrets.add(documentKey);
const appLogs = [];
async function startApp(dir) {
  const port = await freePort();
  const envLines = Object.fromEntries(readFileSync(path.join(dir, "runtime.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (const [k, v] of Object.entries(envLines)) if (/SECRET|KEY|PASSWORD|TOKEN|DATABASE_URL/.test(k)) secrets.add(v);
  const child = spawn(process.execPath, ["app.js"], { cwd: dir, env: { ...process.env, ...envLines, PORT: String(port), HOSTNAME: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  children.push(child); appLogs.push({ name: path.basename(dir), get: () => out });
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return { url: `http://127.0.0.1:${port}`, log: () => out }; } catch { /* starting */ } await sleep(250); }
  throw Error(`application did not start: ${out.slice(-400)}`);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(work, { recursive: true });
let env = {}, db, pms, booking, pmsDir, bookingDir;
const q = (sql, p = []) => db.query(sql, p);
const now = Date.now();
try {
  await flow("F01", "Βάση δεδομένων: εγκατάσταση σχήματος και επανάληψη μεταναστεύσεων (idempotent)", async () => {
    env.database = await startPostgres();
    pmsDir = stage("pms"); bookingDir = stage("booking");
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, path.join(pmsDir, "scripts/init-postgres.mjs")], { stdio: "pipe" });
    db = new pg.Pool({ connectionString: dbUrl });
    const n = (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n;
    must(n > 150, `${n} tables`);
    return `${n} πίνακες, δύο εφαρμογές του σχήματος χωρίς σφάλμα · ${env.database}`;
  });
  must(db, "no database — the remaining flows cannot run");
  // Shared scenario: four rooms of their own type (so the booking site shows exactly which one is offered).
  const p = athens(now + 5 * 60_000), checkInTime = `${p.hour % 24}`.padStart(2, "0") + `:${p.minute}`;
  await q(`INSERT INTO tv_settings(owner_id,settings_json,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2`, [owner, JSON.stringify({ checkInTime }), now]).catch(async () => q(`INSERT INTO tv_settings(owner_id,settings_json) VALUES($1,$2)`, [owner, JSON.stringify({ checkInTime })]));
  const room = async (code, status) => Number((await q(`INSERT INTO rooms(owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES($1,$2,$3,2,1,10000,$4) RETURNING id`, [owner, code, `qa-${code}`, status])).rows[0].id);
  const R = { ready: await room("101", "clean"), dirty: await room("102", "dirty"), ooo: await room("103", "out_of_order"), eta: await room("104", "dirty") };
  await q(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,checklist_json,inspection_status,due_at) VALUES($1,$2,'departure_clean','todo','{}','pending',$3)`, [owner, R.dirty, now]);
  await q(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,checklist_json,inspection_status,due_at,expected_ready_at) VALUES($1,$2,'departure_clean','in_progress','{}','pending',$3,$4)`, [owner, R.eta, now, now + 30 * 60_000]);
  for (const t of ["qa-101", "qa-102", "qa-103", "qa-104"]) await q(`INSERT INTO channel_room_mappings(owner_id,room_type,external_room_type_id,updated_at) VALUES($1,$2,$3,$4)`, [owner, t, `ext-${t}`, now]);

  await flow("F02", "Εφαρμογές πακέτου: εκκίνηση PMS και Booking, έλεγχος υγείας και έκδοσης", async () => {
    pms = await startApp(pmsDir); booking = await startApp(bookingDir);
    for (const [name, app] of [["PMS", pms], ["Booking", booking]]) { const h = await (await fetch(`${app.url}/api/health`)).json(); must(h.ok && h.version === version, `${name} health ${JSON.stringify(h)}`); }
    return `PMS και Booking ${version}: υγιείς`;
  });

  await flow("F03", "Διαθεσιμότητα σελίδας κρατήσεων: πωλήσιμο / σε προετοιμασία / εκτός λειτουργίας (σήμερα και αύριο)", async () => {
    must(booking, "Booking app not running");
    const types = async (a, b) => { const r = await fetch(`${booking.url}/api/public/availability?checkIn=${a}&checkOut=${b}&adults=2&children=0&rooms=1&lang=en`); const j = await r.json(); must(r.ok && j.ok, `HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`); return j.rooms.map((x) => x.roomType).sort(); };
    const t = await types(today, addDays(today, 2)), m = await types(addDays(today, 1), addDays(today, 3));
    must(JSON.stringify(t) === JSON.stringify(["qa-101", "qa-104"]), `σήμερα: ${t}`);
    must(JSON.stringify(m) === JSON.stringify(["qa-101", "qa-102", "qa-104"]), `αύριο: ${m}`);
    return `σήμερα: 101 (έτοιμο), 104 (έτοιμο σε 30′) · αύριο: +102 · 103 εκτός λειτουργίας ποτέ`;
  });

  await flow("F04", "Διαθεσιμότητα προς OTA (channel manager): ίδιος κανόνας με τη σελίδα κρατήσεων", async () => {
    const { AVAILABILITY_SQL } = await import(path.join(pmsDir, "scripts/channel-core.mjs"));
    const rows = (await q(AVAILABILITY_SQL, [owner, today, addDays(today, 1), Date.now()])).rows;
    const free = (d, t) => Number(rows.find((r) => r.date === d && r.room_type === t)?.free ?? -1);
    const got = { t101: free(today, "qa-101"), t102: free(today, "qa-102"), t103: free(today, "qa-103"), t104: free(today, "qa-104"), m102: free(addDays(today, 1), "qa-102"), m103: free(addDays(today, 1), "qa-103") };
    must(JSON.stringify(got) === JSON.stringify({ t101: 1, t102: 0, t103: 0, t104: 1, m102: 1, m103: 0 }), JSON.stringify(got));
    return "σήμερα 101:1 102:0 103:0 104:1 · αύριο 102:1 103:0";
  });

  // A guest in house in room 101 for the POS and reconciliation flows.
  const stay = Number((await q(`INSERT INTO bookings(owner_id,reference,guest_name,guest_email,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES($1,'CR-QA-POS','QA Guest','qa@example.invalid',$2,$3,'checked_in',$4,20000,20000,$5) RETURNING id`, [owner, addDays(today, -1), addDays(today, 2), R.ready, now])).rows[0].id);
  await flow("F05", "POS → folio: χρέωση δωματίου, επανάληψη χωρίς διπλή χρέωση, ακύρωση με αντιλογισμό", async () => {
    must(pms, "PMS app not running");
    const { newPosKey } = await import(path.join(project, "scripts/pos-key-core.mjs"));
    const dept = Number((await q(`INSERT INTO hotel_departments(owner_id,name_el,name_en,icon,mode,created_at,updated_at) VALUES($1,'Μπαρ','Bar','bar','order',$2,$2) RETURNING id`, [owner, now])).rows[0].id);
    const k = newPosKey();
    await q(`INSERT INTO department_pos(owner_id,department_id,name,prefix,key_hash,created_at) VALUES($1,$2,'QA POS',$3,$4,$5)`, [owner, dept, k.prefix, k.hash, now]);
    const sale = { receipt_id: "QA-1001", payment: "room", room: "101", items: [{ name: "Mojito", quantity: 2, unit_price: 9.5 }] };
    const post = () => fetch(`${pms.url}/api/v1/pos/sales`, { method: "POST", headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" }, body: JSON.stringify(sale) });
    const a = await post(); must(a.status === 201, `πρώτη αποστολή HTTP ${a.status} ${await a.text()}`);
    const b = await post(); const bj = await b.json(); must(b.status === 200 && bj.data.duplicate === true, `επανάληψη HTTP ${b.status}`);
    const charges = (await q(`SELECT amount_cents FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 AND description LIKE '%[POS QA-1001]%'`, [owner, stay])).rows;
    must(charges.length === 1 && Number(charges[0].amount_cents) === 1900, `χρεώσεις ${JSON.stringify(charges)}`);
    const bad = await fetch(`${pms.url}/api/v1/pos/sales`, { method: "POST", headers: { Authorization: "Bearer cpos_aaaaaaaa_" + "x".repeat(40), "Content-Type": "application/json" }, body: JSON.stringify(sale) });
    must(bad.status === 401, `λάθος κλειδί HTTP ${bad.status}`);
    const v = await fetch(`${pms.url}/api/v1/pos/sales/QA-1001`, { method: "DELETE", headers: { Authorization: `Bearer ${k.key}` } });
    must(v.ok, `ακύρωση HTTP ${v.status}`);
    const sum = Number((await q(`SELECT COALESCE(sum(amount_cents),0)::int s FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 AND description LIKE '%[POS QA-1001]%'`, [owner, stay])).rows[0].s);
    must(sum === 0, `υπόλοιπο POS στο folio ${sum}`);
    return "€19.00 στο folio μία φορά · επανάληψη = duplicate · λάθος κλειδί 401 · ακύρωση → 0";
  });

  await flow("F06", "Stripe webhook: υπογεγραμμένο event, διπλή παράδοση → μία κράτηση, μία πληρωμή, λάθος υπογραφή απορρίπτεται", async () => {
    must(booking, "Booking app not running");
    const ci = addDays(today, 20), co = addDays(today, 22), token = rnd(16);
    const s = Number((await q(`INSERT INTO booking_sessions(owner_id,token,guest_first_name,guest_last_name,guest_email,guest_phone,country,check_in,check_out,room_key,room_subtotal_cents,total_cents,payable_cents,recovery_due_at,created_at,updated_at,status,payment_gateway,room_allocations,guests,children,language)
      VALUES($1,$2,'Webhook','Test','wh@example.invalid','+302100000000','GR',$3,$4,'qa-101',30000,30000,30000,$5,$6,$6,'payment_pending','stripe',$7,2,0,'en') RETURNING id`, [owner, token, ci, co, now + 3_600_000, now, JSON.stringify([R.ready])])).rows[0].id);
    const event = { id: `evt_qa_${rnd(6)}`, object: "event", type: "checkout.session.completed", data: { object: { id: `cs_test_qa_${rnd(6)}`, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", currency: "eur", amount_total: 30000, payment_intent: null, setup_intent: null, customer: null, metadata: { owner_id: owner, booking_session_id: String(s), token } } } };
    const payload = JSON.stringify(event);
    const send = (sig) => fetch(`${booking.url}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": sig, "Content-Type": "application/json" }, body: payload });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });
    const r1 = await send(header), r2 = await send(header);
    must(r1.ok && r2.ok, `HTTP ${r1.status}/${r2.status} ${await r1.text()} · log: ${(() => { const l = booking.log(), i = l.lastIndexOf("stripe fulfillment failed"); return (i >= 0 ? l.slice(i, i + 700) : l.slice(-700)).replace(/\s+/g, " "); })()}`);
    const bad = await send(Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" }));
    must(bad.status >= 400, `λάθος υπογραφή HTTP ${bad.status}`);
    const made = (await q(`SELECT count(*)::int n FROM bookings WHERE owner_id=$1 AND guest_email='wh@example.invalid'`, [owner])).rows[0].n;
    const pays = (await q(`SELECT count(*)::int n FROM payment_transactions WHERE owner_id=$1 AND provider_reference=$2`, [owner, event.data.object.id])).rows[0].n;
    const folio = (await q(`SELECT count(*)::int n, COALESCE(sum(amount_cents),0)::int s FROM folio_entries WHERE owner_id=$1 AND entry_type='payment' AND receipt_reference LIKE $2`, [owner, `${event.data.object.id}%`])).rows[0];
    must(made === 1 && pays === 1 && folio.n === 1 && folio.s === -30000, `κρατήσεις ${made}, συναλλαγές ${pays}, folio ${folio.n}/${folio.s}`);
    return "2 παραδόσεις → 1 κράτηση, 1 συναλλαγή, 1 πληρωμή €300 στο folio · λάθος υπογραφή απορρίφθηκε";
  });

  await flow("F07", "Συμφωνία οικονομικών: καθαρή μετά τις F05–F06, εντοπίζει τεχνητή απόκλιση", async () => {
    const { reconcile } = await import(path.join(project, "scripts/reconcile-core.mjs"));
    const clean = await reconcile({ pool: db, owner, fromMs: now - 86_400_000 });
    must(clean.issues.length === 0, `αποκλίσεις: ${clean.issues.map((i) => i.detail).join(" | ")}`);
    await q(`INSERT INTO payment_transactions(owner_id,booking_id,provider,provider_reference,status,amount_cents,created_at) VALUES($1,$2,'stripe','pi_qa_orphan','succeeded',4200,$3)`, [owner, stay, now]);
    const dirty = await reconcile({ pool: db, owner, fromMs: now - 86_400_000 });
    must(dirty.issues.some((i) => i.kind === "provider_without_folio" && i.amountCents === 4200), "η απόκλιση δεν εντοπίστηκε");
    await q(`DELETE FROM payment_transactions WHERE provider_reference='pi_qa_orphan'`);
    return `σύνολα: πάροχοι €${(clean.totals.providerCents / 100).toFixed(2)} = folio online €${(clean.totals.folioOnlineCents / 100).toFixed(2)} · ορφανή πληρωμή €42 εντοπίστηκε`;
  });

  // Arrival today in the room that is not ready (no expected time), a failed instructions e-mail, a departure tomorrow with a balance.
  const arrival = Number((await q(`INSERT INTO bookings(owner_id,reference,guest_name,guest_email,guest_language,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES($1,'CR-QA-ARR','Anna QA','anna@example.invalid','de',$2,$3,'confirmed',$4,30000,0,$5) RETURNING id`, [owner, today, addDays(today, 3), R.dirty, now])).rows[0].id);
  await q(`INSERT INTO message_deliveries(owner_id,booking_id,event_key,channel,scheduled_at,status,last_error,created_at,updated_at) VALUES($1,$2,'checkin','email',$3,'failed','SMTP 550',$3,$3)`, [owner, arrival, now]);
  const leaving = Number((await q(`INSERT INTO bookings(owner_id,reference,guest_name,guest_email,guest_language,check_in,check_out,status,room_id,total_cents,balance_cents,created_at) VALUES($1,'CR-QA-BAL','Bal QA','bal@example.invalid','en',$2,$3,'checked_in',$4,40000,12500,$5) RETURNING id`, [owner, addDays(today, -2), addDays(today, 1), R.eta, now])).rows[0].id);

  await flow("F08", "Guest Journey: έλεγχος πριν την άφιξη, ειδοποίηση μία φορά, ανάκτηση, ιστορικό, επιβεβαίωση", async () => {
    const { runJourney } = await import(path.join(pmsDir, "scripts/journey-worker.mjs"));
    const r1 = await runJourney({ pool: db, owner, now: Date.now() });
    const hk = (await q(`SELECT id,status,detail FROM journey_actions WHERE booking_id=$1 AND step='hk_ready'`, [arrival])).rows[0];
    must(hk?.status === "failed", `hk_ready ${hk?.status}: ${hk?.detail}`);
    must(r1.actions.some((a) => a.action === "retry_deliveries"), "δεν έγινε επανάληψη του αποτυχημένου email");
    must((await q(`SELECT status FROM message_deliveries WHERE booking_id=$1`, [arrival])).rows[0].status === "pending", "το email δεν μπήκε ξανά σε αποστολή");
    await runJourney({ pool: db, owner, now: Date.now() + 6 * 60_000 });
    const alerts = (await q(`SELECT count(*)::int n FROM pms_notifications WHERE link='/pms/journey' AND title_el LIKE '%Anna QA%'`)).rows[0].n;
    must(alerts === 1, `${alerts} ειδοποιήσεις (αναμένεται 1)`);
    // Housekeeping approves the room → the next check confirms readiness.
    await q(`UPDATE housekeeping_tasks SET status='ready' WHERE room_id=$1`, [R.dirty]); await q(`UPDATE rooms SET operational_status='clean' WHERE id=$1`, [R.dirty]);
    await runJourney({ pool: db, owner, now: Date.now() + 12 * 60_000, force: true });
    const after = (await q(`SELECT status FROM journey_actions WHERE id=$1`, [hk.id])).rows[0].status;
    const hist = (await q(`SELECT status FROM journey_events WHERE action_id=$1 ORDER BY id`, [hk.id])).rows.map((x) => x.status);
    must(after === "succeeded" && hist.join(",") === "failed,succeeded", `κατάσταση ${after}, ιστορικό ${hist}`);
    return "δωμάτιο μη έτοιμο → αποτυχία + 1 ειδοποίηση → έγκριση → επιτυχία · αποτυχημένο email → αυτόματη επανάληψη";
  });

  // Send hour 00:00 (and settings older than the reminder) so the balance reminder is due whatever the time of the run.
  await q(`INSERT INTO message_automation_settings(owner_id,send_hour,updated_at) VALUES($1,0,0) ON CONFLICT(owner_id) DO UPDATE SET send_hour=0,updated_at=0`, [owner]);
  await flow("F09", "Cron πακέτου: ολοκληρώνεται, υπενθύμιση υπολοίπου 1 μέρα πριν την αναχώρηση, καταγραφή κάθε βήματος · χωρίς SMTP η υπενθύμιση ΔΕΝ μετριέται ως παραδομένη", async () => {
    const r = spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-message-automations.mjs"], { cwd: pmsDir, encoding: "utf8", timeout: 280_000, env: { ...process.env, SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_FROM: "qa@example.invalid" } });
    must(r.status !== null, `το cron δεν τελείωσε (${r.signal ?? "timeout"})`);
    const bal = (await q(`SELECT status,COALESCE(last_error,'') e FROM message_deliveries WHERE booking_id=$1 AND event_key='balance'`, [leaving])).rows;
    must(bal.length > 0, `δεν δημιουργήθηκε υπενθύμιση υπολοίπου · cron: ${(r.stderr || r.stdout).slice(-300)}`);
    // There is no mail server in this test (SMTP to a closed port): the reminder must be recorded as NOT delivered,
    // with its reason, and kept for another attempt — «sent» here would be a false delivery.
    must(["failed", "pending"].includes(bal[0].status) && bal[0].e, `υπενθύμιση: κατάσταση «${bal[0].status}» χωρίς SMTP (αναμένεται failed/pending με αιτία)`);
    const steps = (await q(`SELECT name,last_status FROM automation_status WHERE owner_id=$1`, [owner])).rows;
    must(steps.some((s) => s.name === "Guest messages"), `καταγραφές: ${steps.map((s) => s.name).join(", ")}`);
    // v189 heartbeat: the run's start and end are recorded and nothing is left «running».
    const hb = (await q(`SELECT last_status,running_since,runs,last_duration_ms FROM cron_heartbeat WHERE owner_id=$1 AND job='automations'`, [owner])).rows[0];
    must(hb && hb.last_status === "ok" && hb.running_since === null && Number(hb.runs) === 1, `heartbeat: ${JSON.stringify(hb)}`);
    const run = (await q(`SELECT status,finished_at,steps_ok FROM cron_runs WHERE owner_id=$1 AND job='automations'`, [owner])).rows;
    must(run.length === 1 && run[0].status === "ok" && run[0].finished_at, `cron_runs: ${JSON.stringify(run)}`);
    return { detail: `υπενθύμιση υπολοίπου: ${bal[0].status} (${bal[0].e.slice(0, 60)} — χωρίς SMTP στη δοκιμή) · ${steps.length} βήματα cron καταγράφηκαν · heartbeat: έναρξη + ολοκλήρωση σε ${hb.last_duration_ms} ms, ${run[0].steps_ok} βήματα OK`,
      evidence: { JOB_EXECUTION: "PASS", FAILURE_HANDLING: "PASS", DELIVERY: "NOT_TESTED" } };
  });

  await flow("F10", "Κλείδωμα Cloudflare: 403 χωρίς κλειδί, δεκτό με το σωστό κλειδί, λάθος κλειδί → 403, συμπεριφορά όταν σταματήσει το κλειδί, άμεση ειδοποίηση, ανάκτηση από τον server · smoke PMS και Booking", async () => {
    // v198: the lock is proven by requests, never assumed. The applications read the lock state at most every 30″, so
    // each change is awaited by polling until the applications show it (max 45″) — a timeout is a FAIL.
    const secret = `ce_${rnd(24, "base64url")}`, hash = createHash("sha256").update(secret).digest("hex");
    const avail = `/api/public/availability?checkIn=${addDays(today, 5)}&checkOut=${addDays(today, 6)}&adults=2&children=0&rooms=1&lang=en`;
    const get = (base, p, key) => fetch(`${base}${p}`, { headers: key ? { "x-corali-edge": key } : {}, redirect: "manual" }).then((r) => r.status);
    const until = async (what, fn) => { for (let i = 0; i < 90; i++) { if (await fn()) return; await sleep(500); } throw Error(`δεν επιβεβαιώθηκε μέσα σε 45″: ${what}`); };
    const set = (sql, p = []) => q(`UPDATE security_settings SET ${sql} WHERE owner_id=$1`, [owner, ...p]);
    const seen = [];
    await q(`INSERT INTO security_settings(owner_id,edge_secret_hash,edge_enforce,edge_last_seen_at,edge_stale_policy,updated_at) VALUES($1,$2,1,$3,'open_all',$3) ON CONFLICT(owner_id) DO UPDATE SET edge_secret_hash=$2,edge_enforce=1,edge_last_seen_at=$3,edge_stale_policy='open_all'`, [owner, hash, Date.now()]);
    try {
      // 1) Locked: no key → 403 on the booking page API and on the PMS administration API.
      await until("Booking: αίτημα χωρίς κλειδί → 403", async () => (await get(booking.url, avail)) === 403);
      await until("PMS: αίτημα διαχείρισης χωρίς κλειδί → 403", async () => (await get(pms.url, "/api/pms/security")) === 403);
      must((await get(booking.url, avail, `ce_${rnd(24, "base64url")}`)) === 403, "λάθος κλειδί δεν απορρίφθηκε");
      // 2) The right key passes (availability answers 200; the PMS API answers as without the lock: 401 without sign-in).
      const okAvail = await get(booking.url, avail, secret), okPms = await get(pms.url, "/api/pms/security", secret);
      must(okAvail === 200, `σωστό κλειδί: Booking HTTP ${okAvail}`); must(okPms !== 403, `σωστό κλειδί: PMS HTTP ${okPms}`);
      must((await get(pms.url, "/api/health")) === 200, "έλεγχος υγείας χωρίς κλειδί δεν απάντησε 200 (εξαίρεση)");
      seen.push(`χωρίς κλειδί 403 · λάθος κλειδί 403 · σωστό κλειδί ${okAvail}/${okPms}`);
      // Installer smoke checks with the lock on (their one-time token).
      for (const dir of [pmsDir, bookingDir]) { const r = spawnSync("bash", [path.join(dir, "scripts/smoke-runtime.sh"), dir, version], { encoding: "utf8", timeout: 180_000 }); must(r.status === 0, `${path.basename(dir)}: ${(r.stderr || r.stdout).slice(-300)}`); }
      // 3) The key stopped arriving (31′), policy «open_all»: documented fail-open — and an alert at once.
      await set(`edge_last_seen_at=$2`, [Date.now() - 31 * 60_000]);
      await until("open_all: μετά από 30′ χωρίς κλειδί το αίτημα περνά (τεκμηριωμένο fail-open)", async () => (await get(booking.url, avail)) === 200);
      await until("άμεση ειδοποίηση «security:edge_open»", async () => (await q(`SELECT 1 FROM alerts WHERE owner_id=$1 AND alert_key='security:edge_open' AND resolved_at IS NULL`, [owner])).rows.length === 1);
      seen.push("open_all: άνοιγμα μετά από 30′ + άμεση ειδοποίηση");
      // 4) Policy «protect_admin»: guest pages open, administration stays locked.
      await set(`edge_stale_policy='protect_admin'`);
      await until("protect_admin: διαχείριση PMS χωρίς κλειδί → 403", async () => (await get(pms.url, "/api/pms/security")) === 403 && (await get(pms.url, "/login")) === 403);
      must((await get(booking.url, avail)) === 200, "protect_admin: η σελίδα κρατήσεων έπρεπε να μείνει ανοιχτή");
      seen.push("protect_admin: πελάτες ανοιχτά, διαχείριση 403");
      // 5) Safe recovery from the server (packaged command), not a general opening.
      const rec = spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/edge-lock.mjs", "off"], { cwd: pmsDir, encoding: "utf8", timeout: 60_000 });
      must(rec.status === 0, `edge-lock.mjs off: ${(rec.stderr || rec.stdout).slice(-300)}`);
      await until("μετά την ανάκτηση από τον server η διαχείριση είναι προσβάσιμη", async () => (await get(pms.url, "/api/pms/security")) !== 403);
      must((await q(`SELECT 1 FROM audit_logs WHERE owner_id=$1 AND action='security.edge_off'`, [owner])).rows.length === 1, "η ανάκτηση δεν καταγράφηκε στο audit log");
      seen.push("ανάκτηση με scripts/edge-lock.mjs off (καταγράφηκε)");
      return seen.join(" · ");
    } finally {
      // Later flows make requests without the key: wait until both applications see the lock off.
      await set(`edge_enforce=0,edge_stale_policy='open_all'`);
      await q(`UPDATE alerts SET resolved_at=$2 WHERE owner_id=$1 AND alert_key='security:edge_open'`, [owner, Date.now()]);
      await until("κλείδωμα ανενεργό μετά το F10", async () => (await get(booking.url, avail)) !== 403 && (await get(pms.url, "/api/pms/security")) !== 403).catch(() => undefined);
    }
  });

  await flow("F12", "Κέντρο αξιοπιστίας: εντοπίζει μεταβολή διαθεσιμότητας που δεν συγχρονίστηκε και την ξαναστέλνει", async () => {
    const { checkReliability, recoverReliability } = await import(path.join(pmsDir, "scripts/reliability-core.mjs"));
    const id = Number((await q(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,attempts,last_error,created_at,updated_at) VALUES($1,$2,$3,'qa','failed',4,'Channex 503 (QA)',$4,$4) RETURNING id`, [owner, addDays(today, 10), addDays(today, 12), Date.now() - 45 * 60_000])).rows[0].id);
    const r = await checkReliability({ pool: db, owner });
    const ch = r.areas.find((a) => a.key === "channel");
    const it = ch.items.find((i) => i.key === `outbox:${id}`);
    must(ch.status === "fail" && it && it.action?.type === "retry_outbox", `channel ${ch.status}: ${JSON.stringify(ch.items).slice(0, 200)}`);
    must(await recoverReliability({ pool: db, owner, type: "retry_outbox", id }) === 1, "η επανάληψη δεν μπήκε στην ουρά");
    must((await q(`SELECT status FROM channel_sync_outbox WHERE id=$1`, [id])).rows[0].status === "pending", "δεν επανήλθε σε αναμονή");
    await q(`DELETE FROM channel_sync_outbox WHERE id=$1`, [id]);
    return `εντοπίστηκε («${it.text.slice(0, 70)}…») και μπήκε ξανά σε συγχρονισμό · ${r.areas.length} περιοχές ελέγχθηκαν`;
  });

  const cron = (extra = {}) => spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-message-automations.mjs"], { cwd: pmsDir, encoding: "utf8", timeout: 290_000, env: { ...process.env, SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_FROM: "qa@example.invalid", ...extra } });

  await flow("F13", "Cron: βήμα που τρέχει ακόμη δεν ξανατρέχει παράλληλα · αποτυχημένη αποστολή ειδοποίησης καταγράφεται και επαναλαμβάνεται (όχι παράδοση)", async () => {
    const { raiseAlert } = await import(path.join(pmsDir, "scripts/alert-core.mjs"));
    const before = (await q(`SELECT last_run_at FROM automation_status WHERE owner_id=$1 AND name='Guest messages'`, [owner])).rows[0].last_run_at;
    // The previous run still holds «Guest messages» (its lease expires in 5 minutes).
    await q(`INSERT INTO job_leases(owner_id,lease_key,holder,acquired_at,expires_at) VALUES($1,'step:Guest messages','qa-previous-run',$2,$3)`, [owner, Date.now(), Date.now() + 300_000]);
    const a = await raiseAlert({ pool: db, owner, key: "qa:alert", area: "automations", severity: "fail", title: "QA: κρίσιμη ειδοποίηση", emails: ["qa@example.invalid"] });
    must(a.fresh, "η ειδοποίηση δεν δημιουργήθηκε");
    const r = cron();
    must(r.status !== null, `το cron δεν τελείωσε (${r.signal ?? "timeout"})`);
    const after = (await q(`SELECT last_run_at FROM automation_status WHERE owner_id=$1 AND name='Guest messages'`, [owner])).rows[0].last_run_at;
    must(String(after) === String(before), "το βήμα «Guest messages» έτρεξε ενώ το κρατούσε η προηγούμενη εκτέλεση");
    const skipped = (await q(`SELECT steps_skipped FROM cron_runs WHERE owner_id=$1 AND job='automations' ORDER BY id DESC LIMIT 1`, [owner])).rows[0];
    must(Number(skipped.steps_skipped) >= 1, `steps_skipped ${skipped.steps_skipped}`);
    // Deliveries attempted, failure recorded with its reason, scheduled again — never reported «sent».
    const box = (await q(`SELECT channel,status,attempts,last_error,next_attempt_at FROM alert_outbox WHERE alert_id=$1 ORDER BY channel`, [a.id])).rows;
    must(box.length === 2 && box.every((b) => b.status === "pending" && Number(b.attempts) === 1 && b.last_error && Number(b.next_attempt_at) > Date.now()), `outbox: ${JSON.stringify(box)}`);
    await q(`DELETE FROM job_leases WHERE holder='qa-previous-run'`);
    return { detail: `«Guest messages» παραλείφθηκε (κρατούσε η προηγούμενη εκτέλεση), ${skipped.steps_skipped} βήμα · αποτυχημένη αποστολή ειδοποίησης καταγράφηκε και ξαναπρογραμματίστηκε: ${box.map((b) => `${b.channel} → ${b.last_error.slice(0, 40)}`).join(" · ")}`,
      evidence: { JOB_EXECUTION: "PASS", FAILURE_HANDLING: "PASS", DELIVERY: "NOT_TESTED" } };
  });

  await flow("F14", "Αντίγραφο ασφαλείας: κρυπτογραφημένο backup, δοκιμαστική επαναφορά σε ξεχωριστή βάση, μέτρηση εγγραφών, αλλοιωμένο αρχείο απορρίπτεται", async () => {
    const bin = pgBin();
    must(bin && existsSync(path.join(bin, "pg_dump")) && existsSync(path.join(bin, "pg_restore")), "pg_dump / pg_restore δεν βρέθηκαν");
    const u = new URL(dbUrl);
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect(); await admin.query("CREATE DATABASE corali_rehearsal"); await admin.end();
    const rehearsal = new URL(dbUrl); rehearsal.pathname = "/corali_rehearsal";
    const backups = path.join(work, "backups");
    const env = { BACKUP_DIR: backups, PG_DUMP_BIN: path.join(bin, "pg_dump"), PG_RESTORE_BIN: path.join(bin, "pg_restore"), REHEARSAL_EVERY_RUN: "1", REHEARSAL_DATABASE_URL: rehearsal.toString() };
    const r = spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-db-backup.mjs"], { cwd: pmsDir, encoding: "utf8", timeout: 240_000, env: { ...process.env, ...env } });
    must(r.status === 0, `backup/rehearsal: ${(r.stderr || r.stdout).slice(-400)}`);
    const runs = (await q(`SELECT kind,status,file,details_json,error FROM backup_runs WHERE owner_id=$1 ORDER BY id`, [owner])).rows;
    const bk = runs.find((x) => x.kind === "backup"), rh = runs.find((x) => x.kind === "rehearsal");
    must(bk?.status === "ok" && rh?.status === "ok", `backup ${bk?.status} ${bk?.error ?? ""} · rehearsal ${rh?.status} ${rh?.error ?? ""}`);
    const d = JSON.parse(rh.details_json);
    must(d.restored && d.restored.bookings === d.liveBefore.bookings && d.restored.bookings > 0, `επαναφορά: ${JSON.stringify(d.restored)} / ${JSON.stringify(d.liveBefore)}`);
    const left = new pg.Client({ connectionString: rehearsal.toString() });
    await left.connect(); const tables = (await left.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((x) => x.table_name); await left.end();
    must(tables.length === 1 && tables[0] === "corali_rehearsal_target", `η βάση δοκιμής δεν άδειασε (${tables.join(", ")})`);
    // A damaged backup must fail the rehearsal, never pass it.
    const file = path.join(backups, rh.file), buf = readFileSync(file); buf[buf.length - 40] ^= 0xff; writeFileSync(file, buf);
    const bad = spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-restore-rehearsal.mjs", backups], { cwd: pmsDir, encoding: "utf8", timeout: 120_000, env: { ...process.env, ...env } });
    const last = (await q(`SELECT status,error FROM backup_runs WHERE owner_id=$1 AND kind='rehearsal' ORDER BY id DESC LIMIT 1`, [owner])).rows[0];
    must(bad.status !== 0 && last.status === "failed" && /Αποκρυπτογράφηση/.test(last.error), `αλλοιωμένο: ${last.status} ${last.error}`);
    void u;
    return `backup ${rh.file} · επαναφορά σε corali_rehearsal: ${Object.entries(d.restored).map(([k, v]) => `${k} ${v}`).join(", ")} = ζωντανή βάση · ${d.checks.length} έλεγχοι OK · βάση δοκιμής άδειασε · αλλοιωμένο αρχείο → failed`;
  });

  await flow("F15", "Έλεγχος μετά την εγκατάσταση: κάθε ON CONFLICT στη βάση, πίνακες σχήματος, αποτυχία όταν λείπει μοναδικό index", async () => {
    const check = () => spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/post-install-check.mjs", pmsDir, version], { cwd: pmsDir, encoding: "utf8", timeout: 120_000 });
    const ok = check();
    must(ok.status === 0, `έλεγχος: ${(ok.stderr || ok.stdout).slice(-400)}`);
    const row = (await q(`SELECT status,checks_json FROM release_checks WHERE scope='installation' ORDER BY id DESC LIMIT 1`)).rows[0];
    const checks = JSON.parse(row.checks_json);
    must(checks.find((c) => c.name.startsWith("ON CONFLICT"))?.status === "ok" && checks.find((c) => c.name.startsWith("Πίνακες"))?.status === "ok", JSON.stringify(checks));
    // The v187 fault again (the full unique index missing): the check must stop the installation.
    await q(`DROP INDEX "idx_payment_provider_reference_all"`);
    try {
      const bad = check();
      must(bad.status !== 0 && /ON CONFLICT/.test(bad.stdout + bad.stderr), `δεν απέτυχε χωρίς το index: ${bad.status}`);
    } finally { await q(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_provider_reference_all" ON "payment_transactions" ("provider", "provider_reference")`); }
    return `${checks.map((c) => `${c.status === "ok" ? "✓" : "!"} ${c.name}: ${c.detail}`).join(" · ")} · χωρίς το index → η εγκατάσταση σταματά`;
  });

  await flow("F16", "Συμφωνία OTA: διαθεσιμότητα που στάλθηκε ≠ τρέχουσα εντοπίζεται και ξαναστέλνεται", async () => {
    const { otaReconcile, queueOtaResync } = await import(path.join(pmsDir, "scripts/ota-reconcile-core.mjs"));
    const day = addDays(today, 20);
    await q(`DELETE FROM channel_sync_outbox WHERE owner_id=$1`, [owner]);
    await q(`INSERT INTO channel_availability_state(owner_id,room_type,date,available,pushed_at) VALUES($1,'qa-101',$2,3,$3) ON CONFLICT(owner_id,room_type,date) DO UPDATE SET available=3`, [owner, day, Date.now()]);
    const r = await otaReconcile({ pool: db, owner, days: 30 });
    const m = r.mismatches.find((x) => x.roomType === "qa-101" && x.from === day);
    must(m && m.ota === 3 && m.pms !== 3, `αποκλίσεις: ${JSON.stringify(r.mismatches)}`);
    await queueOtaResync({ pool: db, owner, mismatches: [m] });
    must(!(await otaReconcile({ pool: db, owner, days: 30 })).mismatches.some((x) => x.roomType === "qa-101" && x.from === day), "η απόκλιση παρέμεινε μετά την επανάληψη");
    await q(`DELETE FROM channel_sync_outbox WHERE owner_id=$1 AND reason='reconcile'`, [owner]);
    await q(`DELETE FROM channel_availability_state WHERE owner_id=$1`, [owner]);
    return `${r.checked} ημέρες×τύποι · qa-101 ${day}: στάλθηκε ${m.ota}, PMS ${m.pms} → μπήκε σε αποστολή`;
  });

  await flow("F17", "Δοκιμαστική επαναφορά: αρνείται τη βάση παραγωγής με άλλο όνομα και ξένη βάση · καθαρίζει ακόμη κι όταν αποτύχει στη μέση", async () => {
    const bin = pgBin();
    const backups = path.join(work, "backups");
    const rehearsalRun = (target, extra = {}) => spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-restore-rehearsal.mjs", backups], { cwd: pmsDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, PG_RESTORE_BIN: path.join(bin, "pg_restore"), REHEARSAL_DATABASE_URL: target, ...extra } });
    const last = async () => (await q(`SELECT status,error,details_json FROM backup_runs WHERE owner_id=$1 AND kind='rehearsal' ORDER BY id DESC LIMIT 1`, [owner])).rows[0];
    // A fresh, valid backup (F14 damaged the previous one).
    const b = spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-db-backup.mjs"], { cwd: pmsDir, encoding: "utf8", timeout: 240_000, env: { ...process.env, BACKUP_DIR: backups, PG_DUMP_BIN: path.join(bin, "pg_dump"), REHEARSAL_EVERY_RUN: "0" } });
    must(b.status === 0, `backup: ${(b.stderr || b.stdout).slice(-300)}`);
    const bookingsBefore = Number((await q(`SELECT count(*)::int n FROM bookings`)).rows[0].n);
    // 1) The live database under another host name (same server, same database): found by the guard value.
    const alias = dbUrl.replace("@localhost:", "@qa-alias:");
    must(alias !== dbUrl, "δεν δημιουργήθηκε εναλλακτική διεύθυνση");
    const r1 = rehearsalRun(alias);
    const l1 = await last();
    must(r1.status !== 0 && l1.status === "failed" && /βάση παραγωγής/.test(l1.error), `παραγωγή με άλλο όνομα: ${l1.status} ${l1.error}`);
    must(Number((await q(`SELECT count(*)::int n FROM bookings`)).rows[0].n) === bookingsBefore, "η βάση παραγωγής άλλαξε");
    // 2) A database that holds something else.
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect(); await admin.query("CREATE DATABASE corali_foreign"); await admin.end();
    const foreign = new URL(dbUrl); foreign.pathname = "/corali_foreign";
    const f = new pg.Client({ connectionString: foreign.toString() });
    await f.connect(); await f.query("CREATE TABLE invoices(id int)"); await f.end();
    const r2 = rehearsalRun(foreign.toString());
    const l2 = await last();
    must(r2.status !== 0 && /δεν είναι κενή \(invoices\)/.test(l2.error), `ξένη βάση: ${l2.status} ${l2.error}`);
    // 3) pg_restore writes the data and then fails: the rehearsal database must still be emptied.
    const wrapper = path.join(work, "pg_restore_fails.sh");
    writeFileSync(wrapper, `#!/bin/bash\nfor a in "$@"; do [[ "$a" == "--list" ]] && exec "${path.join(bin, "pg_restore")}" "$@"; done\n"${path.join(bin, "pg_restore")}" "$@"; echo "simulated failure after restore" >&2; exit 1\n`, { mode: 0o755 });
    const rehearsal = new URL(dbUrl); rehearsal.pathname = "/corali_rehearsal";
    const r3 = rehearsalRun(rehearsal.toString(), { PG_RESTORE_BIN: wrapper });
    const l3 = await last();
    const d3 = JSON.parse(l3.details_json || "{}");
    const t = new pg.Client({ connectionString: rehearsal.toString() });
    await t.connect(); const left = (await t.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((x) => x.table_name); await t.end();
    must(r3.status !== 0 && l3.status === "failed" && /επαναφορά απέτυχε/.test(l3.error), `αποτυχία στη μέση: ${l3.status} ${l3.error}`);
    must(left.length === 1 && left[0] === "corali_rehearsal_target", `έμειναν πίνακες: ${left.join(", ")}`);
    must((d3.checks ?? []).some((c) => c.name === "Καθαρισμός βάσης δοκιμής" && c.ok), `καθαρισμός: ${JSON.stringify(d3.checks)}`);
    return `άλλο όνομα της παραγωγής → άρνηση (η παραγωγή ανέγγιχτη, ${bookingsBefore} κρατήσεις) · ξένη βάση (invoices) → άρνηση · αποτυχία μετά την επαναφορά → η βάση δοκιμής άδειασε (μόνο ο δείκτης «${left[0]}»)`;
  });

  await flow("F18", "Channel sync πακέτου απέναντι σε ψεύτικο Channex: μόνο όσα στάλθηκαν γίνονται «sent», πέρα από 500 ημέρες OUT_OF_RANGE, warnings → αποτυχία, μερική ανάγνωση ≠ συμφωνία", async () => {
    // A local Channex stand-in: records every availability POST; answers the read-back with only part of the dates.
    const posts = [];
    let warn = false;
    const srv = http.createServer((req, res) => {
      let body = ""; req.on("data", (d) => { body += d; }); req.on("end", () => {
        const u = new URL(req.url, "http://x"), json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
        if (u.pathname.endsWith("/booking_revisions/feed")) return json({ data: [], meta: {} });
        if (u.pathname.endsWith("/availability") && req.method === "POST") { posts.push(JSON.parse(body).values); return json({ data: [{ id: "t1", type: "task" }], meta: { message: "Success", ...(warn ? { warnings: [{ date: "x", warning: "QA: value not applied" }] } : {}) } }); }
        if (u.pathname.endsWith("/availability")) return json({ data: { "ext-qa-101": { [addDays(today, 2)]: 1 } } });
        if (u.pathname.endsWith("/channels")) return json({ data: [{ id: "c1", attributes: { title: "Booking.com (QA)", is_active: true } }] });
        json({ data: [] });
      });
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const key = createHash("sha256").update(documentKey).digest(), iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(JSON.stringify({ apiKey: "qa-key" }), "utf8"), c.final()]);
      const sealed = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
      await q(`INSERT INTO provider_connections(owner_id,provider_key,active,settings_json,secrets_encrypted,updated_by,updated_at) VALUES($1,'channelManager',1,$2,$3,'qa',$4) ON CONFLICT(owner_id,provider_key) DO UPDATE SET active=1,settings_json=$2,secrets_encrypted=$3`, [owner, JSON.stringify({ propertyCode: "qa-prop", environment: "staging" }), sealed, Date.now()]);
      await q(`DELETE FROM channel_sync_outbox WHERE owner_id=$1`, [owner]);
      // No hourly drift push in this run (one was «just made»), so only the rows below are in play.
      await q(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,created_at,updated_at) VALUES($1,$2,$2,'drift','sent',$3,$3)`, [owner, today, Date.now()]);
      const ins = async (f, t) => Number((await q(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,created_at,updated_at) VALUES($1,$2,$3,'qa',$4,$4) RETURNING id`, [owner, f, t, Date.now()])).rows[0].id);
      const ids = { far: await ins(addDays(today, 600), addDays(today, 601)) };
      // Asynchronous: the Channex stand-in lives in this process and must keep answering while the sync runs.
      const sync = (extra = {}) => new Promise((resolve) => {
        const ch = spawn(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-channel-sync.mjs"], { cwd: pmsDir, env: { ...process.env, CHANNEX_BASE_URL: base, ...extra } });
        let out = "", err = "";
        ch.stdout.on("data", (d) => { out += d; }); ch.stderr.on("data", (d) => { err += d; });
        const t = setTimeout(() => ch.kill("SIGKILL"), 120_000);
        ch.on("close", (status) => { clearTimeout(t); resolve({ status, stdout: out, stderr: err }); });
      });
      const st = async (id) => (await q(`SELECT status,date_to,last_error FROM channel_sync_outbox WHERE id=$1`, [id])).rows[0];
      // 1) Only a far-future row (the v191 fault): nothing is sent and nothing is marked sent.
      let r = await sync();
      must(r.status === 0, `sync: ${(r.stderr || r.stdout).slice(-300)}`);
      must(posts.length === 0, `έγινε αποστολή (${posts.length})`);
      const far = await st(ids.far);
      must(far.status === "out_of_range", `πέρα από 500 ημέρες: ${far.status}`);
      // 2) Normal, past and straddling rows.
      ids.normal = await ins(addDays(today, 3), addDays(today, 4));
      ids.past = await ins(addDays(today, -10), addDays(today, -5));
      ids.cross = await ins(addDays(today, 499), addDays(today, 502));
      r = await sync();
      must(r.status === 0, `sync 2: ${(r.stderr || r.stdout).slice(-300)}`);
      const [n, p, x] = [await st(ids.normal), await st(ids.past), await st(ids.cross)];
      must(n.status === "sent" && p.status === "skipped" && x.status === "sent" && x.date_to === addDays(today, 500), `normal ${n.status} · past ${p.status} · cross ${x.status} ${x.date_to}`);
      const rest = (await q(`SELECT status FROM channel_sync_outbox WHERE owner_id=$1 AND date_from=$2 AND date_to=$3`, [owner, addDays(today, 501), addDays(today, 502)])).rows;
      must(rest.length === 1 && rest[0].status === "out_of_range", `υπόλοιπο πέρα από το όριο: ${JSON.stringify(rest)}`);
      const sentDates = posts.flat().filter((v) => v.room_type_id === "ext-qa-101");
      must(sentDates.length > 0 && sentDates.every((v) => v.date_from >= today && v.date_to <= addDays(today, 500)), "στάλθηκαν ημερομηνίες εκτός ορίων");
      // 3) Channex answers 200 with warnings: not sent.
      warn = true;
      ids.warned = await ins(addDays(today, 6), addDays(today, 6));
      await sync();
      const w = await st(ids.warned);
      must(w.status === "failed" && /CHANNEX_WARNINGS/.test(w.last_error), `warnings: ${w.status} ${w.last_error}`);
      warn = false;
      // 4) Read-back that returns only part of the dates: never «full agreement».
      await q(`DELETE FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed')`, [owner]);
      await sync({ CHANNEL_READBACK_NOW: "1" });
      const rb = (await q(`SELECT status,totals_json FROM reconciliation_runs WHERE owner_id=$1 AND kind='ota_readback' ORDER BY id DESC LIMIT 1`, [owner])).rows[0];
      const t = JSON.parse(rb?.totals_json ?? "{}");
      must(rb && t.NOT_RETURNED > 0 && t.responseComplete === false && t.fullyReconciled === false && Array.isArray(t.channels) && t.channels[0]?.title === "Booking.com (QA)", `ανάγνωση: ${rb?.status} ${rb?.totals_json}`);
      return `μόνο μακρινή ημερομηνία → καμία αποστολή, out_of_range · κανονική → sent · παρελθόν → skipped · διάστημα στο όριο → sent έως +500 και το υπόλοιπο out_of_range · warnings → failed · ανάγνωση: ${t.MATCHED} ίδιες, ${t.NOT_RETURNED} δεν επιστράφηκαν → όχι συμφωνία · κανάλι «${t.channels[0].title}» CHANNEL_NOT_VERIFIED`;
    } finally {
      srv.close();
      await q(`UPDATE provider_connections SET active=0 WHERE owner_id=$1 AND provider_key='channelManager'`, [owner]);
    }
  });

  await flow("F19", "Εμπειρία πελάτη: Comfort Score δωματίου με πελάτη, επιβεβαιωμένη παράδοση μετά το check-out, επαναλαμβανόμενη αιτία → εργασία συντήρησης", async () => {
    const { comfortBoard } = await import(path.join(pmsDir, "scripts/comfort-core.mjs"));
    const { turnoverBoard, confirmEquipment, verifyTurnover } = await import(path.join(pmsDir, "scripts/turnover-core.mjs"));
    const { rootCauses, actOnFinding } = await import(path.join(pmsDir, "scripts/root-cause-core.mjs"));
    const t0 = Date.now(), H = 3_600_000, D = 86_400_000;
    const rid = Number((await q(`INSERT INTO rooms(owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES($1,'QA9','qa-x',2,1,10000,'clean') RETURNING id`, [owner])).rows[0].id);
    const bk = async (ref, status, extra = {}) => Number((await q(`INSERT INTO bookings(owner_id,reference,guest_name,check_in,check_out,status,room_id,total_cents,balance_cents,created_at,checked_out_at) VALUES($1,$2,'QA Guest',$3,$4,$5,$6,10000,0,$7,$8) RETURNING id`, [owner, ref, extra.ci ?? addDays(today, -2), extra.co ?? addDays(today, 2), status, rid, t0, extra.out ?? null])).rows[0].id);
    // Comfort: guest in the room, hot room, an A/C problem open for 3 hours.
    const stay = await bk("QA-STAY", "checked_in");
    await q(`INSERT INTO room_climate(owner_id,room_id,device_id,temp,humidity,read_at,updated_at) VALUES($1,$2,'qa',29.4,60,$3,$3)`, [owner, rid, t0 - 5 * 60_000]);
    await q(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,$2,$3,'problem','open',$4,'{"problem":"ac"}')`, [owner, rid, stay, t0 - 3 * H]);
    const c = (await comfortBoard({ pool: db, owner })).rooms.find((r) => r.roomId === rid);
    must(c && c.level === "act" && c.signals.some((x) => x.key === "temp") && c.signals.some((x) => x.label === "Τεχνικό πρόβλημα"), `comfort: ${JSON.stringify(c)}`);
    // Turnover: checked out 2 hours ago, Wi-Fi still active → not verifiable; then the evidence → verified.
    await q(`UPDATE bookings SET status='checked_out',checked_out_at=$2 WHERE id=$1`, [stay, t0 - 2 * H]);
    await q(`INSERT INTO guest_wifi(owner_id,booking_id,room_id,psk_name,status,created_at) VALUES($1,$2,$3,'qa','active',$4)`, [owner, stay, rid, t0 - D]);
    let v = await verifyTurnover({ pool: db, owner, bookingId: stay, by: "QA" });
    must(!v.ok && v.blocking.length >= 2, `επιβεβαιώθηκε χωρίς στοιχεία: ${JSON.stringify(v)}`);
    await q(`INSERT INTO housekeeping_tasks(owner_id,room_id,task_type,status,completed_at,inspection_status,inspected_at) VALUES($1,$2,'departure_clean','ready',$3,'approved',$4)`, [owner, rid, t0 - H, t0 - 50 * 60_000]);
    await q(`UPDATE guest_wifi SET status='removed',removed_at=$2 WHERE booking_id=$1`, [stay, t0 - H]);
    await confirmEquipment({ pool: db, owner, bookingId: stay, roomId: rid, by: "QA", note: "OK" });
    v = await verifyTurnover({ pool: db, owner, bookingId: stay, by: "QA" });
    const tb = (await turnoverBoard({ pool: db, owner })).turnovers.find((x) => x.bookingId === stay);
    must(v.ok && tb.status === "verified" && tb.steps.wifi.state === "done", `παράδοση: ${JSON.stringify(v)} ${tb?.status}`);
    // v194: a serious fault after the confirmation → still verified (documented), but NOT ready now.
    await q(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES($1,$2,'major','QA: διαρροή νερού',$3)`, [owner, rid, Date.now()]);
    const reg = (await turnoverBoard({ pool: db, owner })).turnovers.find((x) => x.bookingId === stay);
    must(reg.status === "verified" && reg.verifiedAt && reg.current.state === "not_ready" && reg.regressed, `δυναμική ετοιμότητα: ${JSON.stringify(reg.current)}`);
    must((await verifyTurnover({ pool: db, owner, bookingId: stay, by: "QA" })).already === true, "δεύτερη επιβεβαίωση");
    // Root cause: A/C reported in 3 different stays of the same room → finding → one maintenance task.
    for (const [i, d] of [[1, 40], [2, 25]]) { const b = await bk(`QA-OLD${i}`, "checked_out", { ci: addDays(today, -d), co: addDays(today, -d + 2), out: t0 - d * D }); await q(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,handled_at,details_json) VALUES($1,$2,$3,'problem','done',$4,$4,'{"problem":"ac"}')`, [owner, rid, b, t0 - d * D]); }
    const f = (await rootCauses({ pool: db, owner })).findings.find((x) => x.key === `room:${rid}:ac`);
    must(f && /QA9: «Κλιματιστικό» 3 φορές σε 3 διαφορετικές διαμονές/.test(f.title), `αιτίες: ${JSON.stringify(f)}`);
    const a = await actOnFinding({ pool: db, owner, key: f.key, action: "maintenance", userId: null });
    const again = await actOnFinding({ pool: db, owner, key: f.key, action: "maintenance", userId: null });
    must(a.ok && a.maintenanceId && again.already, `εργασία: ${JSON.stringify(a)} ${JSON.stringify(again)}`);
    // v195: a lasting resolution case follows the repair, independent of the finding.
    const rcase = (await rootCauses({ pool: db, owner })).cases.find((x) => x.maintenanceId === a.maintenanceId);
    must(rcase && rcase.state === "OPEN_TASK", `περίπτωση επίλυσης: ${JSON.stringify(rcase)}`);
    await q(`UPDATE maintenance_notices SET status='resolved',resolved_at=$2,resolution_notes='QA' WHERE owner_id=$1 AND room_id=$3 AND description='QA: διαρροή νερού'`, [owner, Date.now(), rid]);
    return `δωμάτιο QA9 με πελάτη: δείκτης ${c.score} (${c.signals.map((x) => x.label).join(", ")}) · παράδοση: χωρίς στοιχεία απορρίφθηκε, με τα στοιχεία → ${tb.status} · νέα σοβαρή βλάβη → επιβεβαιωμένο αλλά «τώρα δεν είναι έτοιμο» · αιτία «${f.title}» → εργασία συντήρησης #${a.maintenanceId} (μία φορά)`;
  });

  await flow("F11", "Αυτόματα tests του κώδικα (unit / integration)", async () => {
    const files = readdirSync(path.join(project, "tests")).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("tests", f));
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap", ...files], { cwd: project, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    testTap = r.stdout + (r.stderr ? `\n# stderr\n${r.stderr}` : "");
    const n = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, "m")) ?? [])[1] ?? NaN);
    must(n("fail") === 0 && n("pass") > 0, `pass ${n("pass")}, fail ${n("fail")}: ${(r.stdout.match(/^not ok .*/gm) ?? []).slice(0, 5).join(" | ")}`);
    return `${n("pass")}/${n("tests")} PASS`;
  });
} finally {
  for (const c of children) { try { c.kill("SIGTERM"); } catch { /* gone */ } }
  await db?.end().catch(() => {});
  stopPg();
}

// External providers in their sandbox (only with test keys in the environment).
const sandboxFile = path.join(work, "sandbox.json");
spawnSync(process.execPath, [path.join(project, "scripts/provider-sandbox-e2e.mjs"), sandboxFile], { encoding: "utf8", timeout: 180_000 });
const sandbox = existsSync(sandboxFile) ? JSON.parse(readFileSync(sandboxFile, "utf8")).results : [];

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────────
const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
const commit = (() => { try { return execFileSync("git", ["-C", project, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "—"; } })();
const failed = results.filter((r) => r.status === "FAIL").length + sandbox.filter((r) => r.status === "FAIL").length;
// v192 acceptance criterion: internal QA PASS *and* every external provider check PASS in its sandbox. A package can be
// built and inspected without it, but it is NOT ACCEPTED, and the installer refuses it unless the operator explicitly
// accepts uncertified providers (recorded).
const sandboxNotPassed = sandbox.filter((r) => r.status !== "PASS");
const acceptance = failed ? { status: "NOT_ACCEPTED", reasons: ["εσωτερικές ροές QA με FAIL"] }
  : !sandbox.length ? { status: "NOT_ACCEPTED", reasons: ["δεν εκτελέστηκαν έλεγχοι παρόχων"] }
  : sandboxNotPassed.length ? { status: "NOT_ACCEPTED", reasons: sandboxNotPassed.map((r) => `${r.name}: ${r.status}`) }
  : { status: "ACCEPTED", reasons: [] };
const report = { version, verdict: failed ? "FAIL" : "PASS", acceptance, at: new Date().toISOString(), durationMs: Date.now() - started, package: { file: path.basename(archive), sha256: sha }, commit, node: process.version, database: env.database ?? "—", flows: results, sandbox };
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  `# Hotel Corali PMS ${version} — έκθεση ελέγχου ποιότητας`, "",
  `**Αποτέλεσμα: ${report.verdict}** · ${results.filter((r) => r.status === "PASS").length}/${results.length} ροές PASS · ${new Date(report.at).toLocaleString("el-GR", { timeZone: "Europe/Athens" })}`, "",
  `**Αποδοχή έκδοσης: ${acceptance.status === "ACCEPTED" ? "✅ ACCEPTED" : "⛔ NOT ACCEPTED"}**${acceptance.reasons.length ? ` — ${acceptance.reasons.join(" · ")}` : ""} (απαιτεί PASS και στους εξωτερικούς παρόχους σε sandbox)`, "",
  `- Πακέτο: \`${report.package.file}\` · SHA-256 \`${sha}\``, `- Κώδικας: commit \`${commit}\` · Node ${process.version} · ${report.database}`,
  `- Αναπαραγωγή: \`node scripts/release-qa.mjs ${report.package.file} ${version}\` (νέα βάση PostgreSQL, οι εφαρμογές του πακέτου σε λειτουργία, πραγματικά αιτήματα HTTP και το cron του πακέτου).`, "",
  "| # | Κρίσιμη ροή | Αποτέλεσμα | Τι αποδεικνύει | Λεπτομέρειες | ms |", "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${esc(r.name)} | ${r.status === "PASS" ? "✅ PASS" : "❌ FAIL"} | ${r.evidence ? Object.entries(r.evidence).map(([k, v]) => `${k}_${v}`).join("<br>") : ""} | ${esc(r.detail)} | ${r.ms} |`), "",
  "**Επίπεδα τεκμηρίωσης αποστολών:** `JOB_EXECUTION_PASS` — ο αυτοματισμός εκτελέστηκε · `FAILURE_HANDLING_PASS` — η αποτυχημένη αποστολή καταγράφηκε με την αιτία της και μπήκε σε επανάληψη · `DELIVERY_CONFIRMED` — το μήνυμα παραδόθηκε / επιβεβαιώθηκε από τον πάροχο. Οι εσωτερικές ροές τρέχουν χωρίς πραγματικό πάροχο, άρα `DELIVERY_NOT_TESTED`· επιβεβαιωμένη παράδοση προκύπτει μόνο από τους ελέγχους παρόχων σε sandbox (παρακάτω).", "",
  "## Εξωτερικοί πάροχοι (sandbox)", "",
  "Τρέχουν με κλειδιά δοκιμής (`node scripts/provider-sandbox-e2e.mjs`): Stripe test mode, Viva demo, Channex staging, WhatsApp test number. Χωρίς κλειδί: NOT RUN — δεν θεωρείται PASS.", "",
  "| Ροή | Έλεγχος | Αποτέλεσμα | Λεπτομέρειες |", "|---|---|---|---|",
  ...sandbox.map((r) => `| ${esc(r.flow)} | ${esc(r.name)} | ${r.status === "PASS" ? "✅ PASS" : r.status === "FAIL" ? "❌ FAIL" : "⏸ NOT RUN"} | ${esc(r.detail)} |`), "",
].join("\n");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `QA-REPORT-${version}.md`), md);
writeFileSync(path.join(outDir, `qa-report-${version}.json`), JSON.stringify(report, null, 2));
// v196 evidence logs (see the top of the file).
const logDir = path.join(outDir, `qa-logs-${version}`);
rmSync(logDir, { recursive: true, force: true }); mkdirSync(logDir, { recursive: true });
for (const [k, lines] of flowLogs) writeFileSync(path.join(logDir, `${k}.log`), `${lines.join("\n")}\n`);
for (const a of appLogs) writeFileSync(path.join(logDir, `app-${a.name}.log`), mask(a.get()));
if (testTap) writeFileSync(path.join(logDir, "tests.tap"), mask(testTap));
writeFileSync(path.join(logDir, "sandbox.json"), JSON.stringify(sandbox, null, 2));
writeFileSync(path.join(logDir, "REPRODUCE.md"), [
  `# Αναπαραγωγή του ελέγχου ${version}`, "",
  `Πακέτο \`${report.package.file}\` (SHA-256 \`${sha}\`) · commit \`${commit}\` · Node ${process.version} · ${report.database}.`, "",
  "Από τον πηγαίο κώδικα (corali-pms-source-*.tar.gz) σε μηχάνημα με Node 22+, pnpm και PostgreSQL 16+ (ή QA_DATABASE_URL προς άδεια βάση):", "",
  "```bash", "pnpm install --frozen-lockfile", "pnpm test            # → tests.tap", `bash scripts/package-cpanel.sh   # χτίζει το πακέτο και τρέχει: node scripts/release-qa.mjs <πακέτο> ${version} docs/qa`, "```", "",
  "Μόνο ο έλεγχος σε ήδη χτισμένο πακέτο:", "", "```bash", `node scripts/release-qa.mjs ${report.package.file} ${version} /tmp/qa-out`, "```", "",
  "Ένα αρχείο `<ροή>.log` ανά κρίσιμη ροή (κάθε εντολή με κωδικό εξόδου και έξοδο, το σφάλμα με stack), `app-*.log` η έξοδος των εφαρμογών, `tests.tap` όλα τα αυτόματα tests, `sandbox.json` οι έλεγχοι παρόχων (NOT RUN χωρίς κλειδιά δοκιμής).",
  "Κλειδιά και κωδικοί του προσωρινού περιβάλλοντος εμφανίζονται ως «masked».", "",
].join("\n"));
rmSync(work, { recursive: true, force: true });
console.log(`\nQA ${version}: ${report.verdict} — ${path.join(outDir, `QA-REPORT-${version}.md`)}`);
process.exit(failed ? 1 : 0);
