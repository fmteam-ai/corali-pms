// Staff AI assistant on the PMS dashboard. Answers from a read-only snapshot of today's operations (money only for
// users allowed to see it); it cannot change anything. Claude when an Anthropic key is configured, otherwise the
// built-in answers in lib/pms-assistant-core.
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { builtInAnswer, snapshotText, type PmsSnapshot, type StayRow } from "@/lib/pms-assistant-core";
import { monthlyRows } from "@/lib/pricing-ai-core";
import { loadDays } from "@/lib/pricing-ai";
import { anthropicApiKey } from "@/lib/provider-connections";
import { apiErrorText, responseText, withWebSearch } from "@/lib/web-research";
import { hotelToday } from "@/lib/tape-chart";

export const PMS_ASSISTANT_MODEL = "claude-opus-5-5";
export type StaffTurn = { role: "user" | "assistant"; content: string };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function loadSnapshot(ownerId: string, financial: boolean): Promise<PmsSnapshot> {
  const today = hotelToday(), tomorrow = addDays(today, 1);
  const cols = `b.reference,b.guest_name,r.code AS room_code,b.check_in,b.check_out,b.status,b.adults,b.children${financial ? ",b.balance_cents" : ""}`;
  const stays = (col: "check_in" | "check_out", day: string) => db().query(`SELECT ${cols} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.${col}=$2 AND b.status NOT IN ('cancelled','no_show') ORDER BY r.code,b.guest_name LIMIT 40`, [ownerId, day]);
  const [rooms, aT, aM, dT, dM, inHouse, occ, latest, bal, msgs, hk] = await Promise.all([
    db().query(`SELECT count(*)::int AS n FROM rooms WHERE owner_id=$1 AND active=1`, [ownerId]),
    stays("check_in", today), stays("check_in", tomorrow), stays("check_out", today), stays("check_out", tomorrow),
    db().query(`SELECT count(*)::int AS n FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in') AND check_in<=$2 AND check_out>$2`, [ownerId, today]),
    db().query(`SELECT d::date::text AS date,(SELECT count(DISTINCT room_id)::int FROM bookings b WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in<=d::date::text AND b.check_out>d::date::text) AS occupied FROM generate_series($2::date,$2::date+13,interval '1 day') d`, [ownerId, today]),
    db().query(`SELECT ${cols},b.channel,b.created_at FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 ORDER BY b.created_at DESC,b.id DESC LIMIT 8`, [ownerId]),
    financial ? db().query(`SELECT ${cols} FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.balance_cents>0 ORDER BY b.check_in LIMIT 200`, [ownerId]) : Promise.resolve({ rows: [] }),
    db().query(`SELECT b.reference,b.guest_name,m.body,m.created_at FROM booking_messages m JOIN bookings b ON b.id=m.booking_id AND b.owner_id=m.owner_id WHERE m.owner_id=$1 AND m.sender='guest' AND m.read_at IS NULL ORDER BY m.created_at DESC LIMIT 10`, [ownerId]),
    db().query(`SELECT count(*) FILTER (WHERE status='todo')::int todo,count(*) FILTER (WHERE status='in_progress')::int in_progress,(SELECT count(*)::int FROM rooms WHERE owner_id=$1 AND operational_status='out_of_order') ooo,(SELECT count(*)::int FROM maintenance_notices WHERE owner_id=$1 AND status='open') defects FROM housekeeping_tasks WHERE owner_id=$1`, [ownerId]),
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  const stayRows = (rows: Record<string, unknown>[]) => rows as unknown as StayRow[];
  return {
    today, totalRooms: num(rooms.rows[0]?.n), financial, inHouse: num(inHouse.rows[0]?.n),
    arrivalsToday: stayRows(aT.rows), arrivalsTomorrow: stayRows(aM.rows), departuresToday: stayRows(dT.rows), departuresTomorrow: stayRows(dM.rows),
    occupancy: occ.rows.map((o) => ({ date: String(o.date), occupied: num(o.occupied) })),
    latest: latest.rows as PmsSnapshot["latest"],
    balances: financial ? { count: bal.rows.length, totalCents: bal.rows.reduce((s, b) => s + num(b.balance_cents), 0), top: stayRows(bal.rows.slice(0, 8)) } : null,
    messages: msgs.rows.map((m) => ({ reference: String(m.reference), guest_name: String(m.guest_name), body: String(m.body), created_at: num(m.created_at) })),
    housekeeping: { todo: num(hk.rows[0]?.todo), inProgress: num(hk.rows[0]?.in_progress), ooo: num(hk.rows[0]?.ooo), openDefects: num(hk.rows[0]?.defects) },
  };
}

const RULES = `You are the AI assistant inside the PMS (property management system) of Hotel Corali, a small family hotel in Piso Livadi, Paros, Greece. You help the owner and the front desk.
- Answer in the language the staff member writes in (usually Greek or English). Be concise and practical; short lists are fine. Formatting: plain text with **bold** and "- " lists only (no tables).
- Use only the data snapshot below; it is live data for today. If something isn't in it, say so and suggest where in the PMS to look (Reservations, Room plan, Reports, Payments, Housekeeping).
- You cannot change bookings, prices or any data; tell staff which PMS screen does it.
- Pricing questions: use the PRICES & OCCUPANCY BY MONTH data (our current nightly rates per room category, occupancy on the books, last year's occupancy, rate-shopper competitor medians). For what other properties charge (e.g. similar hotels, studios and apartments in Piso Livadi, Logaras, Marpissa on Paros) use web search: Booking.com, Google Hotels, hotel websites. Give concrete € per night with the property names and where you found them; never invent prices; if dates that far ahead aren't published yet, use the same period of the current/last season as reference and say so. You may then propose prices per room category with short reasons, and point to Τιμές → Προτάσεις τιμολόγησης → «Πρόταση τιμών με AI» to apply them, or Τιμές → Τιμές περιόδου.
- Don't search the web for anything about guests or bookings; web search is only for market, area and general information.
- When asked, draft messages or emails to guests (warm, professional, in the guest's language); staff send them themselves.
- Don't reveal amounts the snapshot marks as not visible to this user.`;

/** Our rates, occupancy and competitor medians per month and room category, for ~15 months (pricing questions). */
async function pricingContext(ownerId: string, today: string): Promise<string> {
  const from = `${today.slice(0, 7)}-01`;
  const until = addDays(`${String(Number(from.slice(0, 4)) + 1)}-${from.slice(5, 7)}-01`, 92);
  const { days, compByDate } = await loadDays(ownerId, from, until);
  const rows = monthlyRows(days, compByDate);
  return `PRICES & OCCUPANCY BY MONTH (room category: our average nightly rate now set | occupancy on the books | same month last year | rate-shopper competitor median)\n${rows.map((r) => `${r.month} ${r.roomType}: €${r.rateEur} | ${r.occupancy}% | ${r.lastYearOccupancy ?? "-"}% | ${r.compMedianEur === null ? "no rate-shopper data" : `€${r.compMedianEur} (${r.compNights} nights)`}`).join("\n") || "- no rooms"}`;
}

export async function staffAssistantReply(ownerId: string, financial: boolean, lang: "el" | "en", turns: StaffTurn[], pricing = true): Promise<{ reply: string; source: "ai" | "builtin" }> {
  const snapshot = await loadSnapshot(ownerId, financial);
  const question = turns.filter((t) => t.role === "user").at(-1)?.content ?? "";
  const builtin = () => ({ reply: builtInAnswer(question, snapshot, lang), source: "builtin" as const });
  const apiKey = await anthropicApiKey(ownerId);
  if (!apiKey) return builtin();
  // A key is set but Claude didn't answer: say so instead of the "no AI key" help text.
  const failed = (reason = "") => {
    const note = (lang === "el" ? "⚠️ Ο AI δεν απάντησε αυτή τη στιγμή (ελέγξτε το κλειδί και το υπόλοιπο λογαριασμού Anthropic ή δοκιμάστε ξανά σε λίγο)." : "⚠️ The AI did not answer right now (check the Anthropic key and account credit, or try again shortly).") + (reason ? `\n${lang === "el" ? "Μήνυμα Anthropic" : "Anthropic says"}: ${reason}` : "");
    const basic = builtInAnswer(question, snapshot, lang);
    return { reply: basic === builtInAnswer("", snapshot, lang) ? note : `${note}\n\n${basic}`, source: "builtin" as const };
  };
  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
    const prices = pricing ? await pricingContext(ownerId, snapshot.today).catch((e) => { console.error("PMS assistant pricing data failed", e); return ""; }) : "";
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: PMS_ASSISTANT_MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [
        { type: "text", text: RULES, cache_control: { type: "ephemeral" } },
        { type: "text", text: `DATA SNAPSHOT\n${snapshotText(snapshot)}${prices ? `\n\n${prices}` : ""}` },
      ],
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
    };
    let answer: Awaited<ReturnType<typeof withWebSearch>> = null;
    try {
      answer = await withWebSearch(client, params, 5);
    } catch (error) {
      // Web search unavailable (not enabled, unsupported, …): answer without it and say why.
      const reason = apiErrorText(error);
      console.error("PMS assistant web search failed:", reason);
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.RateLimitError) throw error;
      const plain = await client.beta.messages.create(params);
      if (plain.stop_reason === "refusal") return failed();
      const text = responseText(plain);
      return text ? { reply: `${lang === "el" ? "ℹ️ Χωρίς αναζήτηση στο διαδίκτυο" : "ℹ️ Without web search"}: ${reason}\n\n${text}`, source: "ai" } : failed(reason);
    }
    if (!answer) return failed();
    const sources = answer.sources.length ? `\n\n${lang === "el" ? "Πηγές" : "Sources"}:\n${answer.sources.slice(0, 6).map((x) => `• ${x.title || x.url} – ${x.url}`).join("\n")}` : "";
    const text = answer.text ? answer.text + sources : "";
    return text ? { reply: text, source: "ai" } : failed();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error("PMS assistant: invalid Anthropic API key");
    else if (error instanceof Anthropic.RateLimitError) console.error("PMS assistant: rate limited by the API");
    else if (error instanceof Anthropic.APIError) console.error(`PMS assistant: API error ${error.status}`, error.message);
    else console.error("PMS assistant failed", error);
    return failed(apiErrorText(error));
  }
}
