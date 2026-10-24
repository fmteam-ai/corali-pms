// Messages to the guest's TV: expiry and language rules (pure; unit tested).

export type TvMessageBody = { el?: string; en?: string };
/** Look of the card on the TV: everyday notice, birthday, anniversary or a general celebration. */
export type TvMessageTheme = "standard" | "birthday" | "anniversary" | "celebration";
export const tvMessageThemes: TvMessageTheme[] = ["standard", "birthday", "anniversary", "celebration"];
export const tvMessageTheme = (v: unknown): TvMessageTheme => (tvMessageThemes.includes(v as TvMessageTheme) ? (v as TvMessageTheme) : "standard");

/** {name} becomes the guest's first name on the TV (removed cleanly when the room has no guest). */
export function personalize(text: string, firstName: string | null): string {
  if (firstName) return text.replace(/\{name\}/g, firstName);
  const out = text
    .replace(/^\s*\{name\}\s*[,:]?\s*/, "") // "{name}, happy anniversary!"
    .replace(/[,\s]*\{name\}(?=\s*[!.?,;:]|\s*$)/g, "") // "Happy birthday, {name}!"
    .replace(/\s*\{name\}\s*/g, " ") // "Dear {name} and family"
    .replace(/\s{2,}/g, " ")
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Sound file played on the TV when a message appears (urgent wins over the theme). */
export const messageSound = (theme: TvMessageTheme, urgent: boolean) => `/sounds/tv-${urgent ? "urgent" : theme}.wav`;

export type TvMessageDuration = "1h" | "3h" | "tonight" | "checkout";
export const tvMessageDurations: TvMessageDuration[] = ["1h", "3h", "tonight", "checkout"];

/** Epoch ms of a wall-clock time in Athens (handles summer/winter time). */
export function athensTime(date: string, hhmm: string): number {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const shown = Date.parse(`${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}:00Z`);
  return guess - (shown - guess);
}

/**
 * When a room's message disappears: 1 or 3 hours, tonight (23:59), or the check-out time of the guest's current stay
 * (tonight when the room has no stay). Never later than 30 days.
 */
export function messageExpiry(duration: TvMessageDuration, now: number, today: string, stayCheckOut: string | null, checkOutTime: string): number {
  const tonight = athensTime(today, "23:59");
  const at = duration === "1h" ? now + 3_600_000
    : duration === "3h" ? now + 3 * 3_600_000
    : duration === "checkout" && stayCheckOut ? athensTime(stayCheckOut, /^\d\d:\d\d$/.test(checkOutTime) ? checkOutTime : "11:00")
    : tonight;
  return Math.min(Math.max(at, now + 60_000), now + 30 * 86_400_000);
}

/** Greek guests read the Greek text, everyone else the English one; a missing translation falls back to the other. */
export function messageText(body: TvMessageBody, lang: string): string {
  const el = body.el?.trim() ?? "", en = body.en?.trim() ?? "";
  return lang === "el" ? el || en : en || el;
}
