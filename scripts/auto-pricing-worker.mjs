// Corali automatic pricing run (hourly from the automation cron, or "Run now" in the PMS): computes every night's
// price per room type inside the hotel's limits, keeps the list for the PMS and — in "auto" mode — writes them as
// one-night season prices (source='auto') that the booking engine and the Channex rate push already use.
import { autoPrice, normalizeAutoPricing } from "./auto-pricing-core.mjs";
import { typeNightlyCents } from "./channel-core.mjs";

const athensToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const codes = (v) => { try { const x = JSON.parse(String(v || "[]")); return Array.isArray(x) ? x : []; } catch { return []; } };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** Runs when due (hourly, or after the settings changed); `force` runs now. Returns a one-line summary or null. */
export async function runAutoPricing({ pool, owner, force = false }) {
  const row = (await pool.query(`SELECT settings_json,updated_at,last_run_at FROM auto_pricing_settings WHERE owner_id=$1`, [owner])).rows[0];
  if (!row) return null;
  const now = Date.now();
  if (!force && row.last_run_at && Number(row.last_run_at) > now - 55 * 60_000 && Number(row.updated_at) < Number(row.last_run_at)) return null;
  let raw = null;
  try { raw = JSON.parse(String(row.settings_json)); } catch { raw = null; }
  const s = normalizeAutoPricing(raw), today = athensToday();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('rate_rules:' || $1))`, [owner]);
    // Old automatic prices are removed when the feature is off, in "suggest" mode, or long past.
    await client.query(`DELETE FROM rate_rules WHERE owner_id=$1 AND source='auto' AND (ends_on<$2 OR $3::boolean)`, [owner, addDays(today, -7), !(s.enabled && s.mode === "auto")]);
    const types = s.enabled ? Object.entries(s.types).filter(([, t]) => t.enabled).map(([k]) => k) : [];
    let summary = "off";
    if (types.length) {
      const end = addDays(today, s.horizonDays - 1);
      const [rooms, manual, booked, comp] = await Promise.all([
        client.query(`SELECT room_type,count(*)::int n,max(base_rate_cents) base FROM rooms WHERE owner_id=$1 AND active=1 AND room_type=ANY($2::text[]) GROUP BY room_type`, [owner, types]),
        client.query(`SELECT id,room_type,room_codes,weekdays,starts_on,ends_on,price_cents,active,updated_at FROM rate_rules WHERE owner_id=$1 AND active=1 AND source<>'auto' AND price_cents IS NOT NULL AND ends_on>=$2 AND starts_on<=$3`, [owner, today, end]),
        client.query(
          `SELECT d.day::date::text AS date, COALESCE(r.room_type,b.external_room_type) AS room_type, count(*)::int n FROM generate_series($2::date,$3::date,interval '1 day') d(day)
             JOIN bookings b ON b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text
             LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id GROUP BY 1,2`,
          [owner, today, end],
        ),
        s.compset.enabled ? client.query(`SELECT cr.stay_date,cr.rate_cents FROM competitor_rates cr JOIN competitors c ON c.id=cr.competitor_id AND c.owner_id=cr.owner_id AND c.active=1 WHERE cr.owner_id=$1 AND cr.stay_date>=$2 AND cr.stay_date<=$3 AND cr.sold_out=0 AND cr.rate_cents IS NOT NULL`, [owner, today, end]) : { rows: [] },
      ]);
      const occupied = new Map(booked.rows.map((x) => [`${x.room_type}|${x.date}`, Number(x.n)]));
      const compBy = new Map();
      for (const c of comp.rows) compBy.set(String(c.stay_date), [...(compBy.get(String(c.stay_date)) ?? []), Number(c.rate_cents)]);
      const days = [];
      for (const r of rooms.rows) {
        const type = String(r.room_type), total = Number(r.n);
        for (let i = 0; i < s.horizonDays; i++) {
          const date = addDays(today, i);
          // A manual one-night price for the type is the hotel's own decision for that night.
          if (manual.rows.some((m) => m.room_type === type && m.starts_on === date && m.ends_on === date && !codes(m.room_codes).length)) continue;
          const base = typeNightlyCents(manual.rows, date, type, Number(r.base) || 0);
          if (!base) continue;
          const occ = total ? Math.min(1, (occupied.get(`${type}|${date}`) ?? 0) / total) : 0;
          const p = autoPrice({ baseCents: base, occupancy: occ, leadDays: i, date, compMedianCents: median(compBy.get(date) ?? []), settings: s, type });
          days.push({ room_type: type, stay_date: date, base_cents: base, price_cents: p.cents, occupancy_pct: Math.round(occ * 100), reasons: p.reasons.join(" · ") });
        }
      }
      await client.query(`DELETE FROM auto_price_days WHERE owner_id=$1`, [owner]);
      if (days.length) await client.query(`INSERT INTO auto_price_days(owner_id,room_type,stay_date,base_cents,price_cents,occupancy_pct,reasons) SELECT $1,x.room_type,x.stay_date,x.base_cents,x.price_cents,x.occupancy_pct,x.reasons FROM jsonb_to_recordset($2::jsonb) AS x(room_type text,stay_date text,base_cents bigint,price_cents bigint,occupancy_pct bigint,reasons text)`, [owner, JSON.stringify(days)]);
      const changed = days.filter((d) => d.price_cents !== d.base_cents);
      if (s.mode === "auto") {
        const existing = new Map((await client.query(`SELECT id,room_type,starts_on,price_cents FROM rate_rules WHERE owner_id=$1 AND source='auto'`, [owner])).rows.map((x) => [`${x.room_type}|${x.starts_on}`, x]));
        const want = new Map(changed.map((d) => [`${d.room_type}|${d.stay_date}`, d]));
        const drop = [...existing].filter(([k]) => !want.has(k)).map(([, x]) => x.id);
        if (drop.length) await client.query(`DELETE FROM rate_rules WHERE owner_id=$1 AND id=ANY($2::bigint[])`, [owner, drop]);
        const update = [...want].filter(([k, d]) => existing.has(k) && Number(existing.get(k).price_cents) !== d.price_cents).map(([k, d]) => ({ id: existing.get(k).id, price: d.price_cents }));
        if (update.length) await client.query(`UPDATE rate_rules r SET price_cents=x.price,updated_at=$2 FROM jsonb_to_recordset($3::jsonb) AS x(id bigint,price bigint) WHERE r.owner_id=$1 AND r.id=x.id`, [owner, now, JSON.stringify(update)]);
        const insert = [...want].filter(([k]) => !existing.has(k)).map(([, d]) => d);
        if (insert.length) await client.query(`INSERT INTO rate_rules(owner_id,name,room_type,room_codes,weekdays,starts_on,ends_on,price_cents,active,updated_at,source) SELECT $1,'AUTO',x.room_type,'[]','[]',x.stay_date,x.stay_date,x.price_cents,1,$2,'auto' FROM jsonb_to_recordset($3::jsonb) AS x(room_type text,stay_date text,price_cents bigint)`, [owner, now, JSON.stringify(insert)]);
        summary = `auto: ${changed.length} night(s) priced, ${insert.length + update.length} changed, ${drop.length} back to the hotel price`;
      } else summary = `suggest: ${changed.length} night(s) with a suggested price`;
    } else await client.query(`DELETE FROM auto_price_days WHERE owner_id=$1`, [owner]);
    await client.query(`UPDATE auto_pricing_settings SET last_run_at=$2,last_summary=$3 WHERE owner_id=$1`, [owner, now, summary]);
    await client.query("COMMIT");
    if (summary !== "off") console.log(`Auto pricing: ${summary}`);
    return summary;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
