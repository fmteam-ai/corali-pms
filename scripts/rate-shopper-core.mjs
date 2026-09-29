// Competitor rate shopper: URL templating and tolerant parsing of rate-shopping API responses (pure; unit tested).
// Rates come from a licensed rate-shopping API or manual entry; OTA pages are not scraped.

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Fill {from} {to} {date} {checkout} placeholders (URL-encoded) in an https endpoint template. */
export function buildRateUrl(template, values) {
  const url = String(template).replace(/\{(from|to|date|checkout)\}/g, (_, k) => encodeURIComponent(values[k] ?? ""));
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw Error("HTTPS_REQUIRED");
  return parsed.toString();
}

const toCents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^\d.,-]/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) : null;
};

/**
 * Accepts {rates:[{date,rate}]}, a bare array, or a {"YYYY-MM-DD": rate} map. Field aliases: date/stay_date/checkin,
 * rate/price/amount/lowest_rate; sold_out/available=false mark a sold-out date. Only dates within [from, to] are kept.
 */
export function parseRates(body, from, to) {
  let list = [];
  if (Array.isArray(body)) list = body;
  else if (body && Array.isArray(body.rates)) list = body.rates;
  else if (body && Array.isArray(body.data)) list = body.data;
  else if (body && typeof body === "object") list = Object.entries(body).filter(([k]) => isoDate.test(k)).map(([date, rate]) => ({ date, rate }));
  const out = new Map();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const date = String(item.date ?? item.stay_date ?? item.checkin ?? "").slice(0, 10);
    if (!isoDate.test(date) || date < from || date > to) continue;
    const soldOut = item.sold_out === true || item.soldOut === true || item.available === false;
    const cents = soldOut ? null : toCents(item.rate ?? item.price ?? item.amount ?? item.lowest_rate);
    if (!soldOut && cents === null) continue;
    out.set(date, { date, rateCents: cents, soldOut });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Manual entry: one "YYYY-MM-DD;120" (or comma/tab/space separated, "sold" for sold out) per line. */
export function parseManualRates(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})[\s;,\t]+(.+)$/);
    if (!m) continue;
    const value = m[2].trim().toLowerCase();
    if (/^(sold|sold out|full|x)$/.test(value)) rows.push({ date: m[1], rateCents: null, soldOut: true });
    else { const cents = toCents(value); if (cents !== null) rows.push({ date: m[1], rateCents: cents, soldOut: false }); }
  }
  return rows.slice(0, 400);
}
