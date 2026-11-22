// v184 department sales (pure; unit tested; shared by the PMS, the browser pages and the cron worker; no Node-only
// imports — the POS key is in pos-key-core.mjs): a POS receipt checked and normalised, sales CSV import, the guests an offer is meant for, the promo price, the sales
// summary per department and the sales advisor (rules, and the request / answer of Claude).

export const POS_PAYMENTS = ["cash", "card", "room", "other"];
export const AUDIENCE_SEGMENTS = ["all", "not_used", "used", "families", "couples", "arriving_today", "departing_tomorrow", "long_stay"];
export const SUGGESTION_KINDS = ["offer", "happy_hour", "bundle", "price", "timing", "menu", "alert"];
export const MAX_DISCOUNT = 40;
/** Same model as the guest assistant and the AI prices (lib/guest-assistant.ts). */
export const ADVISOR_MODEL = "claude-opus-5-5";

// ───────────────────────────── hotel time ─────────────────────────────

const athens = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
/** Hotel (Athens) date and hour of a moment. */
export function hotelDateHour(ms) {
  const p = Object.fromEntries(athens.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// ───────────────────────────── POS receipt ─────────────────────────────

const cents = (eur) => Math.round(Number(eur) * 100);
const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");

/**
 * A receipt from a POS: { receipt_id, sold_at?, items: [{ name, sku?, quantity, unit_price }], total?, payment, room?,
 * covers? }. Amounts in euros. The total, when given, must match the items (±0.05 €, so rounding on the POS is fine);
 * without items the total alone is accepted (a POS that only sends the receipt total). Returns { sale } or { error }.
 */
export function normalizePosSale(body, now = Date.now()) {
  const b = body && typeof body === "object" ? body : null;
  if (!b) return { error: "Body must be a JSON object" };
  const receiptId = clip(b.receipt_id, 60);
  if (!receiptId) return { error: "receipt_id is required (the POS receipt number)" };
  let soldAt = now;
  if (b.sold_at !== undefined && b.sold_at !== null && b.sold_at !== "") {
    const t = typeof b.sold_at === "number" ? b.sold_at : Date.parse(String(b.sold_at));
    if (!Number.isFinite(t)) return { error: "sold_at must be an ISO date-time" };
    if (t > now + 10 * 60_000 || t < now - 400 * 86_400_000) return { error: "sold_at is in the future or more than 400 days ago" };
    soldAt = t;
  }
  const payment = String(b.payment ?? "other").toLowerCase();
  if (!POS_PAYMENTS.includes(payment)) return { error: `payment must be one of ${POS_PAYMENTS.join(", ")}` };
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length > 200) return { error: "At most 200 items per receipt" };
  const items = [];
  for (const it of rawItems) {
    const name = clip(it?.name, 120), qty = Number(it?.quantity ?? 1), unit = Number(it?.unit_price);
    if (!name || !Number.isFinite(qty) || qty <= 0 || qty > 1000 || !Number.isFinite(unit) || Math.abs(unit) > 10_000) return { error: "Each item needs name, quantity (> 0) and unit_price (EUR)" };
    const q = Math.round(qty * 1000) / 1000;
    items.push({ name, sku: clip(it?.sku, 60), quantity: q, unitCents: cents(unit), amountCents: Math.round(cents(unit) * q) });
  }
  const itemsTotal = items.reduce((s, i) => s + i.amountCents, 0);
  let totalCents;
  if (b.total !== undefined && b.total !== null) {
    if (!Number.isFinite(Number(b.total)) || Math.abs(Number(b.total)) > 50_000) return { error: "total must be a number (EUR)" };
    totalCents = cents(b.total);
    if (items.length && Math.abs(totalCents - itemsTotal) > 5) return { error: `total ${(totalCents / 100).toFixed(2)} does not match the items ${(itemsTotal / 100).toFixed(2)}` };
  } else if (items.length) totalCents = itemsTotal;
  else return { error: "Send items or total" };
  if (totalCents <= 0 && payment === "room") return { error: "A room charge must be more than 0" };
  const room = clip(b.room, 60);
  if (payment === "room" && !room) return { error: "payment \"room\" needs room (room number or booking reference)" };
  const covers = Math.max(0, Math.min(500, Math.round(Number(b.covers) || 0)));
  const { date, hour } = hotelDateHour(soldAt);
  return { sale: { receiptId, soldAt, soldDate: date, soldHour: hour, payment, room: payment === "room" ? room : clip(b.room, 60), items, totalCents, covers } };
}

// ───────────────────────────── CSV import ─────────────────────────────

function splitCsvLine(line, sep) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const HEADERS = {
  date: ["date", "ημερομηνία", "ημερομηνια", "ημ/νία"], time: ["time", "ώρα", "ωρα"], receipt: ["receipt", "receipt_id", "απόδειξη", "αποδειξη", "αρ. απόδειξης", "αρ. αποδειξης", "παραστατικό", "παραστατικο"],
  item: ["item", "name", "είδος", "ειδος", "προϊόν", "προιον", "περιγραφή", "περιγραφη"], sku: ["sku", "code", "κωδικός", "κωδικος"], quantity: ["quantity", "qty", "ποσότητα", "ποσοτητα"],
  price: ["price", "unit_price", "τιμή", "τιμη", "τιμή μονάδας", "τιμη μοναδας"], amount: ["amount", "total", "αξία", "αξια", "σύνολο", "συνολο"], payment: ["payment", "πληρωμή", "πληρωμη", "τρόπος πληρωμής", "τροπος πληρωμης"], room: ["room", "δωμάτιο", "δωματιο"],
};
const num = (s) => { const t = String(s ?? "").replace(/[€\s]/g, ""); return Number(/,\d{1,3}$/.test(t) && !/\.\d{3},/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "")); };
function csvDate(s) {
  const t = String(s ?? "").trim();
  if (isDate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3], d = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDate(d) ? d : "";
}
function paymentOf(s) {
  const t = String(s ?? "").toLowerCase();
  if (/room|δωμ|λογαρ/.test(t)) return "room";
  if (/card|κάρτ|καρτ|pos|visa|master/.test(t)) return "card";
  if (/cash|μετρ/.test(t)) return "cash";
  return "other";
}
/** Hotel time → epoch ms (Europe/Athens: UTC+2 in winter, +3 in summer). */
export function athensToMs(date, time = "12:00") {
  const guess = Date.parse(`${date}T${time}:00Z`);
  for (const off of [3, 2]) {
    const ms = guess - off * 3_600_000, h = hotelDateHour(ms);
    if (h.date === date && h.hour === Number(time.slice(0, 2))) return ms;
  }
  return guess - 2 * 3_600_000;
}

/**
 * A sales export from a POS (one line per item; ; or , separated; Greek or English headers): rows of the same receipt
 * become one sale. Returns { sales, errors } — errors name the line.
 */
export function parseSalesCsv(text) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { sales: [], errors: ["The file has no lines after the header"] };
  if (lines.length > 20_001) return { sales: [], errors: ["At most 20,000 lines per file"] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (col.date < 0 || col.receipt < 0 || (col.amount < 0 && col.price < 0)) return { sales: [], errors: ["Columns needed: date, receipt, and price or amount (also: time, item, quantity, payment, room)"] };
  const byReceipt = new Map(), errors = [];
  lines.slice(1).forEach((line, i) => {
    const c = splitCsvLine(line, sep), n = i + 2;
    const date = csvDate(c[col.date]), receipt = clip(c[col.receipt], 60);
    const time = col.time >= 0 && /^\d{1,2}:\d{2}/.test(c[col.time] ?? "") ? c[col.time].padStart(5, "0").slice(0, 5) : "12:00";
    const qty = col.quantity >= 0 && c[col.quantity] !== "" ? num(c[col.quantity]) : 1;
    const unit = col.price >= 0 && c[col.price] !== "" ? num(c[col.price]) : num(c[col.amount]) / (qty || 1);
    if (!date || !receipt || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unit)) { if (errors.length < 20) errors.push(`Line ${n}: date, receipt, quantity or price is not readable`); return; }
    const s = byReceipt.get(receipt) ?? { receipt_id: receipt, sold_at: athensToMs(date, time), payment: col.payment >= 0 ? paymentOf(c[col.payment]) : "other", room: col.room >= 0 ? clip(c[col.room], 60) : "", items: [] };
    s.items.push({ name: col.item >= 0 && c[col.item] ? c[col.item] : "—", sku: col.sku >= 0 ? c[col.sku] : "", quantity: qty, unit_price: Math.round(unit * 100) / 100 });
    byReceipt.set(receipt, s);
  });
  return { sales: [...byReceipt.values()], errors };
}

// ───────────────────────────── audience of an offer ─────────────────────────────

/** { segment, departmentId (the department "used / not used" refers to), languages } */
export function normalizeAudience(v) {
  const r = v && typeof v === "object" ? v : {};
  const segment = AUDIENCE_SEGMENTS.includes(r.segment) ? r.segment : "all";
  const languages = Array.isArray(r.languages) ? [...new Set(r.languages.filter((l) => ["el", "en", "fr", "de", "it", "es"].includes(l)))] : [];
  const departmentId = Number.isInteger(Number(r.departmentId)) && Number(r.departmentId) > 0 ? Number(r.departmentId) : null;
  return { segment, departmentId, languages };
}

/**
 * Is a guest in house (or arriving today) in the audience? guest = { checkIn, checkOut, adults, children, lang,
 * usedDepartments: number[] }. "used / not used" is about the stay so far (app orders and POS receipts on the room).
 */
export function matchesAudience(guest, audience, today, fallbackDepartmentId = null) {
  const a = normalizeAudience(audience), dept = a.departmentId ?? fallbackDepartmentId;
  const lang = String(guest.lang ?? "en").slice(0, 2);
  if (a.languages.length && !a.languages.includes(lang)) return false;
  const used = (guest.usedDepartments ?? []).map(Number);
  const nights = daysBetween(guest.checkIn, guest.checkOut), adults = Number(guest.adults ?? 1), children = Number(guest.children ?? 0);
  switch (a.segment) {
    case "not_used": return dept ? !used.includes(dept) : used.length === 0;
    case "used": return dept ? used.includes(dept) : used.length > 0;
    case "families": return children > 0;
    case "couples": return adults === 2 && children === 0;
    case "arriving_today": return guest.checkIn === today;
    case "departing_tomorrow": return guest.checkOut === addDays(today, 1);
    case "long_stay": return nights >= 5;
    default: return true;
  }
}

export const promoPrice = (listCents, percent) => Math.max(0, Math.round(Number(listCents) * (100 - Math.max(0, Math.min(MAX_DISCOUNT * 2, Number(percent) || 0))) / 100));
export const discountPercent = (listCents, promoCents) => (Number(listCents) > 0 ? Math.round((1 - Number(promoCents) / Number(listCents)) * 100) : 0);

// ───────────────────────────── sales summary ─────────────────────────────

/**
 * Sales per department from one list of sales { departmentId, date, hour, totalCents, payment, source ('app' | 'pos'
 * | 'csv'), bookingId, items: [{ name, quantity, amountCents }] } over [from, to]. `previous` is the same for the
 * period before (for the change in %). inHouseBookings: bookings in house during the period (for penetration).
 */
export function salesSummary(sales, from, to, previous = [], inHouseBookings = 0) {
  const days = Math.max(1, daysBetween(from, to) + 1);
  const blank = () => ({ revenueCents: 0, receipts: 0, guests: new Set(), byPayment: { cash: 0, card: 0, room: 0, other: 0 }, bySource: { app: 0, pos: 0, csv: 0 }, byDay: {}, byHour: Array(24).fill(0), items: new Map() });
  const fold = (list) => {
    const m = new Map();
    for (const s of list) {
      const d = m.get(s.departmentId) ?? blank();
      d.revenueCents += s.totalCents; d.receipts++;
      if (s.bookingId) d.guests.add(s.bookingId);
      d.byPayment[s.payment in d.byPayment ? s.payment : "other"] += s.totalCents;
      d.bySource[s.source in d.bySource ? s.source : "pos"] += s.totalCents;
      d.byDay[s.date] = (d.byDay[s.date] ?? 0) + s.totalCents;
      d.byHour[s.hour] += s.totalCents;
      for (const it of s.items ?? []) {
        const k = String(it.name).trim().toLowerCase(), x = d.items.get(k) ?? { name: String(it.name).trim(), quantity: 0, revenueCents: 0 };
        x.quantity += Number(it.quantity); x.revenueCents += Number(it.amountCents); d.items.set(k, x);
      }
      m.set(s.departmentId, d);
    }
    return m;
  };
  const cur = fold(sales), prev = fold(previous);
  const ids = [...new Set([...cur.keys(), ...prev.keys()])];
  const change = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const departments = ids.map((id) => {
    const d = cur.get(id) ?? blank(), p = prev.get(id) ?? blank();
    const daily = [];
    for (let i = 0; i < days; i++) { const date = addDays(from, i); daily.push({ date, revenueCents: d.byDay[date] ?? 0 }); }
    return {
      departmentId: id, revenueCents: d.revenueCents, receipts: d.receipts, avgTicketCents: d.receipts ? Math.round(d.revenueCents / d.receipts) : 0,
      guests: d.guests.size, penetration: inHouseBookings ? Math.round((d.guests.size / inHouseBookings) * 100) : null,
      byPayment: d.byPayment, bySource: d.bySource, byHour: d.byHour, daily,
      topItems: [...d.items.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10).map((x) => ({ ...x, quantity: Math.round(x.quantity * 1000) / 1000 })),
      previousRevenueCents: p.revenueCents, changePercent: change(d.revenueCents, p.revenueCents),
    };
  }).sort((a, b) => b.revenueCents - a.revenueCents);
  const total = departments.reduce((s, d) => s + d.revenueCents, 0), prevTotal = departments.reduce((s, d) => s + d.previousRevenueCents, 0);
  const receipts = departments.reduce((s, d) => s + d.receipts, 0);
  return { from, to, days, totalCents: total, previousTotalCents: prevTotal, changePercent: change(total, prevTotal), receipts, avgTicketCents: receipts ? Math.round(total / receipts) : 0, perDayCents: Math.round(total / days), departments };
}

// ───────────────────────────── sales advisor: rules ─────────────────────────────

const pct = (n) => `${n}%`;
const eur = (c) => `€${(Number(c) / 100).toFixed(2).replace(/\.00$/, "")}`;
const minutes = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
/** Hours (0–23) a department is open (hours that pass midnight supported; equal times = all day). */
export function openHours(from, to) {
  if (minutes(from) === minutes(to)) return [...Array(24).keys()];
  const f = Math.floor(minutes(from) / 60), t = Math.ceil(minutes(to) / 60) % 24;
  const count = (t - f + 24) % 24 || 24;
  return Array.from({ length: count }, (_, i) => (f + i) % 24);
}

/** The two quietest open hours in a row (share of the department's sales), when the department is open ≥ 6 hours. */
export function quietWindow(byHour, from, to) {
  const hours = openHours(from, to), total = byHour.reduce((s, v) => s + v, 0);
  if (hours.length < 6 || total <= 0) return null;
  let best = null;
  for (let i = 0; i + 1 < hours.length; i++) {
    const share = (byHour[hours[i]] + byHour[hours[i + 1]]) / total;
    if (!best || share < best.share) best = { start: hours[i], end: (hours[i + 1] + 1) % 24, share };
  }
  return best && best.share < 0.06 ? { start: best.start, end: best.end, share: Math.round(best.share * 100) } : null;
}
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

/**
 * Suggestions without AI, from the figures of each department (stats from gatherAdvisorStats). Each one has a stable
 * rule_key (one per rule, department and day) so the daily run never repeats an open suggestion.
 */
export function ruleSuggestions(stats) {
  const out = [], { today, inHouse } = stats;
  const push = (s) => out.push({ confidence: "medium", discountPercent: 0, itemId: null, startsHour: null, durationHours: 0, audience: { segment: "all", departmentId: s.departmentId ?? null, languages: [] }, ...s });
  for (const d of stats.departments) {
    if (!d.active) continue;
    const key = (rule) => `${rule}:${d.id}:${today}`;
    const best = [...d.items].filter((i) => i.active).sort((a, b) => b.sold30 - a.sold30)[0] ?? null;
    // POS connected but silent while the department is open every day.
    if (d.posConnected && d.cur.receipts > 0 && d.lastPosSaleAt && stats.now - d.lastPosSaleAt > 48 * 3_600_000) {
      push({ ruleKey: key("pos_silent"), departmentId: d.id, kind: "alert", confidence: "high", title: `${d.name}: το POS δεν έχει στείλει πωλήσεις για ${Math.floor((stats.now - d.lastPosSaleAt) / 3_600_000)} ώρες`, reasoning: "Ελέγξτε ότι το POS είναι συνδεδεμένο στο internet και ότι το κλειδί δεν ανακλήθηκε. Αλλιώς οι πωλήσεις του τμήματος λείπουν από τις αναφορές." });
    }
    if (!inHouse.total) continue;
    // Sales fell against the two weeks before.
    if (d.prev.revenueCents >= 20_000 && d.cur.revenueCents < d.prev.revenueCents * 0.75) {
      const drop = Math.round((1 - d.cur.revenueCents / d.prev.revenueCents) * 100);
      push({ ruleKey: key("drop"), departmentId: d.id, kind: "offer", confidence: "medium", discountPercent: 15, itemId: best?.id ?? null, durationHours: 48,
        title: `${d.name}: πτώση πωλήσεων ${pct(drop)} τις τελευταίες 14 μέρες`, reasoning: `${eur(d.cur.revenueCents)} έναντι ${eur(d.prev.revenueCents)} το προηγούμενο 14ήμερο. Μια προσφορά 48 ωρών στο πιο δημοφιλές${best ? ` («${best.name}»)` : ""} σε όλους τους πελάτες που μένουν τώρα μπορεί να φέρει ξανά κίνηση.`,
        titleEl: `Προσφορά ${d.name}`, titleEn: `${d.nameEn || d.name} offer`, messageEl: `{name}, μόνο για τις επόμενες 48 ώρες: -15%${best ? ` στο «${best.name}»` : ""} στο ${d.name}. Παραγγείλτε από την εφαρμογή.`, messageEn: `{name}, for the next 48 hours only: 15% off${best ? ` “${best.nameEn || best.name}”` : ""} at the ${d.nameEn || d.name}. Order in the app.` });
    }
    // Few guests in house use the department.
    if (d.nonUsers >= 4 && d.inHousePenetration !== null && d.inHousePenetration < 20) {
      push({ ruleKey: key("penetration"), departmentId: d.id, kind: "offer", discountPercent: 10, itemId: best?.id ?? null, durationHours: 24, audience: { segment: "not_used", departmentId: d.id, languages: [] },
        title: `${d.name}: μόνο ${pct(d.inHousePenetration)} των πελατών το έχει χρησιμοποιήσει`, reasoning: `${d.nonUsers} δωμάτια που μένουν τώρα δεν έχουν αγοράσει τίποτα από το τμήμα. Ένα προσωπικό μήνυμα με μικρή έκπτωση μόνο σε αυτούς φέρνει νέους πελάτες στο τμήμα, χωρίς έκπτωση σε όσους ήδη αγοράζουν.`,
        titleEl: `Γνωρίστε το ${d.name}`, titleEn: `Discover the ${d.nameEn || d.name}`, messageEl: `{name}, δεν έχετε δοκιμάσει ακόμα το ${d.name}! Σήμερα έχετε -10%${best ? ` στο «${best.name}»` : ""}.`, messageEn: `{name}, you haven't tried the ${d.nameEn || d.name} yet! Today you get 10% off${best ? ` “${best.nameEn || best.name}”` : ""}.` });
    }
    // Last chance for an appointment department (spa, massage) before departure.
    if (d.mode === "appointment" && d.departingTomorrowNonUsers >= 1) {
      push({ ruleKey: key("last_chance"), departmentId: d.id, kind: "offer", discountPercent: 15, itemId: best?.id ?? null, durationHours: 24, audience: { segment: "departing_tomorrow", departmentId: d.id, languages: [] },
        title: `${d.name}: ${d.departingTomorrowNonUsers} πελάτες φεύγουν αύριο χωρίς να το έχουν δοκιμάσει`, reasoning: "Οι τελευταίες μέρες της διαμονής είναι η καλύτερη στιγμή για ένα ραντεβού χαλάρωσης. Το μήνυμα πηγαίνει μόνο σε όσους φεύγουν αύριο και δεν έχουν κλείσει ραντεβού.",
        titleEl: "Πριν φύγετε…", titleEn: "Before you leave…", messageEl: `{name}, χαρίστε στον εαυτό σας μια στιγμή χαλάρωσης πριν την αναχώρηση: -15%${best ? ` στο «${best.name}»` : ""} σήμερα και αύριο.`, messageEn: `{name}, treat yourself before you leave: 15% off${best ? ` “${best.nameEn || best.name}”` : ""} today and tomorrow.` });
    }
    // Quiet hours → happy hour (order departments: bar, café, restaurant).
    const quiet = d.mode === "order" && d.cur.receipts >= 15 ? quietWindow(d.byHour, d.openFrom, d.openTo) : null;
    if (quiet) {
      push({ ruleKey: key("happy_hour"), departmentId: d.id, kind: "happy_hour", discountPercent: 20, startsHour: quiet.start, durationHours: 2,
        title: `${d.name}: ήσυχες ώρες ${hh(quiet.start)}–${hh(quiet.end)} (${pct(quiet.share)} των πωλήσεων)`, reasoning: `Το τμήμα είναι ανοιχτό αλλά σχεδόν άδειο αυτές τις ώρες. Ένα happy hour μεταφέρει κίνηση εκεί χωρίς να χάνετε τις κανονικές ώρες αιχμής.`,
        titleEl: `Happy hour ${hh(quiet.start)}–${hh(quiet.end)}`, titleEn: `Happy hour ${hh(quiet.start)}–${hh(quiet.end)}`, messageEl: `Σήμερα ${hh(quiet.start)}–${hh(quiet.end)} στο ${d.name}: -20% σε όλο τον κατάλογο!`, messageEn: `Today ${hh(quiet.start)}–${hh(quiet.end)} at the ${d.nameEn || d.name}: 20% off everything!` });
    }
    // Families in house and a department with something for children / families.
    if (inHouse.families >= 2 && ["restaurant", "kids", "pool", "beach"].includes(d.icon)) {
      push({ ruleKey: key("families"), departmentId: d.id, kind: "bundle", discountPercent: 10, durationHours: 72, audience: { segment: "families", departmentId: d.id, languages: [] },
        title: `${d.name}: ${inHouse.families} οικογένειες με παιδιά μένουν τώρα`, reasoning: "Ένα οικογενειακό πακέτο (π.χ. 2 ενήλικες + παιδιά) με μικρή έκπτωση πηγαίνει μόνο στις κρατήσεις με παιδιά.",
        titleEl: "Για όλη την οικογένεια", titleEn: "For the whole family", messageEl: `{name}, για τις οικογένειες: -10% στο ${d.name} για όλη την παρέα τις επόμενες 3 μέρες.`, messageEn: `{name}, for families: 10% off at the ${d.nameEn || d.name} for the whole group for the next 3 days.` });
    }
    // Items that nobody bought in 30 days while the department sells.
    const dead = d.cur.receipts >= 10 ? d.items.filter((i) => i.active && i.sold30 === 0 && i.ageDays >= 30) : [];
    if (dead.length) {
      push({ ruleKey: key("menu"), departmentId: d.id, kind: "menu", confidence: "low", itemId: dead[0].id,
        title: `${d.name}: ${dead.length} ${dead.length === 1 ? "είδος δεν πουλήθηκε" : "είδη δεν πουλήθηκαν"} τις τελευταίες 30 μέρες`, reasoning: `${dead.slice(0, 5).map((i) => `«${i.name}»`).join(", ")}. Αλλάξτε την περιγραφή ή τη φωτογραφία, βάλτε τα σε προσφορά ή αφαιρέστε τα από τον κατάλογο.` });
    }
    // No offer for two weeks while guests are in house.
    if (d.daysSinceOffer >= 14 && d.cur.revenueCents > 0 && !out.some((s) => s.departmentId === d.id && s.kind !== "alert" && s.kind !== "menu")) {
      push({ ruleKey: key("no_offer"), departmentId: d.id, kind: "offer", confidence: "low", discountPercent: 10, itemId: best?.id ?? null, durationHours: 24,
        title: `${d.name}: καμία προσφορά εδώ και ${d.daysSinceOffer >= 365 ? "πολύ καιρό" : `${d.daysSinceOffer} μέρες`}`, reasoning: "Οι πελάτες βλέπουν τις προσφορές στην εφαρμογή και στο κινητό. Μια μικρή προσφορά ημέρας κρατάει το τμήμα στο μυαλό τους.",
        titleEl: `Η πρόταση της ημέρας`, titleEn: "Today's pick", messageEl: `Σήμερα στο ${d.name}${best ? `: «${best.name}» με -10%` : " έχουμε κάτι ξεχωριστό για εσάς"}.`, messageEn: `Today at the ${d.nameEn || d.name}${best ? `: “${best.nameEn || best.name}” 10% off` : ": something special for you"}.` });
    }
  }
  return out;
}

// ───────────────────────────── sales advisor: the salesperson's playbook ─────────────────────────────

/**
 * Methods a professional hotel salesperson uses, per kind of department (by its icon). Shown in the PMS for every
 * department (also without AI) and given to Claude as the baseline it adapts to the figures.
 */
export const SALES_PLAYBOOK = {
  bar: ["Happy hour στις ήσυχες ώρες (όχι στις ώρες αιχμής)", "Upsell: πρόταση premium ποτού ή διπλού στην παραγγελία, cocktail της ημέρας", "Cross-sell: σνακ / πλατό με το δεύτερο ποτό", "Ηλιοβασίλεμα: μήνυμα 1 ώρα πριν με το signature cocktail", "Καλωσόρισμα: κουπόνι πρώτου ποτού στους πελάτες που φτάνουν σήμερα"],
  coffee: ["Πακέτο πρωινού καφέ για όλη τη διαμονή (προπληρωμένο, με έκπτωση)", "Take-away για την παραλία το πρωί", "Γλυκό της ημέρας μαζί με τον απογευματινό καφέ"],
  restaurant: ["Κράτηση τραπεζιού για το βράδυ με μήνυμα το μεσημέρι (το «τι θα φάμε απόψε»)", "Μενού γευσιγνωσίας / πιάτο του σεφ ως «μόνο σήμερα»", "Οικογενειακό μενού και παιδικό μενού στις κρατήσεις με παιδιά", "Early bird (π.χ. 18:30–19:30) για να γεμίσουν οι νωρίς ώρες", "Ζευγάρι κρασιού με το κυρίως πιάτο"],
  spa: ["Πακέτο για ζευγάρια (μασάζ για δύο + ποτό)", "Κράτηση πριν την άφιξη ή την πρώτη μέρα (υψηλότερη πληρότητα ραντεβού)", "«Πριν φύγετε»: προσφορά την προτελευταία και τελευταία μέρα", "Off-peak έκπτωση στις κενές ώρες ραντεβού", "Add-on: αναβάθμιση 60′ → 90′, αρωματοθεραπεία, scrub"],
  gym: ["Personal training / ομαδικό πρωινό μάθημα (yoga, stretching)", "Πακέτο ευεξίας: γυμναστήριο + smoothie + spa", "Υπενθύμιση το πρωί στις μεγάλες διαμονές"],
  pool: ["Ποτά και σνακ στην ξαπλώστρα με παραγγελία από την εφαρμογή", "Cabana / VIP ξαπλώστρα για ζευγάρια", "Παιδικές δραστηριότητες για τις οικογένειες"],
  beach: ["Κράτηση ξαπλώστρας από το προηγούμενο βράδυ (πρώτη σειρά = υψηλότερη τιμή)", "Πακέτο ξαπλώστρα + ποτά / νερό / φρούτα", "Μήνυμα το πρωί με τον καιρό και τη διαθεσιμότητα", "Πολυήμερο πάσο για τις μεγάλες διαμονές"],
  bike: ["Ενοικίαση με εκδρομή και χάρτη διαδρομής", "Πολυήμερη ενοικίαση με έκπτωση"],
  car: ["Ενοικίαση από την άφιξη για όλη τη διαμονή", "Μισή μέρα για τις παραλίες της Πάρου"],
  shop: ["Τοπικά προϊόντα ως αναμνηστικό την ημέρα αναχώρησης", "Δώρο έκπληξη στο δωμάτιο για επετείους / γενέθλια"],
  kids: ["Πρόγραμμα ημέρας για παιδιά ώστε οι γονείς να χρησιμοποιήσουν το spa / το εστιατόριο", "Πακέτο οικογένειας"],
  bell: ["Πρόταση μαζί με την επιβεβαίωση κράτησης και την ημέρα άφιξης", "Πακέτα που συνδυάζουν δύο τμήματα"],
};
/** The playbook of a department (by icon; general methods when the icon has none). */
export const playbookFor = (icon) => SALES_PLAYBOOK[icon] ?? SALES_PLAYBOOK.bell;

// ───────────────────────────── sales advisor: Claude ─────────────────────────────

export const ADVISOR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "department_tips", "suggestions"],
  properties: {
    summary: { type: "string", description: "Three to six sentences in Greek: how each department is doing and the main advice" },
    department_tips: {
      type: "array", description: "For every department: 2–4 standing sales methods a professional would use there now, adapted to its figures",
      items: { type: "object", additionalProperties: false, required: ["department_id", "tips"], properties: { department_id: { type: "integer" }, tips: { type: "array", items: { type: "string" } } } },
    },
    suggestions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["department_id", "kind", "title", "reasoning", "segment", "item_id", "discount_percent", "starts_hour", "duration_hours", "title_el", "title_en", "message_el", "message_en", "confidence"],
        properties: {
          department_id: { type: "integer" }, kind: { type: "string", enum: SUGGESTION_KINDS },
          title: { type: "string", description: "Short, in Greek, for the hotel manager" }, reasoning: { type: "string", description: "One to three sentences in Greek citing the figures" },
          segment: { type: "string", enum: AUDIENCE_SEGMENTS }, item_id: { type: ["integer", "null"] }, discount_percent: { type: "integer", description: `0 to ${MAX_DISCOUNT}` },
          starts_hour: { type: ["integer", "null"], description: "Hotel hour 0–23 the offer starts today; null = now" }, duration_hours: { type: "integer", description: "0 = no offer message (advice only)" },
          title_el: { type: "string" }, title_en: { type: "string" }, message_el: { type: "string", description: "Message to guests in Greek, may start with {name}" }, message_en: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
};

export const ADVISOR_SYSTEM = `You are a professional hotel salesperson and the sales and F&B manager of Hotel Corali, a small family hotel in Piso Livadi, Paros (Cyclades, Greece). The hotel has departments (bar, restaurant, spa, gym, beach loungers…); guests order in the hotel app (charged to the room) and pay at the department POS.
Each day you look at every department and propose concrete actions that raise sales without cheapening the hotel:
- targeted offers to a group of guests in house (segment): guests who have not used a department yet (not_used), repeat users (used), families, couples, arriving today, departing tomorrow, long stays;
- happy hours in quiet hours, bundles (e.g. massage for two, sunbed + drinks), timing (when to send), menu changes (items nobody buys, best sellers to push), price advice;
- alerts when something looks wrong (a POS that stopped sending sales, a sudden drop).
Work like an experienced salesperson: know what sells in each kind of department (the PLAYBOOK given per department is your baseline — adapt it, don't repeat it blindly), use upselling (a better / bigger option), cross-selling (something that goes with it), bundles across departments, timing (the right moment of the day and of the stay: arrival, middle, last days), scarcity and urgency only when true ("only today", "last slots"), personal relevance (couples, families, long stays, nationality / language), and follow up what worked (conversion of past offers).
In department_tips give, for every department, 2–4 concrete standing methods for this week (Greek, one sentence each).
Rules: use only the figures given; cite them. At most 6 suggestions, best first, at most 2 per department. Discounts 0–${MAX_DISCOUNT}%, prefer 10–20%, never discount a department that is selling well at its peak hours. item_id only from the item list of that department. Guest messages short (one or two sentences), warm, no exaggeration, in Greek and English, may start with {name}; set duration_hours 0 for advice that needs no message. Write title, reasoning and summary in Greek. Respect the weather/season context: beach and pool depend on the season.`;

/** The figures Claude reads (text table, no guest names). */
export function advisorPrompt(stats) {
  const lines = [`Today (hotel time): ${stats.today}, ${stats.weekday}. Guests in house: ${stats.inHouse.total} rooms (${stats.inHouse.families} with children, ${stats.inHouse.couples} couples, ${stats.inHouse.arrivingToday} arriving today, ${stats.inHouse.departingTomorrow} departing tomorrow; languages ${Object.entries(stats.inHouse.languages).map(([l, n]) => `${l} ${n}`).join(", ") || "-"}). Occupancy next 7 nights: ${stats.occupancyNext7.map((o) => `${o.date.slice(5)} ${o.percent}%`).join(", ")}.`];
  for (const d of stats.departments) {
    lines.push(`\nDEPARTMENT ${d.id} «${d.name}» (${d.icon}, ${d.mode === "appointment" ? "appointments" : "orders"}, open ${d.openFrom}–${d.openTo}${d.active ? "" : ", INACTIVE"}${d.posConnected ? ", POS connected" : ", no POS"})`);
    lines.push(`Last 14 days: ${eur(d.cur.revenueCents)} in ${d.cur.receipts} sales (app ${eur(d.cur.appCents)}, POS ${eur(d.cur.revenueCents - d.cur.appCents)}); 14 days before: ${eur(d.prev.revenueCents)} in ${d.prev.receipts}. Average ticket ${d.cur.receipts ? eur(Math.round(d.cur.revenueCents / d.cur.receipts)) : "-"}.`);
    lines.push(`Guests in house who used it this stay: ${d.inHousePenetration ?? "-"}% (${d.nonUsers} rooms have not; ${d.departingTomorrowNonUsers} of them depart tomorrow). Days since last offer: ${d.daysSinceOffer >= 365 ? "never" : d.daysSinceOffer}.`);
    lines.push(`Sales by hour (last 14 days, €): ${d.byHour.map((v, h) => (v ? `${h}h ${Math.round(v / 100)}` : "")).filter(Boolean).join(", ") || "none"}.`);
    lines.push(`PLAYBOOK: ${playbookFor(d.icon).join(" | ")}.`);
    lines.push(`Items (id · name · price · sold last 30 days): ${d.items.filter((i) => i.active).map((i) => `${i.id} · ${i.name} · ${eur(i.priceCents)} · ${i.sold30}`).join(" | ") || "none"}.`);
    if (d.activeOffers.length) lines.push(`Active offers now: ${d.activeOffers.join(" | ")}.`);
  }
  return lines.join("\n");
}

/** Claude's answer checked against the figures: departments and items that exist, discount and hours in range. */
export function normalizeAiSuggestions(answer, stats) {
  const list = Array.isArray(answer?.suggestions) ? answer.suggestions : [];
  const out = [];
  for (const s of list.slice(0, 8)) {
    const d = stats.departments.find((x) => x.id === Number(s.department_id));
    if (!d) continue;
    const item = s.item_id !== null && s.item_id !== undefined ? d.items.find((i) => i.id === Number(s.item_id)) : null;
    const kind = SUGGESTION_KINDS.includes(s.kind) ? s.kind : "offer";
    const sh = Number.isInteger(s.starts_hour) && s.starts_hour >= 0 && s.starts_hour <= 23 ? s.starts_hour : null;
    out.push({
      ruleKey: "", departmentId: d.id, kind, title: clip(s.title, 200) || d.name, reasoning: clip(s.reasoning, 1200),
      audience: normalizeAudience({ segment: s.segment, departmentId: d.id }), itemId: item ? item.id : null,
      discountPercent: Math.max(0, Math.min(MAX_DISCOUNT, Math.round(Number(s.discount_percent) || 0))), startsHour: sh,
      durationHours: Math.max(0, Math.min(14 * 24, Math.round(Number(s.duration_hours) || 0))),
      titleEl: clip(s.title_el, 120), titleEn: clip(s.title_en, 120), messageEl: clip(s.message_el, 600), messageEn: clip(s.message_en, 600),
      confidence: ["low", "medium", "high"].includes(s.confidence) ? s.confidence : "medium",
    });
  }
  const tips = [];
  for (const t of Array.isArray(answer?.department_tips) ? answer.department_tips : []) {
    const d = stats.departments.find((x) => x.id === Number(t?.department_id));
    if (d && Array.isArray(t.tips)) tips.push({ departmentId: d.id, tips: t.tips.map((x) => clip(x, 300)).filter(Boolean).slice(0, 4) });
  }
  return { summary: clip(answer?.summary, 3000), suggestions: out, tips };
}

/** When the offer of a suggestion starts and ends (hotel hour today; past hours → now). */
export function suggestionWindow(s, now) {
  let start = now;
  if (s.startsHour !== null && s.startsHour !== undefined) {
    const { date, hour } = hotelDateHour(now);
    if (s.startsHour > hour) start = athensToMs(date, hh(s.startsHour));
  }
  return { startsAt: start, endsAt: s.durationHours > 0 ? start + s.durationHours * 3_600_000 : null };
}
