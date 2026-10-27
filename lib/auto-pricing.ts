// PMS side of automatic pricing: settings, the computed nights (for the preview) and "Run now".
import { normalizeAutoPricing, type AutoPricingSettings } from "../scripts/auto-pricing-core.mjs";
import { runAutoPricing } from "../scripts/auto-pricing-worker.mjs";
import { db } from "@/lib/db";

export type AutoPriceDay = { roomType: string; date: string; baseCents: number; priceCents: number; occupancy: number; reasons: string };
export type AutoPricingStatus = { settings: AutoPricingSettings; roomTypes: { roomType: string; rooms: number; baseCents: number }[]; days: AutoPriceDay[]; lastRunAt: number | null; lastSummary: string | null; appliedNights: number };

export async function autoPricingStatus(ownerId: string): Promise<AutoPricingStatus> {
  const [s, types, days, applied] = await Promise.all([
    db().query(`SELECT settings_json,last_run_at,last_summary FROM auto_pricing_settings WHERE owner_id=$1`, [ownerId]),
    db().query(`SELECT room_type,count(*)::int n,max(base_rate_cents) base FROM rooms WHERE owner_id=$1 AND active=1 GROUP BY room_type ORDER BY room_type`, [ownerId]),
    db().query(`SELECT room_type,stay_date,base_cents,price_cents,occupancy_pct,reasons FROM auto_price_days WHERE owner_id=$1 ORDER BY stay_date,room_type`, [ownerId]),
    db().query(`SELECT count(*)::int n FROM rate_rules WHERE owner_id=$1 AND source='auto'`, [ownerId]),
  ]);
  let raw: unknown = null;
  try { raw = s.rows[0] ? JSON.parse(String(s.rows[0].settings_json)) : null; } catch { raw = null; }
  return {
    settings: normalizeAutoPricing(raw),
    roomTypes: types.rows.map((t) => ({ roomType: String(t.room_type), rooms: Number(t.n), baseCents: Number(t.base) || 0 })),
    days: days.rows.map((d) => ({ roomType: String(d.room_type), date: String(d.stay_date), baseCents: Number(d.base_cents), priceCents: Number(d.price_cents), occupancy: Number(d.occupancy_pct), reasons: String(d.reasons) })),
    lastRunAt: s.rows[0]?.last_run_at ? Number(s.rows[0].last_run_at) : null,
    lastSummary: s.rows[0]?.last_summary ? String(s.rows[0].last_summary) : null,
    appliedNights: Number(applied.rows[0].n),
  };
}

/** Save and recompute at once (so the preview and, in "auto" mode, the prices follow the new settings). */
export async function saveAutoPricing(ownerId: string, raw: unknown): Promise<void> {
  const s = normalizeAutoPricing(raw);
  await db().query(`INSERT INTO auto_pricing_settings(owner_id,settings_json,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_at=$3`, [ownerId, JSON.stringify(s), Date.now()]);
  await runAutoPricing({ pool: db(), owner: ownerId, force: true });
}

export async function runAutoPricingNow(ownerId: string): Promise<string | null> {
  return runAutoPricing({ pool: db(), owner: ownerId, force: true });
}
