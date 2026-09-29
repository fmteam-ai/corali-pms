// Guest message schedule and eligibility rules shared by the worker and the PMS (pure; unit tested).
export const events = ["confirmation", "pre_arrival", "checkin", "welcome", "balance", "pre_departure", "review"];

/** Epoch ms for `hour`:00 Athens time, `offsetDays` from an ISO date (handles summer/winter time). */
export function greekTime(date, offsetDays, hour) {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const target = base.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", timeZoneName: "shortOffset" }).formatToParts(new Date(`${target}T12:00:00Z`));
  const offset = parts.find((p) => p.type === "timeZoneName")?.value.match(/GMT([+-])(\d{1,2})/) ?? [];
  const hours = (offset[1] === "-" ? -1 : 1) * Number(offset[2] ?? 2);
  return Date.parse(`${target}T00:00:00Z`) + (hour - hours) * 3600000;
}

const num = (value, fallback) => (value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) ? fallback : Number(value));

export function scheduleFor(event, booking, settings) {
  // Settings come straight from PostgreSQL BIGINT columns, which the worker's driver returns as strings.
  const sendHour = num(settings.send_hour, 10);
  switch (event) {
    case "confirmation": return Number(booking.created_at);
    // 72 hours before a 15:00 check-in by default.
    case "pre_arrival": return greekTime(booking.check_in, -num(settings.pre_arrival_days_before, 3), num(settings.pre_arrival_hour, 15));
    case "checkin": return greekTime(booking.check_in, -num(settings.checkin_days_before, 3), sendHour);
    case "welcome": return greekTime(booking.check_in, 0, num(settings.welcome_hour, 16));
    case "balance": return greekTime(booking.check_out, -num(settings.balance_days_before_checkout, 1), sendHour);
    case "pre_departure": return greekTime(booking.check_out, -1, num(settings.pre_departure_hour, 18));
    default: return greekTime(booking.check_out, num(settings.review_days_after_checkout, 2), sendHour);
  }
}

export const templateVariables = ["name", "reference", "checkIn", "checkOut", "amount", "link", "arrival"];

export function interpolate(text, values) {
  return text.replace(/{{(name|reference|checkIn|checkOut|amount|link|arrival)}}/g, (_, key) => values[key] ?? "");
}

export function athensToday(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function eligible(event, booking, now) {
  const today = athensToday(now);
  if (["cancelled", "no_show"].includes(booking.status)) return false;
  switch (event) {
    case "confirmation": return booking.status === "confirmed" || booking.status === "checked_in";
    case "pre_arrival": return booking.status === "confirmed" && booking.check_in >= today;
    case "checkin": return booking.status === "confirmed" && !booking.checkin_submitted && booking.check_in >= today;
    // Welcome goes out on arrival day to guests who are (or are about to be) in house.
    case "welcome": return (booking.status === "checked_in" || booking.status === "confirmed") && booking.check_in === today;
    case "balance": return ["confirmed", "checked_in"].includes(booking.status) && Number(booking.balance_cents) > 0 && booking.check_out >= today;
    case "pre_departure": return booking.status === "checked_in" && booking.check_out > today;
    default: return booking.status === "checked_out" && booking.check_out <= today;
  }
}

/** WhatsApp approved-template body parameters per event (the template must declare the same number, in this order). */
export function whatsappVariables(event, values) {
  switch (event) {
    case "confirmation": return [values.reference, values.checkIn, values.checkOut];
    case "balance": return [values.name, values.amount, values.link];
    case "pre_arrival": return [values.name, values.checkIn, values.link || "-"];
    case "welcome": return [values.name];
    case "pre_departure": return [values.name, values.checkOut];
    default: return [values.name, values.link];
  }
}

// Post-stay review shield: happy guests go to public review sites, unhappy ones to a private recovery form.
export const PUBLIC_REVIEW_MIN_RATING = 4;

export function reviewRoute(rating) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return null;
  return r >= PUBLIC_REVIEW_MIN_RATING ? "public" : "private";
}
