import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
/** Objects made inside the vm context have its own prototypes; compare their JSON. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
function moduleFromSource(path: string, dependencies: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => (name in dependencies ? dependencies[name] : require(name)), console, Date, JSON, String, Number, Math, Map, Set, Array, Error, Promise, Object, Buffer, Response, Request, Intl }, { filename: path });
  return exports;
}
type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }> };
const adapter = (d: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Q => ({ query: async (sql, params = []) => { const r = await d.query(sql, params); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows || r.rows.length }; } });

async function setup() {
  const database = new PGlite();
  await database.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const pool = adapter(database);
  const withTransaction = (fn: (c: Q) => Promise<unknown>) => database.transaction((tx) => fn(adapter(tx as never)));
  const o = "hotel-corali", now = Date.now(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  await database.query(`INSERT INTO rooms(id,owner_id,code,room_type,capacity,active,base_rate_cents,operational_status) VALUES(1,$1,'112','double',2,1,10000,'available')`, [o]);
  await database.query(`INSERT INTO bookings(id,owner_id,reference,guest_name,guest_language,check_in,check_out,status,room_id,total_cents,balance_cents,adults,children,created_at) VALUES(7,$1,'CR-7','Anna Müller','de',$2,$3,'checked_in',1,30000,0,2,0,$4)`, [o, day(-2), day(3), now]);
  await database.query(`INSERT INTO hotel_departments(id,owner_id,name_el,name_en,icon,mode,created_at,updated_at) VALUES(3,$1,'Μπαρ','Bar','bar','order',$2,$2)`, [o, now]);
  await database.query(`INSERT INTO department_items(id,owner_id,department_id,name_el,name_en,price_cents,pos_sku,created_at,updated_at) VALUES(31,$1,3,'Μοχίτο','Mojito',950,'MOJ',$2,$2)`, [o, now]);
  const charges: unknown[] = [];
  const common = { "@/lib/db": { db: () => pool, withTransaction }, "@/lib/tape-chart": { hotelToday: () => today } };
  const sales = moduleFromSource("lib/department-sales.ts", {
    ...common,
    "@/lib/folio-db": { ensureFolio: async () => undefined, recalcBooking: async (_c: unknown, _o: string, id: number) => charges.push(id) },
    "@/lib/guest-portal": { createAnnouncement: async () => 1 }, "@/lib/provider-connections": { anthropicApiKey: async () => null },
    "@/lib/request-limit": { allowAttempt: async () => true, clientIp: () => "1.2.3.4" }, "@/lib/security-center": { recordSecurityEvent: async () => undefined },
  });
  return { database, pool, sales, charges, o, today, common };
}

test("POS receipts: room charge on the folio, retry not counted twice, void reverses, CSV import, report", async () => {
  const { database, sales, charges, o, today } = await setup();
  try {
    const caller = { ownerId: o, departmentId: 3, department: "Μπαρ" };
    const { normalizePosSale } = await import("../scripts/department-sales-core.mjs");
    const n = normalizePosSale({ receipt_id: "R-1", payment: "room", room: "112", items: [{ name: "Mojito", sku: "MOJ", quantity: 2, unit_price: 9.5 }] });
    const record = sales.recordPosSale as (c: object, s: unknown, o?: object) => Promise<Record<string, unknown>>;
    const first = await record(caller, n.sale);
    assert.equal(first.duplicate, false);
    assert.equal(first.booking, "CR-7");
    assert.ok(first.folioEntryId);
    const entry = (await database.query<{ amount_cents: number; description: string }>(`SELECT amount_cents,description FROM folio_entries WHERE id=$1`, [first.folioEntryId])).rows[0];
    assert.equal(Number(entry.amount_cents), 1900);
    assert.match(entry.description, /^Μπαρ: Mojito × 2 \[POS R-1\]$/);
    assert.equal((await database.query<{ item_id: number }>(`SELECT item_id FROM pos_sale_items`)).rows[0].item_id, 31);
    const again = await record(caller, n.sale);
    assert.equal(again.duplicate, true);
    assert.equal((await database.query(`SELECT 1 FROM folio_entries`)).rows.length, 1);
    const ghost = await record(caller, normalizePosSale({ receipt_id: "R-2", payment: "room", room: "999", total: 5 }).sale);
    assert.equal(ghost.error, "ROOM_NOT_FOUND");
    const voided = await (sales.voidPosSale as (c: object, r: string) => Promise<Record<string, unknown>>)(caller, "R-1");
    assert.equal(voided.voided, true);
    assert.equal(Number((await database.query<{ s: number }>(`SELECT sum(amount_cents)::int s FROM folio_entries`)).rows[0].s), 0);
    assert.deepEqual(charges, [7, 7]);
    const csv = `Ημερομηνία;Ώρα;Απόδειξη;Είδος;Ποσότητα;Τιμή;Πληρωμή;Δωμάτιο\n${today.split("-").reverse().join("/")};00:05;C-1;Μοχίτο;1;9,50;Χρέωση δωματίου;112\n${today.split("-").reverse().join("/")};00:10;C-2;Νερό;2;1;Μετρητά;\n`;
    const imp = await (sales.importSalesCsv as (o: string, d: number, t: string) => Promise<Record<string, unknown>>)(o, 3, csv);
    assert.equal(imp.added, 2, JSON.stringify(imp));
    assert.equal((await database.query(`SELECT 1 FROM folio_entries`)).rows.length, 2, "CSV room charges are not charged again");
    assert.equal((await (sales.importSalesCsv as (o: string, d: number, t: string) => Promise<Record<string, unknown>>)(o, 3, csv)).duplicates, 2);
    const report = await (sales.salesReport as (o: string, f: string, t: string) => Promise<{ totalCents: number; receipts: number; departments: { byPayment: Record<string, number>; guests: number }[]; recent: unknown[] }>)(o, today, today);
    assert.equal(report.totalCents, 1150);
    assert.equal(report.receipts, 2);
    assert.equal(report.departments[0].byPayment.room, 950);
    assert.equal(report.departments[0].guests, 1);
    assert.equal(report.recent.length, 3);
    const csvOut = (sales.reportCsv as (r: unknown) => string)(report);
    assert.match(csvOut, /^﻿Τμήμα;Έσοδα €/);
    assert.match(csvOut, /Μπαρ;11,50;2;5,75/);
  } finally { await database.close(); }
});

test("POS key: shown once, hash stored, bound to the department, revoked keys refused", async () => {
  const { database, sales, o } = await setup();
  try {
    const key = await (sales.createPosKey as (o: string, d: number, u: number, n: string) => Promise<string>)(o, 3, 1, "SoftOne");
    const row = (await database.query<{ key_hash: string }>(`SELECT key_hash FROM department_pos`)).rows[0];
    // The secret part (after "cpos_<8>_") is never stored, only the SHA-256 of the whole key.
    const secret = key.slice("cpos_".length + 9);
    assert.ok(secret.length >= 32 && !row.key_hash.includes(secret));
    assert.equal(row.key_hash, (await import("node:crypto")).createHash("sha256").update(key).digest("hex"));
    const require = sales.requirePosKey as (r: Request) => Promise<unknown>;
    assert.deepEqual(plain(await require(new Request("https://x/api/v1/pos/sales", { headers: { authorization: `Bearer ${key}` } }))), { ownerId: o, departmentId: 3, department: "Μπαρ" });
    await (sales.revokePosKey as (o: string, d: number) => Promise<void>)(o, 3);
    const refused = await require(new Request("https://x/api/v1/pos/sales", { headers: { authorization: `Bearer ${key}` } }));
    assert.ok(refused instanceof Response && refused.status === 401);
  } finally { await database.close(); }
});

test("forward to a department: recipients required, guest told in their language, no double forward, seen → done", async () => {
  const { database, pool, o, common } = await setup();
  try {
    const pushes: unknown[] = [], guestPush: unknown[] = [], mails: unknown[] = [];
    const fwd = moduleFromSource("lib/department-forward.ts", {
      ...common, "@/lib/department-forward-core": moduleFromSource("lib/department-forward-core.ts"),
      "@/lib/guest-push": { pushHotelMessageAfter: (...a: unknown[]) => guestPush.push(a) }, "@/lib/notifications/email": { sendEmail: async (...a: unknown[]) => { mails.push(a); } },
      "@/lib/staff-core": { isDesk: (r: string) => ["owner", "admin", "reception"].includes(r) }, "@/lib/staff-push": { deferStaffPush: (...a: unknown[]) => pushes.push(a) },
    });
    const msg = (await database.query<{ id: number }>(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,email_notified,created_at) VALUES($1,7,'guest','Zwei Handtücher an die Bar bitte',0,$2) RETURNING id`, [o, Date.now()])).rows[0].id;
    const forward = fwd.forwardToDepartment as (o: string, x: object) => Promise<Record<string, unknown>>;
    await assert.rejects(forward(o, { departmentId: 3, kind: "message", sourceId: msg, actor: 1, notifyGuest: true }), /NO_RECIPIENTS/);
    await database.query(`INSERT INTO pms_staff_users(id,owner_id,username,display_name,email,password_hash,totp_secret,role,active,created_at,updated_at) VALUES(5,$1,'nikos','Nikos','n@x.gr','x','','staff',1,1,1)`, [o]);
    await database.query(`INSERT INTO staff_specialties(id,owner_id,name,created_at) VALUES(9,$1,'Μπαρ',1)`, [o]);
    await database.query(`INSERT INTO staff_user_specialties(owner_id,staff_user_id,specialty_id) VALUES($1,5,9)`, [o]);
    await database.query(`UPDATE hotel_departments SET staff_specialty_id=9,notify_email='bar@hotel.gr' WHERE id=3`);
    const r = await forward(o, { departmentId: 3, kind: "message", sourceId: msg, actor: 1, notifyGuest: true, note: "Liegestuhl 4" });
    assert.deepEqual(plain(r.recipients), { team: "Μπαρ", email: "bar@hotel.gr" });
    assert.equal(pushes.length, 1);
    assert.equal(mails.length, 1);
    const told = (await database.query<{ body: string }>(`SELECT body FROM booking_messages WHERE sender='hotel' ORDER BY id`)).rows;
    assert.match(told[0].body, /an unser Team „Bar“ weitergeleitet/);
    await assert.rejects(forward(o, { departmentId: 3, kind: "message", sourceId: msg, actor: 1, notifyGuest: true }), /ALREADY_FORWARDED/);
    const inbox = await (fwd.departmentInbox as (o: string, d: number[]) => Promise<{ id: number; summary: string }[]>)(o, await (fwd.myDepartments as (o: string, u: number, r: string) => Promise<number[]>)(o, 5, "staff"));
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].summary, "Δωμ. 112 · Anna: Zwei Handtücher an die Bar bitte");
    const set = fwd.setForwardStatus as (o: string, id: number, u: object, s: string) => Promise<void>;
    await assert.rejects(set(o, inbox[0].id, { id: 6, role: "housekeeping" }, "seen"), /FORBIDDEN/);
    await set(o, inbox[0].id, { id: 5, role: "staff" }, "seen");
    await set(o, inbox[0].id, { id: 5, role: "staff" }, "done");
    await assert.rejects(set(o, inbox[0].id, { id: 5, role: "staff" }, "done"), /ALREADY_HANDLED/);
    const after = (await database.query<{ body: string }>(`SELECT body FROM booking_messages WHERE sender='hotel' ORDER BY id`)).rows;
    assert.equal(after.length, 2);
    assert.match(after[1].body, /Team „Bar“ kümmert sich/);
    assert.equal(guestPush.length, 2);
    void pool;
  } finally { await database.close(); }
});
