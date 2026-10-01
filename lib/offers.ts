// Special prices and promotions (VikBooking-style "special prices"): which offers apply to a stay and a night,
// and the nightly price after them (pure, unit tested).

export type Offer = {
  name?: string | null;
  starts_on: string;
  ends_on: string;
  adjustment_type: string; // "percentage" | "fixed" (cents per night)
  adjustment_value: number | string;
  operation: string; // "discount" | "charge"
  weekdays?: unknown;
  room_codes?: unknown;
  rate_plan_keys?: unknown;
  minimum_stay?: number | string | null;
  promotion?: number | string | null;
  promotion_text_json?: unknown;
  last_minute_days?: number | string | null; // promotion valid only for arrivals within N days of the booking date
  min_advance_days?: number | string | null; // early booking: arrival at least N days after the booking date
  checkin_in_season?: number | string | null; // 1 = the arrival date itself must fall within the offer period
  round_integer?: number | string | null; // 1 = the discounted night is rounded to whole euros
  nights_overrides_json?: unknown; // [{nights, value}]: a different value for longer stays
};

export type NightOverride = { nights: number; value: number };

function list<T>(value: unknown): T[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
const num = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** Days from the booking date to the arrival date (0 = arriving today). */
export function daysBeforeArrival(today: string, checkIn: string): number {
  return dayNumber(checkIn) - dayNumber(today);
}

/** Valid, sorted value overrides for longer stays. */
export function nightOverrides(value: unknown): NightOverride[] {
  return list<NightOverride>(value)
    .map((o) => ({ nights: Math.trunc(Number(o?.nights)), value: Number(o?.value) }))
    .filter((o) => o.nights >= 1 && o.nights <= 365 && Number.isFinite(o.value) && o.value >= 0)
    .sort((a, b) => a.nights - b.nights)
    .slice(0, 10);
}

/** The adjustment for a stay of this length: the override with the most nights not exceeding it, else the base value. */
export function offerValue(offer: Pick<Offer, "adjustment_value" | "nights_overrides_json">, nights: number): number {
  const match = nightOverrides(offer.nights_overrides_json).filter((o) => o.nights <= nights).at(-1);
  return Math.abs(match ? match.value : Number(offer.adjustment_value) || 0);
}

/** Stay-level conditions: minimum nights, last-minute window, early-booking window and arrival within the period. */
export function offerFitsStay(offer: Offer, stay: { checkIn: string; nights: number; today: string }): boolean {
  if ((num(offer.minimum_stay) ?? 1) > stay.nights) return false;
  const before = daysBeforeArrival(stay.today, stay.checkIn);
  const lastMinute = num(offer.last_minute_days);
  if (lastMinute !== null && lastMinute > 0 && before > lastMinute) return false;
  const advance = num(offer.min_advance_days);
  if (advance !== null && advance > 0 && before < advance) return false;
  if (Number(offer.checkin_in_season) === 1 && (stay.checkIn < offer.starts_on || stay.checkIn > offer.ends_on)) return false;
  return true;
}

/** Night-level conditions: period, weekday, room and rate plan. */
export function offerCoversNight(offer: Offer, night: { date: string; roomCode: string; planKey: string }): boolean {
  if (night.date < offer.starts_on || night.date > offer.ends_on) return false;
  const rooms = list<string>(offer.room_codes), plans = list<string>(offer.rate_plan_keys), days = list<number>(offer.weekdays).map(Number);
  if (rooms.length && !rooms.map(String).includes(night.roomCode)) return false;
  if (plans.length && !plans.includes(night.planKey)) return false;
  if (days.length && !days.includes(new Date(`${night.date}T00:00:00Z`).getUTCDay())) return false;
  return true;
}

/** Nightly price after one offer. */
export function applyOffer(nightlyCents: number, offer: Offer, nights: number): number {
  const value = offerValue(offer, nights);
  const delta = offer.adjustment_type === "fixed" ? Math.trunc(value) : Math.round((nightlyCents * value) / 100);
  let price = offer.operation === "discount" ? Math.max(0, nightlyCents - delta) : nightlyCents + delta;
  if (Number(offer.round_integer) === 1) price = Math.round(price / 100) * 100;
  return price;
}

/** Whether the offer is a promotion guests should see (a discount marked as promotion). */
export function isPromotion(offer: Offer): boolean {
  return Number(offer.promotion) === 1 && offer.operation === "discount";
}

/** Promotion text in the guest's language, falling back to English, Greek, then the offer name. */
export function promotionText(offer: Offer, lang: string): string {
  let texts: Record<string, unknown> = {};
  try {
    const parsed = typeof offer.promotion_text_json === "string" ? JSON.parse(offer.promotion_text_json || "{}") : offer.promotion_text_json;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) texts = parsed as Record<string, unknown>;
  } catch { texts = {}; }
  for (const key of [lang, "en", "el"]) if (typeof texts[key] === "string" && String(texts[key]).trim()) return String(texts[key]).trim();
  return "";
}

/** Offer status on a given day, for the PMS list. */
export function offerStatus(offer: { starts_on: string; ends_on: string; active: number | string }, today: string): "inactive" | "upcoming" | "running" | "ended" {
  if (Number(offer.active) !== 1) return "inactive";
  if (today < offer.starts_on) return "upcoming";
  if (today > offer.ends_on) return "ended";
  return "running";
}
