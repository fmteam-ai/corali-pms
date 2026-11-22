import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { athensToMs, hotelDateHour, matchesAudience, normalizeAiSuggestions, normalizeAudience, normalizePosSale, openHours, parseSalesCsv, promoPrice, quietWindow, ruleSuggestions, salesSummary, suggestionWindow, type AdvisorStats } from "../scripts/department-sales-core.mjs";
import { newPosKey, parsePosKey, posKeyHash, samePosHash } from "../scripts/pos-key-core.mjs";
import { readFileSync } from "node:fs";
import { gatherAdvisorStats, runSalesAdvisor } from "../scripts/sales-advisor-worker.mjs";

const now = Date.parse("2026-07-15T10:00:00Z"); // 13:00 in Athens

test("POS key: format, parse, hash", () => {
  const k = newPosKey();
  assert.match(k.key, /^cpos_[a-z0-9]{8}_/);
  assert.deepEqual(parsePosKey(`Bearer ${k.key}`), { key: k.key, prefix: k.prefix });
  assert.equal(parsePosKey("Bearer corali_abcdefgh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), null);
  assert.ok(samePosHash(posKeyHash(k.key), k.hash));
  assert.ok(!samePosHash(posKeyHash(`${k.key}x`), k.hash));
});

test("POS receipt: items, totals, payment and room checks", () => {
  const ok = normalizePosSale({ receipt_id: "A-1", sold_at: "2026-07-15T18:30:00Z", payment: "card", items: [{ name: "Mojito", quantity: 2, unit_price: 9.5 }, { name: "Water", unit_price: 1 }], total: 20 }, now + 86_400_000);
  assert.ok(ok.sale);
  assert.equal(ok.sale.totalCents, 2000);
  assert.equal(ok.sale.soldDate, "2026-07-15");
  assert.equal(ok.sale.soldHour, 21);
  assert.equal(ok.sale.items[0].amountCents, 1900);
  assert.match(String(normalizePosSale({ receipt_id: "A", items: [{ name: "x", unit_price: 5 }], total: 9 }, now).error), /does not match/);
  assert.match(String(normalizePosSale({ receipt_id: "A", total: 10, payment: "room" }, now).error), /needs room/);
  assert.match(String(normalizePosSale({ receipt_id: "A", total: 10, payment: "bitcoin" }, now).error), /payment must be/);
  assert.match(String(normalizePosSale({ total: 10 }, now).error), /receipt_id/);
  assert.match(String(normalizePosSale({ receipt_id: "A", total: 10, sold_at: "2030-01-01T00:00:00Z" }, now).error), /future/);
  assert.equal(normalizePosSale({ receipt_id: "B", total: 12.3, payment: "room", room: "112" }, now).sale?.room, "112");
});

test("sales CSV: Greek headers, decimal comma, one sale per receipt", () => {
  const csv = "Ημερομηνία;Ώρα;Απόδειξη;Είδος;Ποσότητα;Τιμή;Πληρωμή;Δωμάτιο\n15/07/2026;21:10;1001;Mojito;2;9,50;Κάρτα;\n15/07/2026;21:10;1001;Νερό;1;1,00;Κάρτα;\n15/07/2026;22:00;1002;Μπύρα;1;5;Χρέωση δωματίου;112\nbad;line\n";
  const r = parseSalesCsv(csv);
  assert.equal(r.sales.length, 2);
  assert.equal(r.sales[0].items.length, 2);
  assert.equal(r.sales[0].payment, "card");
  assert.equal(r.sales[1].payment, "room");
  assert.equal(r.sales[1].room, "112");
  assert.deepEqual(hotelDateHour(r.sales[0].sold_at), { date: "2026-07-15", hour: 21 });
  assert.equal(r.errors.length, 1);
  assert.deepEqual(hotelDateHour(athensToMs("2026-01-10", "09:00")), { date: "2026-01-10", hour: 9 });
  assert.match(parseSalesCsv("a,b\n1,2").errors[0], /Columns needed/);
});

test("audience: segments and languages", () => {
  const today = "2026-07-15";
  const g = { checkIn: "2026-07-12", checkOut: "2026-07-16", adults: 2, children: 0, lang: "de", usedDepartments: [3] };
  assert.ok(matchesAudience(g, { segment: "couples" }, today));
  assert.ok(matchesAudience(g, { segment: "departing_tomorrow" }, today));
  assert.ok(!matchesAudience(g, { segment: "families" }, today));
  assert.ok(matchesAudience(g, { segment: "used", departmentId: 3 }, today));
  assert.ok(!matchesAudience(g, { segment: "not_used", departmentId: 3 }, today));
  assert.ok(matchesAudience(g, { segment: "not_used" }, today, 4));
  assert.ok(!matchesAudience(g, { segment: "all", languages: ["el"] }, today));
  assert.equal(normalizeAudience({ segment: "evil", languages: ["xx", "el"] }).segment, "all");
  assert.deepEqual(normalizeAudience({ languages: ["xx", "el"] }).languages, ["el"]);
  assert.equal(promoPrice(5000, 20), 4000);
});

test("sales summary per department with the period before", () => {
  const s = (departmentId: number, date: string, hour: number, totalCents: number, source = "pos", payment = "card", bookingId: number | null = null) => ({ departmentId, date, hour, totalCents, payment, source, bookingId, items: [{ name: "Item", quantity: 1, amountCents: totalCents }] });
  const r = salesSummary([s(1, "2026-07-01", 20, 3000), s(1, "2026-07-02", 21, 1000, "app", "room", 7), s(2, "2026-07-02", 11, 5000)], "2026-07-01", "2026-07-02", [s(1, "2026-06-29", 20, 2000)], 10);
  assert.equal(r.totalCents, 9000);
  assert.equal(r.departments[0].departmentId, 2);
  const bar = r.departments.find((d) => d.departmentId === 1)!;
  assert.equal(bar.receipts, 2);
  assert.equal(bar.avgTicketCents, 2000);
  assert.equal(bar.changePercent, 100);
  assert.equal(bar.bySource.app, 1000);
  assert.equal(bar.byPayment.room, 1000);
  assert.equal(bar.penetration, 10);
  assert.equal(bar.daily.length, 2);
  assert.equal(bar.topItems[0].quantity, 2);
});

test("opening hours and quiet window", () => {
  assert.deepEqual(openHours("18:00", "02:00"), [18, 19, 20, 21, 22, 23, 0, 1]);
  assert.equal(openHours("10:00", "23:00").length, 13);
  assert.equal(openHours("00:00", "00:00").length, 24);
  const byHour = Array(24).fill(0);
  for (const h of [10, 11, 12, 13, 18, 19, 20, 21, 22]) byHour[h] = 1000;
  assert.deepEqual(quietWindow(byHour, "10:00", "23:00"), { start: 14, end: 16, share: 0 });
  assert.equal(quietWindow(byHour, "10:00", "14:00"), null);
});

function stats(): AdvisorStats {
  return {
    now, today: "2026-07-15", weekday: "Τετάρτη",
    inHouse: { total: 10, families: 3, couples: 4, arrivingToday: 1, departingTomorrow: 2, languages: { en: 6, el: 4 } },
    occupancyNext7: [{ date: "2026-07-15", percent: 80 }],
    departments: [
      { id: 1, name: "Μπαρ", nameEn: "Bar", icon: "bar", mode: "order", openFrom: "10:00", openTo: "23:00", active: true, posConnected: true, lastPosSaleAt: now - 72 * 3_600_000,
        cur: { revenueCents: 30_000, receipts: 20, appCents: 5_000 }, prev: { revenueCents: 60_000, receipts: 40 }, byHour: Array.from({ length: 24 }, (_, h) => ([14, 15].includes(h) ? 0 : 1000)),
        inHousePenetration: 10, nonUsers: 9, departingTomorrowNonUsers: 1, daysSinceOffer: 30, activeOffers: [],
        items: [{ id: 11, name: "Mojito", nameEn: "Mojito", priceCents: 950, sold30: 40, active: true, ageDays: 90 }, { id: 12, name: "Absinthe", nameEn: "Absinthe", priceCents: 1200, sold30: 0, active: true, ageDays: 90 }] },
      { id: 2, name: "Spa", nameEn: "Spa", icon: "spa", mode: "appointment", openFrom: "10:00", openTo: "20:00", active: true, posConnected: false, lastPosSaleAt: null,
        cur: { revenueCents: 0, receipts: 0, appCents: 0 }, prev: { revenueCents: 0, receipts: 0 }, byHour: Array(24).fill(0),
        inHousePenetration: 0, nonUsers: 10, departingTomorrowNonUsers: 2, daysSinceOffer: 999, activeOffers: [], items: [{ id: 21, name: "Μασάζ 60′", nameEn: "Massage 60′", priceCents: 7000, sold30: 0, active: true, ageDays: 5 }] },
    ],
  };
}

test("advisor rules: alerts, drop, penetration, last chance, happy hour, menu", () => {
  const out = ruleSuggestions(stats());
  const keys = out.map((s) => s.ruleKey.split(":").slice(0, 2).join(":"));
  for (const k of ["pos_silent:1", "drop:1", "penetration:1", "happy_hour:1", "menu:1", "penetration:2", "last_chance:2"]) assert.ok(keys.includes(k), k);
  const last = out.find((s) => s.ruleKey.startsWith("last_chance:2"))!;
  assert.equal(last.audience.segment, "departing_tomorrow");
  assert.equal(last.itemId, 21);
  assert.equal(out.find((s) => s.ruleKey.startsWith("happy_hour:1"))!.startsHour, 14);
  assert.ok(!keys.includes("no_offer:1"));
});

test("advisor AI answer is checked against the figures", () => {
  const r = normalizeAiSuggestions({ summary: "ok", suggestions: [
    { department_id: 2, kind: "bundle", title: "Μασάζ για δύο", reasoning: "x", segment: "couples", item_id: 21, discount_percent: 90, starts_hour: 17, duration_hours: 6, title_el: "a", title_en: "b", message_el: "c", message_en: "d", confidence: "high" },
    { department_id: 99, kind: "offer", title: "ghost" },
    { department_id: 1, kind: "weird", title: "t", item_id: 21, segment: "nope" },
  ] }, stats());
  assert.equal(r.suggestions.length, 2);
  assert.equal(r.suggestions[0].discountPercent, 40);
  assert.equal(r.suggestions[0].audience.segment, "couples");
  assert.equal(r.suggestions[1].itemId, null);
  assert.equal(r.suggestions[1].kind, "offer");
  assert.equal(r.suggestions[1].audience.segment, "all");
  const w = suggestionWindow({ startsHour: 17, durationHours: 2 }, now);
  assert.deepEqual(hotelDateHour(w.startsAt), { date: "2026-07-15", hour: 17 });
  assert.equal(w.endsAt! - w.startsAt, 7_200_000);
  assert.equal(suggestionWindow({ startsHour: 9, durationHours: 0 }, now).startsAt, now);
});

test("advisor run on the real schema: stats, rules, Claude answer, no repeats", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../server/postgres-schema.sql", import.meta.url), "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
    const o = "hotel-corali", t = now - 40 * 86_400_000;
    await db.query(`INSERT INTO hotel_departments(id,owner_id,name_el,name_en,icon,mode,open_from,open_to,created_at,updated_at) VALUES(1,$1,'Σπα','Spa','spa','appointment','10:00','20:00',$2,$2)`, [o, t]);
    await db.query(`INSERT INTO department_items(id,owner_id,department_id,name_el,name_en,price_cents,duration_min,created_at,updated_at) VALUES(21,$1,1,'Μασάζ','Massage',7000,60,$2,$2)`, [o, t]);
    for (let i = 0; i < 5; i++) await db.query(`INSERT INTO bookings(owner_id,reference,guest_name,check_in,check_out,status,total_cents,balance_cents,adults,children,created_at) VALUES($1,$2,'G','2026-07-12',$3,'checked_in',1,0,2,0,$4)`, [o, `CR-${i}`, i < 2 ? "2026-07-16" : "2026-07-20", t]);
    const b1 = (await db.query<{ id: number }>(`SELECT id FROM bookings WHERE reference='CR-0'`)).rows[0].id;
    await db.query(`INSERT INTO pos_sales(owner_id,department_id,receipt_id,sold_at,sold_date,sold_hour,total_cents,payment,booking_id,created_at) VALUES($1,1,'R1',$2,'2026-07-14',12,7000,'room',$3,$2)`, [o, now - 86_400_000, b1]);
    await db.query(`INSERT INTO pos_sale_items(owner_id,sale_id,item_id,name,quantity,unit_cents,amount_cents) VALUES($1,(SELECT id FROM pos_sales WHERE receipt_id='R1'),21,'Μασάζ',1,7000,7000)`, [o]);
    const s = await gatherAdvisorStats({ pool, owner: o, now });
    assert.equal(s.inHouse.total, 5);
    assert.equal(s.departments[0].cur.revenueCents, 7000);
    assert.equal(s.departments[0].items[0].sold30, 1);
    assert.equal(s.departments[0].nonUsers, 4);
    assert.equal(s.departments[0].departingTomorrowNonUsers, 1);
    let asked = "";
    const fakeFetch = (async (_url: string, init: { body: string }) => {
      asked = init.body;
      return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "Περίληψη", department_tips: [{ department_id: 1, tips: ["Πακέτο για ζευγάρια"] }, { department_id: 77, tips: ["ghost"] }], suggestions: [{ department_id: 1, kind: "bundle", title: "Για δύο", reasoning: "r", segment: "couples", item_id: 21, discount_percent: 15, starts_hour: null, duration_hours: 24, title_el: "Για δύο", title_en: "For two", message_el: "{name}, μασάζ για δύο", message_en: "{name}, massage for two", confidence: "medium" }] }) }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const first = await runSalesAdvisor({ pool, owner: o, apiKey: "sk-test", now, fetchImpl: fakeFetch });
    assert.ok(first.ai);
    assert.match(asked, /"json_schema"/);
    assert.match(asked, /PLAYBOOK: /);
    assert.match(asked, /professional hotel salesperson/);
    assert.deepEqual(JSON.parse((await db.query<{ tips_json: string }>(`SELECT tips_json FROM sales_advisor_runs ORDER BY id LIMIT 1`)).rows[0].tips_json), [{ departmentId: 1, tips: ["Πακέτο για ζευγάρια"] }]);
    assert.ok(!asked.includes("CR-0"));
    assert.equal(first.added, 2); // Claude's bundle + the last-chance rule (1 of 5 rooms used the spa = 20%: not "few")
    const kinds = (await db.query<{ kind: string; rule_key: string }>(`SELECT kind,rule_key FROM sales_suggestions ORDER BY id`)).rows;
    assert.equal(kinds[0].kind, "bundle");
    assert.match(kinds[1].rule_key, /^last_chance:1:/);
    const second = await runSalesAdvisor({ pool, owner: o, now: now + 3_600_000 });
    assert.equal(second.added, 0);
    const n = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM pms_notifications WHERE link='/pms/departments/advisor'`)).rows[0].n;
    assert.equal(n, 1);
    const failing = (async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as unknown as typeof fetch;
    const third = await runSalesAdvisor({ pool, owner: o, apiKey: "bad", now: now + 7_200_000, fetchImpl: failing });
    assert.match(third.error, /ANTHROPIC_401/);
  } finally { await db.close(); }
});

test("the shared core has no Node-only imports (it is used by browser pages)", () => {
  assert.doesNotMatch(readFileSync(new URL("../scripts/department-sales-core.mjs", import.meta.url), "utf8"), /from "node:/);
});
