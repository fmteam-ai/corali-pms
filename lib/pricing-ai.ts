// AI price recommendations: for the next weeks, per room category, Claude weighs the season (Paros, Cyclades), our
// availability and booking pace, last year's occupancy and the competitor rates from the rate shopper, and proposes a
// nightly price with its reasoning. Nothing changes on its own: the manager applies the chosen lines as season prices.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { ASSISTANT_MODEL } from "@/lib/guest-assistant";
import { anthropicApiKey } from "@/lib/provider-connections";
import { addDays, hotelToday } from "@/lib/tape-chart";
import { clampRecommendation, PRICING_HORIZON_DAYS, weeklyRows, type PricingRecommendation, type WeekRow } from "@/lib/pricing-ai-core";

export type { PricingRecommendation, WeekRow };

const Recommendation = z.object({
  room_type: z.string(),
  starts_on: z.string().describe("YYYY-MM-DD, first night"),
  ends_on: z.string().describe("YYYY-MM-DD, last night (inclusive)"),
  recommended_rate_eur: z.number().describe("Recommended price per night in euros, whole euros"),
  confidence: z.enum(["low", "medium", "high"]),
  reasoning: z.string().describe("One or two sentences in Greek explaining why, citing the data"),
});
const Analysis = z.object({
  summary: z.string().describe("Three to five sentences in Greek: the overall picture and the main advice"),
  recommendations: z.array(Recommendation),
});
export type PricingAnalysis = { summary: string; recommendations: PricingRecommendation[]; weeks: WeekRow[]; competitorNights: number };

async function loadWeeks(ownerId: string) {
  const today = hotelToday(), until = addDays(today, PRICING_HORIZON_DAYS - 1), now = Date.now();
  const [daily, comp] = await Promise.all([
    db().query(
      `SELECT d.day::date::text AS date, r.room_type,
              count(DISTINCT r.id)::int AS total,
              count(DISTINCT b.room_id)::int AS occupied,
              count(DISTINCT b.room_id) FILTER (WHERE b.created_at >= $4)::int AS recent,
              (SELECT count(DISTINCT ly.room_id)::int FROM bookings ly JOIN rooms r2 ON r2.id=ly.room_id AND r2.owner_id=ly.owner_id
                WHERE ly.owner_id=$1 AND r2.room_type=r.room_type AND ly.status NOT IN ('cancelled','no_show')
                  AND ly.check_in<=(d.day - interval '364 days')::date::text AND ly.check_out>(d.day - interval '364 days')::date::text) AS last_year,
              min(COALESCE((SELECT rr.price_cents FROM rate_rules rr WHERE rr.owner_id=r.owner_id AND rr.active=1 AND (rr.room_type IS NULL OR rr.room_type='' OR rr.room_type=r.room_type) AND rr.starts_on<=d.day::date::text AND rr.ends_on>=d.day::date::text AND rr.price_cents IS NOT NULL ORDER BY rr.id DESC LIMIT 1), NULLIF(r.base_rate_cents,0)))::bigint AS rate
         FROM generate_series($2::date,$3::date,interval '1 day') AS d(day)
         JOIN rooms r ON r.owner_id=$1 AND r.active=1 AND r.operational_status<>'out_of_order'
         LEFT JOIN bookings b ON b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in')
              AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text
        GROUP BY d.day, r.room_type`,
      [ownerId, today, until, now - 14 * 86_400_000],
    ),
    db().query(`SELECT cr.stay_date,cr.rate_cents FROM competitor_rates cr JOIN competitors c ON c.id=cr.competitor_id AND c.owner_id=cr.owner_id AND c.active=1 WHERE cr.owner_id=$1 AND cr.stay_date>=$2 AND cr.stay_date<=$3 AND cr.sold_out=0 AND cr.rate_cents IS NOT NULL`, [ownerId, today, until]),
  ]);
  const compByDate = new Map<string, number[]>();
  for (const r of comp.rows) compByDate.set(String(r.stay_date), [...(compByDate.get(String(r.stay_date)) ?? []), Number(r.rate_cents)]);
  const days = daily.rows.map((r) => ({ date: String(r.date), roomType: String(r.room_type), total: Number(r.total), occupied: Number(r.occupied), recent: Number(r.recent), lastYear: r.last_year === null ? null : Number(r.last_year), rateCents: Number(r.rate) || 0 }));
  return { today, weeks: weeklyRows(today, days, compByDate), competitorNights: comp.rowCount ?? 0 };
}

const instructions = `You are the revenue manager of Hotel Corali, a small family hotel in Piso Livadi, Paros (Cyclades, Greece), with direct bookings and OTAs.
Recommend a nightly price per room category for the coming weeks, using:
- seasonality on Paros (peak July–August, shoulder June and September, low spring/autumn, Greek holidays such as Orthodox Easter, 15 August, Paros events) and the weekday mix;
- our availability: occupancy now, booking pace (rooms booked in the last 14 days for those nights) and last year's occupancy for the same weeks;
- competitor rates from similar properties in the area when available (median, min, max per night) — stay competitive for our position, don't undercut needlessly;
- lead time: close-in weeks with low occupancy may need a lower price; weeks filling fast or near sell-out can take more.
Rules: whole euros; never move more than 35% from the current price; group adjacent weeks with the same advice; skip weeks where the current price is right (no recommendation needed); when data is thin, say so and use low confidence. Write summary and reasoning in Greek.`;

/** Ask Claude for price recommendations. null when no API key is set or the AI is unavailable. */
export async function analysePricing(ownerId: string): Promise<PricingAnalysis | null> {
  const apiKey = await anthropicApiKey(ownerId);
  if (!apiKey) return null;
  const { today, weeks, competitorNights } = await loadWeeks(ownerId);
  if (!weeks.length) return { summary: "", recommendations: [], weeks, competitorNights };
  const table = ["room_type | week | rooms | current €/night | occupancy % | last year % | booked last 14 days | competitors median/min/max €", ...weeks.map((w) => `${w.roomType} | ${w.startsOn}→${w.endsOn} | ${w.rooms} | ${w.rateEur} | ${w.occupancy} | ${w.lastYearOccupancy ?? "-"} | ${w.recentBookings} | ${w.compMedianEur === null ? "no data" : `${w.compMedianEur}/${w.compMinEur}/${w.compMaxEur}`}`)].join("\n");
  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
    const response = await client.beta.messages.parse({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(Analysis) },
      system: instructions,
      messages: [{ role: "user", content: `Today is ${today}. Competitor nights with data: ${competitorNights}.\n\n${table}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const recommendations = response.parsed_output.recommendations.map((r) => clampRecommendation(r, weeks)).filter((r): r is PricingRecommendation => r !== null);
    return { summary: response.parsed_output.summary, recommendations, weeks, competitorNights };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error("Pricing AI: invalid Anthropic API key");
    else if (error instanceof Anthropic.RateLimitError) console.error("Pricing AI: rate limited");
    else if (error instanceof Anthropic.APIError) console.error(`Pricing AI: API error ${error.status}`, error.message);
    else console.error("Pricing AI failed", error);
    return null;
  }
}
