// Corali Staff app (pure; unit tested): specialties and the app sections they open, shifts, alert kinds.

/** App sections beyond Messages and Shifts (which everyone has). The role's permissions still decide what can be done. */
export const staffModules = ["housekeeping", "reception", "maintenance"] as const;
export type StaffModule = (typeof staffModules)[number];

/** Front desk (owner, manager, reception) answers the staff messages and gets the desk alerts. */
export const isDesk = (role: string) => role === "owner" || role === "admin" || role === "reception";

/** Sections a role brings on its own; specialties add more. */
export function roleModules(role: string): StaffModule[] {
  if (role === "housekeeping") return ["housekeeping"];
  if (isDesk(role)) return ["reception", "housekeeping", "maintenance"];
  return [];
}

export function normalizeModules(raw: unknown): StaffModule[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return []; } })() : [];
  return staffModules.filter((m) => Array.isArray(list) && list.includes(m));
}

export function userModules(role: string, specialties: unknown[]): StaffModule[] {
  const set = new Set<StaffModule>(roleModules(role));
  for (const s of specialties) for (const m of normalizeModules(s)) set.add(m);
  return staffModules.filter((m) => set.has(m));
}

// Alerts on the phone. Desk kinds mirror the PMS notifications; staff kinds are sent to the people concerned.
export const deskAlertKinds = ["tv_request", "hk_message", "housekeeping", "direct_booking", "manual_booking", "ota_change", "guest_message", "payment"] as const;
export const staffAlertKinds = ["message", "checkout", "assignment", "shift", "maintenance"] as const;
export type AlertKind = (typeof deskAlertKinds)[number] | (typeof staffAlertKinds)[number];
export const allAlertKinds: readonly AlertKind[] = [...staffAlertKinds, ...deskAlertKinds];

export function defaultAlertKinds(role: string, modules: StaffModule[]): AlertKind[] {
  const out: AlertKind[] = ["message", "shift"];
  if (modules.includes("housekeeping")) out.push("checkout", "assignment");
  if (modules.includes("maintenance") && !isDesk(role)) out.push("maintenance");
  if (isDesk(role)) out.push("tv_request", "hk_message", "housekeeping", "direct_booking", "ota_change", "guest_message");
  return out;
}

export function normalizeAlertKinds(raw: unknown): AlertKind[] {
  return Array.isArray(raw) ? allAlertKinds.filter((k) => raw.includes(k)) : [];
}

// Shifts: "HH:MM" in hotel time; an end before the start runs past midnight.
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (v: unknown): v is string => typeof v === "string" && hhmm.test(v);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Length in minutes (overnight shifts wrap; equal times are not a shift). */
export function shiftMinutes(start: string, end: string): number {
  const d = minutes(end) - minutes(start);
  return d > 0 ? d : d < 0 ? d + 1440 : 0;
}

/** Two shifts of one person on the same day overlap (overnight ends count until midnight for that day). */
export function shiftsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  const span = (x: { start: string; end: string }) => [minutes(x.start), minutes(x.start) + shiftMinutes(x.start, x.end)];
  const [a1, a2] = span(a), [b1, b2] = span(b);
  return a1 < b2 && b1 < a2;
}

const dayMs = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDaysIso = (date: string, n: number) => iso(Date.parse(`${date}T00:00:00Z`) + n * dayMs);

/** Monday of the week of a date (weeks run Monday–Sunday). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return addDaysIso(date, -((d.getUTCDay() + 6) % 7));
}

export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));

export const hexColor = (v: unknown, fallback = "#2a7d8f") => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
