// Minimum stay per room category (room type), checked against the check-in date (pure; unit tested).
// A period rule beats an all-year rule, a room-type rule beats one for all rooms, then the shorter period, then the latest edit.

export type MinStayRule = { id: number | string; room_type: string | null; starts_on: string | null; ends_on: string | null; min_nights: number | string; active?: number | string | null; updated_at?: number | string | null };

const dayMs = 86_400_000;
const span = (r: MinStayRule) => (r.starts_on && r.ends_on ? (Date.parse(`${r.ends_on}T00:00:00Z`) - Date.parse(`${r.starts_on}T00:00:00Z`)) / dayMs : Number.MAX_SAFE_INTEGER);

export function minStayRuleFor(rules: MinStayRule[], checkIn: string, roomType: string): MinStayRule | null {
  let best: MinStayRule | null = null, bestKey: number[] = [];
  for (const r of rules) {
    if (r.active !== undefined && r.active !== null && Number(r.active) !== 1) continue;
    if (r.room_type && r.room_type !== roomType) continue;
    const period = Boolean(r.starts_on && r.ends_on);
    if (period && (r.starts_on! > checkIn || r.ends_on! < checkIn)) continue;
    const key = [period ? 1 : 0, r.room_type ? 1 : 0, -span(r), Number(r.updated_at ?? 0), Number(r.id) || 0];
    if (!best || greater(key, bestKey)) { best = r; bestKey = key; }
  }
  return best;
}

function greater(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Nights required for a stay starting on `checkIn` in this room type (1 when no rule applies). */
export function requiredMinStay(rules: MinStayRule[], checkIn: string, roomType: string): number {
  const r = minStayRuleFor(rules, checkIn, roomType);
  return r ? Math.max(1, Math.trunc(Number(r.min_nights)) || 1) : 1;
}
