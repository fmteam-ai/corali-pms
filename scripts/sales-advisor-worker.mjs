// v184 sales advisor: the figures of every department (app orders and POS receipts), the rule suggestions and — with an
// Anthropic key — Claude's suggestions, saved for PMS → Τμήματα → «Βοηθός πωλήσεων». The cron runs it once a day
// (09:20 hotel time); the PMS runs it on «Ανάλυση τώρα». Nothing is sent to guests: the manager turns a suggestion
// into an offer with one click.
import { ADVISOR_MODEL, ADVISOR_SCHEMA, ADVISOR_SYSTEM, addDays, advisorPrompt, hotelDateHour, normalizeAiSuggestions, ruleSuggestions } from "./department-sales-core.mjs";

const WEEKDAYS = ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];

/** Sales of the departments from `fromMs`: app orders (not cancelled) and POS receipts (not voided). */
export async function loadSales(pool, owner, fromMs, toMs = Number.MAX_SAFE_INTEGER) {
  const [app, pos] = await Promise.all([
    pool.query(`SELECT o.id,o.department_id,o.booking_id,o.item_id,o.amount_cents,o.quantity,o.title_guest,o.created_at,i.name_el FROM department_orders o LEFT JOIN department_items i ON i.owner_id=o.owner_id AND i.id=o.item_id WHERE o.owner_id=$1 AND o.status<>'cancelled' AND o.created_at>=$2::bigint AND o.created_at<$3::bigint`, [owner, fromMs, toMs]),
    pool.query(`SELECT s.id,s.department_id,s.booking_id,s.total_cents,s.payment,s.source,s.sold_at,s.sold_date,s.sold_hour,COALESCE((SELECT json_agg(json_build_object('item_id',x.item_id,'name',x.name,'quantity',x.quantity,'amount_cents',x.amount_cents)) FROM pos_sale_items x WHERE x.owner_id=s.owner_id AND x.sale_id=s.id),'[]'::json) AS items FROM pos_sales s WHERE s.owner_id=$1 AND s.status='paid' AND s.sold_at>=$2::bigint AND s.sold_at<$3::bigint`, [owner, fromMs, toMs]),
  ]);
  const out = [];
  for (const o of app.rows) {
    const { date, hour } = hotelDateHour(Number(o.created_at));
    out.push({ departmentId: Number(o.department_id), date, hour, at: Number(o.created_at), totalCents: Number(o.amount_cents), payment: "room", source: "app", bookingId: Number(o.booking_id), items: [{ itemId: Number(o.item_id), name: String(o.name_el ?? o.title_guest), quantity: Number(o.quantity), amountCents: Number(o.amount_cents) }] });
  }
  for (const s of pos.rows) {
    const items = (typeof s.items === "string" ? JSON.parse(s.items) : s.items) ?? [];
    out.push({ departmentId: Number(s.department_id), date: String(s.sold_date), hour: Number(s.sold_hour), at: Number(s.sold_at), totalCents: Number(s.total_cents), payment: String(s.payment), source: String(s.source), bookingId: s.booking_id === null ? null : Number(s.booking_id), items: items.map((x) => ({ itemId: x.item_id === null ? null : Number(x.item_id), name: String(x.name), quantity: Number(x.quantity), amountCents: Number(x.amount_cents) })) });
  }
  return out;
}

/** Guests staying tonight (or arriving today) with the departments they used during this stay. */
export async function inHouseGuests(pool, owner, today) {
  const r = await pool.query(
    `SELECT b.id,b.check_in,b.check_out,COALESCE(b.adults,1) AS adults,COALESCE(b.children,0) AS children,COALESCE(b.guest_language,'en') AS lang,
       ARRAY(SELECT DISTINCT o.department_id FROM department_orders o WHERE o.owner_id=b.owner_id AND o.booking_id=b.id AND o.status<>'cancelled'
             UNION SELECT DISTINCT s.department_id FROM pos_sales s WHERE s.owner_id=b.owner_id AND s.booking_id=b.id AND s.status='paid') AS used
       FROM bookings b WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>$2`,
    [owner, today],
  );
  return r.rows.map((b) => ({ bookingId: Number(b.id), checkIn: String(b.check_in), checkOut: String(b.check_out), adults: Number(b.adults), children: Number(b.children), lang: String(b.lang).slice(0, 2), usedDepartments: (b.used ?? []).map(Number) }));
}

export async function gatherAdvisorStats({ pool, owner, now = Date.now() }) {
  const { date: today } = hotelDateHour(now);
  const day = 86_400_000;
  const [depts, items, sales, guests, pos, offers, rooms, occ] = await Promise.all([
    pool.query(`SELECT * FROM hotel_departments WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY sort_order,id`, [owner]),
    pool.query(`SELECT * FROM department_items WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY sort_order,id`, [owner]),
    loadSales(pool, owner, now - 30 * day),
    inHouseGuests(pool, owner, today),
    pool.query(`SELECT department_id,last_sale_at FROM department_pos WHERE owner_id=$1 AND revoked_at IS NULL`, [owner]),
    pool.query(`SELECT department_id,max(created_at) AS last_at,array_agg(title_el) FILTER (WHERE starts_at<=$2::bigint AND COALESCE(ends_at,starts_at+604800000)>$2::bigint) AS active FROM guest_announcements WHERE owner_id=$1 AND deleted_at IS NULL AND department_id IS NOT NULL GROUP BY department_id`, [owner, now]),
    pool.query(`SELECT count(*)::int AS n FROM rooms WHERE owner_id=$1 AND active=1`, [owner]),
    pool.query(`SELECT d.day::date::text AS date,count(DISTINCT b.room_id)::int AS n FROM generate_series($2::date,$2::date+6,interval '1 day') d(day) LEFT JOIN bookings b ON b.owner_id=$1 AND b.room_id IS NOT NULL AND b.status IN ('confirmed','checked_in') AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text GROUP BY 1 ORDER BY 1`, [owner, today]),
  ]);
  const tomorrow = addDays(today, 1), languages = {};
  for (const g of guests) languages[g.lang] = (languages[g.lang] ?? 0) + 1;
  const inHouse = { total: guests.length, families: guests.filter((g) => g.children > 0).length, couples: guests.filter((g) => g.adults === 2 && g.children === 0).length, arrivingToday: guests.filter((g) => g.checkIn === today).length, departingTomorrow: guests.filter((g) => g.checkOut === tomorrow).length, languages };
  const totalRooms = Number(rooms.rows[0]?.n ?? 0);
  const departments = depts.rows.map((d) => {
    const id = Number(d.id), mine = sales.filter((s) => s.departmentId === id);
    const cur = mine.filter((s) => s.at >= now - 14 * day), prev = mine.filter((s) => s.at < now - 14 * day && s.at >= now - 28 * day);
    const byHour = Array(24).fill(0);
    for (const s of cur) byHour[s.hour] += s.totalCents;
    const users = guests.filter((g) => g.usedDepartments.includes(id));
    const p = pos.rows.find((x) => Number(x.department_id) === id), o = offers.rows.find((x) => Number(x.department_id) === id);
    return {
      id, name: String(d.name_el), nameEn: String(d.name_en ?? ""), icon: String(d.icon), mode: String(d.mode), openFrom: String(d.open_from), openTo: String(d.open_to), active: Number(d.active) === 1,
      posConnected: Boolean(p), lastPosSaleAt: p?.last_sale_at ? Number(p.last_sale_at) : null,
      cur: { revenueCents: cur.reduce((a, s) => a + s.totalCents, 0), receipts: cur.length, appCents: cur.filter((s) => s.source === "app").reduce((a, s) => a + s.totalCents, 0) },
      prev: { revenueCents: prev.reduce((a, s) => a + s.totalCents, 0), receipts: prev.length },
      byHour, inHousePenetration: guests.length ? Math.round((users.length / guests.length) * 100) : null, nonUsers: guests.length - users.length,
      departingTomorrowNonUsers: guests.filter((g) => g.checkOut === tomorrow && !g.usedDepartments.includes(id)).length,
      daysSinceOffer: o?.last_at ? Math.floor((now - Number(o.last_at)) / day) : 999,
      activeOffers: (o?.active ?? []).filter(Boolean).map(String).slice(0, 5),
      items: items.rows.filter((i) => Number(i.department_id) === id).map((i) => {
        const iid = Number(i.id), sku = String(i.pos_sku ?? "").trim().toLowerCase(), nm = String(i.name_el).trim().toLowerCase();
        const sold30 = mine.reduce((a, s) => a + (s.items ?? []).filter((x) => x.itemId === iid || (x.itemId === null && (x.name.trim().toLowerCase() === nm || (sku && x.name.trim().toLowerCase() === sku)))).reduce((q, x) => q + x.quantity, 0), 0);
        return { id: iid, name: String(i.name_el), nameEn: String(i.name_en ?? ""), priceCents: Number(i.price_cents), sold30: Math.round(sold30 * 1000) / 1000, active: Number(i.active) === 1, ageDays: Math.floor((now - Number(i.created_at)) / day) };
      }),
    };
  });
  return {
    now, today, weekday: WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()], inHouse,
    occupancyNext7: occ.rows.map((r) => ({ date: String(r.date), percent: totalRooms ? Math.round((Number(r.n) / totalRooms) * 100) : 0 })),
    departments,
  };
}

/** Claude through the Messages API (plain fetch, so the cron needs no SDK): a JSON answer in ADVISOR_SCHEMA. */
export async function askClaude(apiKey, stats, fetchImpl = fetch) {
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ADVISOR_MODEL, max_tokens: 8000, system: ADVISOR_SYSTEM, output_config: { format: { type: "json_schema", schema: ADVISOR_SCHEMA } }, messages: [{ role: "user", content: advisorPrompt(stats) }] }),
    signal: AbortSignal.timeout(150_000),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw Error(`ANTHROPIC_${r.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 160)}` : ""}`);
  if (body?.stop_reason === "refusal") throw Error("ANTHROPIC_REFUSAL");
  const text = (body?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return normalizeAiSuggestions(JSON.parse(text), stats);
}

async function insertSuggestion(pool, owner, runId, s, now) {
  const r = await pool.query(
    `INSERT INTO sales_suggestions(owner_id,run_id,rule_key,department_id,kind,title,reasoning,audience_json,item_id,discount_percent,message_el,message_en,title_el,title_en,starts_hour,duration_hours,confidence,status,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'open',$18) RETURNING id`,
    [owner, runId, s.ruleKey ?? "", s.departmentId, s.kind, String(s.title).slice(0, 200), String(s.reasoning ?? "").slice(0, 1200), JSON.stringify(s.audience ?? {}), s.itemId ?? null, s.discountPercent ?? 0, s.messageEl ?? "", s.messageEn ?? "", s.titleEl ?? "", s.titleEn ?? "", s.startsHour ?? null, s.durationHours ?? 0, s.confidence ?? "medium", now],
  );
  return Number(r.rows[0].id);
}

/**
 * One run of the advisor. `apiKey` null = rules only. Returns { runId, added, ai, error }. Rule suggestions that are
 * already open (same rule and department, last 3 days) are not added again; open ones older than 7 days expire.
 */
export async function runSalesAdvisor({ pool, owner, apiKey = null, now = Date.now(), actor = null, notify = true, fetchImpl = fetch }) {
  const stats = await gatherAdvisorStats({ pool, owner, now });
  const rules = ruleSuggestions(stats);
  let ai = null, error = "";
  if (apiKey && stats.departments.some((d) => d.active)) {
    try { ai = await askClaude(apiKey, stats, fetchImpl); } catch (e) { error = e instanceof Error ? e.message.slice(0, 300) : "AI_FAILED"; }
  }
  await pool.query(`UPDATE sales_suggestions SET status='expired' WHERE owner_id=$1 AND status='open' AND created_at<$2::bigint`, [owner, now - 7 * 86_400_000]);
  const open = (await pool.query(`SELECT rule_key FROM sales_suggestions WHERE owner_id=$1 AND status IN ('open','dismissed','applied') AND rule_key<>'' AND created_at>$2::bigint`, [owner, now - 3 * 86_400_000])).rows.map((r) => String(r.rule_key).split(":").slice(0, 2).join(":"));
  const fresh = rules.filter((s) => !open.includes(s.ruleKey.split(":").slice(0, 2).join(":")));
  const summary = ai?.summary || (fresh.length ? `${fresh.length} ${fresh.length === 1 ? "νέα πρόταση" : "νέες προτάσεις"} από τους κανόνες.` : "Δεν βρέθηκε κάτι νέο σήμερα.");
  const run = await pool.query(`INSERT INTO sales_advisor_runs(owner_id,kind,summary,error,created_by,created_at,tips_json) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [owner, ai ? "ai" : "rules", summary.slice(0, 3000), error, actor, now, JSON.stringify(ai?.tips ?? [])]);
  const runId = Number(run.rows[0].id);
  let added = 0;
  for (const s of [...(ai?.suggestions ?? []), ...fresh]) { await insertSuggestion(pool, owner, runId, s, now); added++; }
  const alerts = fresh.filter((s) => s.kind === "alert");
  if (notify && added) {
    const el = `💡 Βοηθός πωλήσεων: ${added} ${added === 1 ? "νέα πρόταση" : "νέες προτάσεις"}${alerts.length ? ` (⚠️ ${alerts[0].title})` : ""}`;
    const en = `💡 Sales advisor: ${added} new suggestion${added === 1 ? "" : "s"}${alerts.length ? " (with an alert)" : ""}`;
    await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/departments/advisor',$4)`, [owner, el.slice(0, 300), en.slice(0, 300), now]);
  }
  return { runId, added, ai: Boolean(ai), error, departments: stats.departments.length };
}

/** Once a day at 09:20 hotel time (the cron calls this every minute). */
export const advisorDue = (now = Date.now()) => {
  const { hour } = hotelDateHour(now);
  return hour === 9 && new Date(now).getUTCMinutes() === 20;
};
