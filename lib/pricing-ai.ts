// AI price recommendations: for the next weeks, per room category, Claude weighs the season (Paros, Cyclades), our
// availability and booking pace, last year's occupancy and the competitor rates from the rate shopper, and proposes a
// nightly price with its reasoning. Nothing changes on its own: the manager applies the chosen lines as season prices.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { ASSISTANT_MODEL } from "@/lib/guest-assistant";
import { anthropicApiKey } from "@/lib/provider-connections";
import { hotelToday } from "@/lib/tape-chart";
import { clampRecommendation, pricingPeriod, weeklyRows, type DayRow, type PeriodOptions, type PricingRecommendation, type WeekRow } from "@/lib/pricing-ai-core";
import { withWebSearch, type WebAnswer } from "@/lib/web-research";

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
export type PricingAnalysis = { summary: string; recommendations: PricingRecommendation[]; weeks: WeekRow[]; competitorNights: number; startsOn: string; endsOn: string; web: WebAnswer | null };
export type PricingOptions = PeriodOptions & { webSearch?: boolean };

/** Daily figures per room category between two dates (inclusive) plus the rate-shopper competitor rates per date. */
export async function loadDays(ownerId: string, from: string, until: string): Promise<{ days: DayRow[]; compByDate: Map<string, number[]>; competitorNights: number }> {
  const now = Date.now();
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
      [ownerId, from, until, now - 14 * 86_400_000],
    ),
    db().query(`SELECT cr.stay_date,cr.rate_cents FROM competitor_rates cr JOIN competitors c ON c.id=cr.competitor_id AND c.owner_id=cr.owner_id AND c.active=1 WHERE cr.owner_id=$1 AND cr.stay_date>=$2 AND cr.stay_date<=$3 AND cr.sold_out=0 AND cr.rate_cents IS NOT NULL`, [ownerId, from, until]),
  ]);
  const compByDate = new Map<string, number[]>();
  for (const r of comp.rows) compByDate.set(String(r.stay_date), [...(compByDate.get(String(r.stay_date)) ?? []), Number(r.rate_cents)]);
  const days = daily.rows.map((r) => ({ date: String(r.date), roomType: String(r.room_type), total: Number(r.total), occupied: Number(r.occupied), recent: Number(r.recent), lastYear: r.last_year === null ? null : Number(r.last_year), rateCents: Number(r.rate) || 0 }));
  return { days, compByDate, competitorNights: comp.rowCount ?? 0 };
}

const COMPETITOR_SET = "similar accommodation near Hotel Corali: small hotels, studios and apartments (2–3 star, family run) in Piso Livadi and nearby Logaras, Marpissa and Prodromos on Paros";

export const researchInstructions = `You research the market for Hotel Corali, a small family hotel in Piso Livadi, Paros (Cyclades, Greece). Use web search to find what ${COMPETITOR_SET} ask per night, for the dates asked.
- Look at Booking.com, Google Hotels, hotel websites and other listings that show prices. Prefer the exact dates; if prices for those dates aren't published yet (far ahead), use the same period of the current or last season as the reference and say so.
- Never invent numbers. Every price must come from a page you found; if you found little, say so plainly.
- Answer in Greek, compact: a list of properties (name, room type, dates, € per night, source), then a short summary of typical ranges per room size (double/studio, apartment/family, suite).`;

const instructions = `You are the revenue manager of Hotel Corali, a small family hotel in Piso Livadi, Paros (Cyclades, Greece), with direct bookings and OTAs.
Recommend a nightly price per room category for the weeks given, using:
- seasonality on Paros (peak July–August, shoulder June and September, low spring/autumn, Greek holidays such as Orthodox Easter, 15 August, Paros events) and the weekday mix;
- our availability: occupancy now, booking pace (rooms booked in the last 14 days for those nights) and last year's occupancy for the same weeks;
- competitor rates of similar properties in the area: the rate-shopper figures in the table and, when given, the market research from the web — stay competitive for our position, don't undercut needlessly;
- lead time: close-in weeks with low occupancy may need a lower price; weeks filling fast or near sell-out can take more; far-ahead weeks rely more on season and competitors than on our own occupancy.
Rules: whole euros; never move more than 35% from the current price; group adjacent weeks with the same advice; skip weeks where the current price is right (no recommendation needed); when data is thin, say so and use low confidence. Write summary and reasoning in Greek; mention competitor prices you relied on.`;

function logError(scope: string, error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) console.error(`${scope}: invalid Anthropic API key`);
  else if (error instanceof Anthropic.RateLimitError) console.error(`${scope}: rate limited`);
  else if (error instanceof Anthropic.APIError) console.error(`${scope}: API error ${error.status}`, error.message);
  else console.error(`${scope} failed`, error);
}

/** Ask Claude for price recommendations for a period. null when no API key is set or the AI is unavailable. */
export async function analysePricing(ownerId: string, options: PricingOptions = {}): Promise<PricingAnalysis | null> {
  const apiKey = await anthropicApiKey(ownerId);
  if (!apiKey) return null;
  const today = hotelToday();
  const { startsOn, weeks: count, endsOn } = pricingPeriod(today, options);
  const { days, compByDate, competitorNights } = await loadDays(ownerId, startsOn, endsOn);
  const weeks = weeklyRows(startsOn, days, compByDate, count);
  if (!weeks.length) return { summary: "", recommendations: [], weeks, competitorNights, startsOn, endsOn, web: null };
  const types = [...new Set(weeks.map((w) => `${w.roomType} (${w.rooms} rooms, now ~€${w.rateEur})`))].join(", ");
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 150_000 });
  // Step 1 (optional): market research on the web. A failure here doesn't stop the analysis.
  let web: WebAnswer | null = null;
  if (options.webSearch) {
    try {
      web = await withWebSearch(client, {
        model: ASSISTANT_MODEL, max_tokens: 8000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low" },
        system: researchInstructions,
        messages: [{ role: "user", content: `Today is ${today}. Dates: ${startsOn} to ${endsOn}. Our room categories: ${types}.` }],
      }, 8);
    } catch (error) { logError("Pricing research", error); }
  }
  const table = ["room_type | week | rooms | current €/night | occupancy % | last year % | booked last 14 days | rate shopper median/min/max €", ...weeks.map((w) => `${w.roomType} | ${w.startsOn}→${w.endsOn} | ${w.rooms} | ${w.rateEur} | ${w.occupancy} | ${w.lastYearOccupancy ?? "-"} | ${w.recentBookings} | ${w.compMedianEur === null ? "no data" : `${w.compMedianEur}/${w.compMinEur}/${w.compMaxEur}`}`)].join("\n");
  try {
    const response = await client.beta.messages.parse({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(Analysis) },
      system: instructions,
      messages: [{ role: "user", content: `Today is ${today}. Period ${startsOn} → ${endsOn}. Rate-shopper competitor nights with data: ${competitorNights}.\n\n${table}${web?.text ? `\n\nMARKET RESEARCH FROM THE WEB (indicative asking prices)\n${web.text}` : ""}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const recommendations = response.parsed_output.recommendations.map((r) => clampRecommendation(r, weeks)).filter((r): r is PricingRecommendation => r !== null);
    return { summary: response.parsed_output.summary, recommendations, weeks, competitorNights, startsOn, endsOn, web };
  } catch (error) {
    logError("Pricing AI", error);
    return null;
  }
}
