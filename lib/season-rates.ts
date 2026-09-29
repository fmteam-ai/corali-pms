// Season prices: a nightly price for a period, for every room, one room type or specific rooms (pure; unit tested).
// The most specific rule wins (rooms > room type > all rooms), then the shorter period, then the latest edit.

export type SeasonRule = {
  id: number | string;
  room_type: string | null;
  room_codes: string | string[] | null;
  weekdays: string | number[] | null;
  starts_on: string;
  ends_on: string;
  price_cents: number | string | null;
  active?: number | string | null;
  updated_at?: number | string | null;
};

function list<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; }
}

const dayMs = 86_400_000;
const span = (r: SeasonRule) => Date.parse(`${r.ends_on}T00:00:00Z`) - Date.parse(`${r.starts_on}T00:00:00Z`);
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** 3 = specific rooms, 2 = room type, 1 = all rooms, 0 = does not apply to this room. */
export function ruleTarget(rule: SeasonRule, roomType: string, roomCode: string | null): number {
  const codes = list<string>(rule.room_codes).map(String);
  if (codes.length) return roomCode !== null && codes.includes(roomCode) ? 3 : 0;
  if (rule.room_type) return rule.room_type === roomType ? 2 : 0;
  return 1;
}

export function ruleApplies(rule: SeasonRule, date: string): boolean {
  if (rule.active !== undefined && rule.active !== null && Number(rule.active) !== 1) return false;
  if (rule.price_cents === null || rule.price_cents === undefined || rule.price_cents === "") return false;
  if (rule.starts_on > date || rule.ends_on < date) return false;
  const days = list<number>(rule.weekdays).map(Number);
  return !days.length || days.includes(weekdayOf(date));
}

function greater(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The winning season rule for one night of one room (roomCode null = the room type in general), or null. */
export function seasonRuleFor(rules: SeasonRule[], date: string, roomType: string, roomCode: string | null): SeasonRule | null {
  let best: SeasonRule | null = null, bestKey: number[] = [];
  for (const r of rules) {
    if (!ruleApplies(r, date)) continue;
    const target = ruleTarget(r, roomType, roomCode);
    if (!target) continue;
    const key = [target, -span(r) / dayMs, Number(r.updated_at ?? 0), Number(r.id) || 0];
    if (!best || greater(key, bestKey)) { best = r; bestKey = key; }
  }
  return best;
}

/** Nightly price in cents: the winning season price, else the room's base rate. */
export function nightlyPrice(rules: SeasonRule[], date: string, roomType: string, roomCode: string | null, baseCents: number): number {
  const r = seasonRuleFor(rules, date, roomType, roomCode);
  return r ? Math.max(0, Math.round(Number(r.price_cents))) : Math.max(0, Math.round(baseCents));
}

export function datesBetween(from: string, days: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(start + i * dayMs).toISOString().slice(0, 10));
}
