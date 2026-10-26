// Linen and towel changes during a stay (pure; unit tested). Day 0 is the arrival; a change is due every N nights
// after it (N = 0: only on request), never on the departure day (that room gets the departure clean).

export const hkServices = ["sheets", "towels"] as const;
export type HkService = (typeof hkServices)[number];
export type HkServiceSettings = { sheetsEvery: number; towelsEvery: number; reminderHour: number };
export const defaultHkServiceSettings: HkServiceSettings = { sheetsEvery: 3, towelsEvery: 2, reminderHour: 9 };

const dayMs = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
const every = (s: HkServiceSettings, service: HkService) => (service === "sheets" ? s.sheetsEvery : s.towelsEvery);

export function normalizeHkServiceSettings(raw: Partial<Record<keyof HkServiceSettings, unknown>> | null | undefined): HkServiceSettings {
  const n = (v: unknown, d: number, max: number) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) && x >= 0 && x <= max ? x : d; };
  return { sheetsEvery: n(raw?.sheetsEvery, 3, 14), towelsEvery: n(raw?.towelsEvery, 2, 14), reminderHour: n(raw?.reminderHour, 9, 23) };
}

/** Services due today for a stay (in the room tonight and last night, not arriving or leaving today). */
export function dueServices(checkIn: string, checkOut: string, today: string, s: HkServiceSettings): HkService[] {
  const night = days(checkIn, today);
  if (night <= 0 || today >= checkOut) return [];
  return hkServices.filter((x) => every(s, x) > 0 && night % every(s, x) === 0);
}

/** Next date a service is due during the stay, or null (none left before departure, or off). */
export function nextServiceDate(checkIn: string, checkOut: string, today: string, s: HkServiceSettings, service: HkService): string | null {
  const n = every(s, service);
  if (n <= 0) return null;
  const night = Math.max(0, days(checkIn, today));
  const next = (Math.floor(night / n) + 1) * n;
  const date = new Date(Date.parse(`${checkIn}T00:00:00Z`) + next * dayMs).toISOString().slice(0, 10);
  return date < checkOut ? date : null;
}
