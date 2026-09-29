// Display rules for the interactive room plan (tape chart). Pure functions so they can be unit tested.

export type TapeStatus = "confirmed" | "check_in_due" | "checked_in" | "checked_out" | "cancelled" | "tentative";
export type HousekeepingState = "clean" | "dirty" | "cleaning" | "inspection_pending" | "out_of_order";

export const tapeStatusColors: Record<TapeStatus, string> = {
  confirmed: "#2196F3",
  check_in_due: "#FF9800",
  checked_in: "#4CAF50",
  checked_out: "#9E9E9E",
  cancelled: "#F44336",
  tentative: "#9C27B0",
};

export const housekeepingIcons: Record<HousekeepingState, string> = {
  clean: "🟢",
  dirty: "🔴",
  cleaning: "🟡",
  inspection_pending: "🔵",
  out_of_order: "⚫",
};

export const housekeepingColors: Record<HousekeepingState, string> = {
  clean: "#2e7d32",
  dirty: "#d32f2f",
  cleaning: "#f9a825",
  inspection_pending: "#1565c0",
  out_of_order: "#212121",
};

/** Hotel-local calendar date (Europe/Athens) as YYYY-MM-DD. */
export function hotelToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** Colour category of a reservation on the chart. A confirmed stay whose arrival is today or overdue is "check-in due". */
export function tapeStatus(status: string, checkIn: string, today: string): TapeStatus {
  if (status === "checked_in") return "checked_in";
  if (status === "checked_out") return "checked_out";
  if (status === "cancelled" || status === "no_show") return "cancelled";
  if (status === "tentative" || status === "payment_pending") return "tentative";
  return checkIn <= today ? "check_in_due" : "confirmed";
}

export function hasUnpaidBalance(status: string, balanceCents: number): boolean {
  return balanceCents > 0 && status !== "cancelled" && status !== "no_show";
}

/**
 * Housekeeping overlay state of a room. Out of order wins; otherwise the latest open task decides,
 * falling back to the room's operational status.
 */
export function housekeepingState(operationalStatus: string, openTaskStatus: string | null): HousekeepingState {
  if (operationalStatus === "out_of_order" || openTaskStatus === "out_of_order") return "out_of_order";
  if (openTaskStatus === "in_progress") return "cleaning";
  if (openTaskStatus === "cleaned") return "inspection_pending";
  if (openTaskStatus === "todo" || operationalStatus === "dirty") return "dirty";
  return "clean";
}

/** Visible part of a stay within [start, start+days): column offset and number of night columns, or null if not visible. */
export function barSpan(checkIn: string, checkOut: string, start: string, days: number): { offset: number; length: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const first = Math.max(0, nightsBetween(start, checkIn));
  const last = Math.min(days, nightsBetween(start, checkOut));
  if (last <= first) return null;
  return { offset: first, length: last - first, clippedStart: checkIn < start, clippedEnd: nightsBetween(start, checkOut) > days };
}

/** Room ids held by an unpaid online checkout; tolerates legacy/malformed JSON. */
export function heldRoomIds(roomAllocations: unknown): number[] {
  let value = roomAllocations;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "object" && item !== null ? Number((item as { roomId?: unknown; id?: unknown }).roomId ?? (item as { id?: unknown }).id) : Number(item))).filter((id) => Number.isSafeInteger(id) && id > 0);
}
