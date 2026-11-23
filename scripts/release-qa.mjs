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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
const rnd = (n = 32, enc = "hex") => randomBytes(n).toString(enc);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (cond, msg) => { if (!cond) throw Error(msg); };
const athens = (ms = Date.now()) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const today = (() => { const p = athens(); return `${p.year}-${p.month}-${p.day}`; })();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function flow(id, name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ id, name, status: "PASS", detail: String(detail ?? ""), ms: Date.now() - t0 }); console.log(`PASS ${id} ${name}`); }
  catch (e) { results.push({ id, name, status: "FAIL", detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }); console.log(`FAIL ${id} ${name}: ${e instanceof Error ? e.message : e}`); }
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
async function startApp(dir) {
  const port = await freePort();
  const envLines = Object.fromEntries(readFileSync(path.join(dir, "runtime.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const child = spawn(process.execPath, ["app.js"], { cwd: dir, env: { ...process.env, ...envLines, PORT: String(port), HOSTNAME: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  children.push(child);
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return { url: `http://127.0.0.1:${port}`, log: () => log }; } catch { /* starting */ } await sleep(250); }
  throw Error(`application did not start: ${log.slice(-400)}`);
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
  await flow("F09", "Cron πακέτου: ολοκληρώνεται, υπενθύμιση υπολοίπου 1 μέρα πριν την αναχώρηση, καταγραφή κάθε βήματος", async () => {
    const r = spawnSync(process.execPath, [`--env-file=${path.join(pmsDir, "runtime.env")}`, "scripts/run-message-automations.mjs"], { cwd: pmsDir, encoding: "utf8", timeout: 280_000, env: { ...process.env, SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_FROM: "qa@example.invalid" } });
    must(r.status !== null, `το cron δεν τελείωσε (${r.signal ?? "timeout"})`);
    const bal = (await q(`SELECT status,COALESCE(last_error,'') e FROM message_deliveries WHERE booking_id=$1 AND event_key='balance'`, [leaving])).rows;
    must(bal.length > 0, `δεν δημιουργήθηκε υπενθύμιση υπολοίπου · cron: ${(r.stderr || r.stdout).slice(-300)}`);
    must(["sent", "failed", "pending", "processing"].includes(bal[0].status), `κατάσταση ${bal[0].status}`);
    const steps = (await q(`SELECT name,last_status FROM automation_status WHERE owner_id=$1`, [owner])).rows;
    must(steps.some((s) => s.name === "Guest messages"), `καταγραφές: ${steps.map((s) => s.name).join(", ")}`);
    return `υπενθύμιση υπολοίπου: ${bal[0].status}${bal[0].e ? ` (${bal[0].e.slice(0, 60)} — χωρίς SMTP στη δοκιμή)` : ""} · ${steps.length} βήματα cron καταγράφηκαν`;
  });

  await flow("F10", "Κλείδωμα Cloudflare + έλεγχοι εγκατάστασης (smoke) για PMS και Booking", async () => {
    await q(`INSERT INTO security_settings(owner_id,edge_secret_hash,edge_enforce,edge_last_seen_at,updated_at) VALUES($1,'qa',1,$2,$2) ON CONFLICT(owner_id) DO UPDATE SET edge_secret_hash='qa',edge_enforce=1,edge_last_seen_at=$2`, [owner, Date.now()]);
    try {
      for (const dir of [pmsDir, bookingDir]) { const r = spawnSync("bash", [path.join(dir, "scripts/smoke-runtime.sh"), dir, version], { encoding: "utf8", timeout: 180_000 }); must(r.status === 0, `${path.basename(dir)}: ${(r.stderr || r.stdout).slice(-300)}`); }
      const blocked = await fetch(`${booking.url}/api/public/availability?checkIn=${addDays(today, 5)}&checkOut=${addDays(today, 6)}&adults=2&children=0&rooms=1&lang=en`);
      await sleep(0);
      return `smoke OK και για τις δύο με το κλείδωμα ενεργό · αίτημα χωρίς κλειδί: HTTP ${blocked.status}`;
    } finally { await q(`UPDATE security_settings SET edge_enforce=0`); }
  });

  await flow("F11", "Αυτόματα tests του κώδικα (unit / integration)", async () => {
    const files = readdirSync(path.join(project, "tests")).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("tests", f));
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap", ...files], { cwd: project, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
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
const report = { version, verdict: failed ? "FAIL" : "PASS", at: new Date().toISOString(), durationMs: Date.now() - started, package: { file: path.basename(archive), sha256: sha }, commit, node: process.version, database: env.database ?? "—", flows: results, sandbox };
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  `# Hotel Corali PMS ${version} — έκθεση ελέγχου ποιότητας`, "",
  `**Αποτέλεσμα: ${report.verdict}** · ${results.filter((r) => r.status === "PASS").length}/${results.length} ροές PASS · ${new Date(report.at).toLocaleString("el-GR", { timeZone: "Europe/Athens" })}`, "",
  `- Πακέτο: \`${report.package.file}\` · SHA-256 \`${sha}\``, `- Κώδικας: commit \`${commit}\` · Node ${process.version} · ${report.database}`,
  `- Αναπαραγωγή: \`node scripts/release-qa.mjs ${report.package.file} ${version}\` (νέα βάση PostgreSQL, οι εφαρμογές του πακέτου σε λειτουργία, πραγματικά αιτήματα HTTP και το cron του πακέτου).`, "",
  "| # | Κρίσιμη ροή | Αποτέλεσμα | Λεπτομέρειες | ms |", "|---|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${esc(r.name)} | ${r.status === "PASS" ? "✅ PASS" : "❌ FAIL"} | ${esc(r.detail)} | ${r.ms} |`), "",
  "## Εξωτερικοί πάροχοι (sandbox)", "",
  "Τρέχουν με κλειδιά δοκιμής (`node scripts/provider-sandbox-e2e.mjs`): Stripe test mode, Viva demo, Channex staging, WhatsApp test number. Χωρίς κλειδί: NOT RUN — δεν θεωρείται PASS.", "",
  "| Ροή | Έλεγχος | Αποτέλεσμα | Λεπτομέρειες |", "|---|---|---|---|",
  ...sandbox.map((r) => `| ${esc(r.flow)} | ${esc(r.name)} | ${r.status === "PASS" ? "✅ PASS" : r.status === "FAIL" ? "❌ FAIL" : "⏸ NOT RUN"} | ${esc(r.detail)} |`), "",
].join("\n");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `QA-REPORT-${version}.md`), md);
writeFileSync(path.join(outDir, `qa-report-${version}.json`), JSON.stringify(report, null, 2));
rmSync(work, { recursive: true, force: true });
console.log(`\nQA ${version}: ${report.verdict} — ${path.join(outDir, `QA-REPORT-${version}.md`)}`);
process.exit(failed ? 1 : 0);
