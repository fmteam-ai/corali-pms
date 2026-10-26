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

// ── Bulk price update ────────────────────────────────────────────────────────────────────────────────────────────
// "From A to B (on these weekdays), these categories / rooms cost X a night": the new price becomes the final one for
// those nights. Older rules for the same categories or rooms are cut around the period (kept before and after it, and on
// weekdays the update does not touch); rules for all rooms lose to it anyway. A category update also cuts room rules of
// that category's rooms, so every room of it ends up at the new price.

export type NewSeasonRule = { name: string; room_type: string | null; room_codes: string[]; weekdays: number[]; starts_on: string; ends_on: string; price_cents: number; active: number };
export type BulkSelection = { roomTypes: string[]; roomCodes: string[]; codesOfTypes: string[] };

const allDays = [0, 1, 2, 3, 4, 5, 6];
const shiftDay = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

export function bulkPricePlan(existing: SeasonRule[], sel: BulkSelection, from: string, to: string, weekdays: number[], priceCents: number, name: string): { deleteIds: number[]; inserts: NewSeasonRule[] } {
  const touched = new Set(weekdays.length ? weekdays : allDays);
  const types = new Set(sel.roomTypes), codes = new Set([...sel.roomCodes, ...sel.codesOfTypes]);
  const deleteIds: number[] = [], inserts: NewSeasonRule[] = [];
  const base = (r: SeasonRule) => ({ name: (r as { name?: string }).name ?? "", room_type: r.room_type, room_codes: list<string>(r.room_codes).map(String), weekdays: list<number>(r.weekdays).map(Number), starts_on: r.starts_on, ends_on: r.ends_on, price_cents: Number(r.price_cents), active: 1 });
  for (const r of existing) {
    if (r.active !== undefined && r.active !== null && Number(r.active) !== 1) continue;
    if (r.price_cents === null || r.price_cents === undefined || r.price_cents === "") continue;
    if (r.ends_on < from || r.starts_on > to) continue;
    const days = list<number>(r.weekdays).map(Number), ruleDays = days.length ? days : allDays;
    if (!ruleDays.some((d) => touched.has(d))) continue;
    const ruleCodes = list<string>(r.room_codes).map(String);
    let carved: NewSeasonRule | null = null;
    if (ruleCodes.length) {
      const hit = ruleCodes.filter((c) => codes.has(c));
      if (!hit.length) continue;
      const rest = ruleCodes.filter((c) => !codes.has(c));
      if (rest.length) inserts.push({ ...base(r), room_codes: rest });
      carved = { ...base(r), room_codes: hit };
    } else if (r.room_type && types.has(r.room_type)) carved = base(r);
    else continue;
    deleteIds.push(Number(r.id));
    if (carved.starts_on < from) inserts.push({ ...carved, ends_on: shiftDay(from, -1) });
    if (carved.ends_on > to) inserts.push({ ...carved, starts_on: shiftDay(to, 1) });
    const left = ruleDays.filter((d) => !touched.has(d));
    if (left.length) inserts.push({ ...carved, starts_on: carved.starts_on > from ? carved.starts_on : from, ends_on: carved.ends_on < to ? carved.ends_on : to, weekdays: left.length === 7 ? [] : left });
  }
  const wd = weekdays.length === 7 ? [] : [...new Set(weekdays)].sort();
  for (const t of sel.roomTypes) inserts.push({ name, room_type: t, room_codes: [], weekdays: wd, starts_on: from, ends_on: to, price_cents: priceCents, active: 1 });
  if (sel.roomCodes.length) inserts.push({ name, room_type: null, room_codes: [...new Set(sel.roomCodes)], weekdays: wd, starts_on: from, ends_on: to, price_cents: priceCents, active: 1 });
  return { deleteIds, inserts };
}
