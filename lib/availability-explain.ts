// Why is a room (not) offered in the booking engine for a stay? Mirrors the engine's checks (pure; unit tested).
import { requiredMinStay, type MinStayRule } from "./min-stay.ts";
import { nightlyPrice, ruleTarget, type SeasonRule } from "./season-rates.ts";

export type ExplainRoom = { id: number; code: string; room_type: string; category: string; capacity: number; active: number; operational_status: string; base_rate_cents: number };
export type Reason =
  | { code: "inactive" | "out_of_order" | "payment_hold" | "no_price" }
  | { code: "capacity"; capacity: number; needed: number }
  | { code: "booked"; reference: string; checkIn: string; checkOut: string }
  | { code: "min_stay"; nights: number }
  | { code: "closed"; detail: string }
  | { code: "restriction"; name: string }
  | { code: "not_enough"; free: number; requested: number };
export type RoomExplanation = { id: number; code: string; roomType: string; category: string; offered: boolean; card: string; reasons: Reason[] };

type RateRule = SeasonRule & { minimum_stay: number | null; maximum_stay: number | null; closed: number; closed_to_arrival: number; closed_to_departure: number };
type Restriction = { name: string; starts_on: string; ends_on: string; minimum_stay: number; maximum_stay: number | null; closed_arrival_weekdays: string; closed_departure_weekdays: string; room_codes: string; rate_plan_keys: string };

const list = <T,>(v: unknown): T[] => { if (Array.isArray(v)) return v as T[]; try { const x = JSON.parse(String(v ?? "[]")); return Array.isArray(x) ? x : []; } catch { return []; } };
const dayMs = 86_400_000;
export function stayDates(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${checkIn}T00:00:00Z`); t < Date.parse(`${checkOut}T00:00:00Z`); t += dayMs) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function explainAvailability(input: {
  checkIn: string; checkOut: string; adults: number; children: number; rooms: number;
  roomList: ExplainRoom[]; bookings: { room_id: number; reference: string; check_in: string; check_out: string }[]; holds: number[];
  rateRules: RateRule[]; restrictions: Restriction[]; minStay: MinStayRule[];
}): RoomExplanation[] {
  const dates = stayDates(input.checkIn, input.checkOut), nights = dates.length;
  const perRoom = Math.ceil((input.adults + input.children) / Math.max(1, input.rooms));
  const arrivalDow = new Date(`${input.checkIn}T00:00:00Z`).getUTCDay(), departureDow = new Date(`${input.checkOut}T00:00:00Z`).getUTCDay();
  // Room-level blocks first.
  const rows = input.roomList.map((room) => {
    const reasons: Reason[] = [];
    if (Number(room.active) !== 1) reasons.push({ code: "inactive" });
    if (room.operational_status === "out_of_order") reasons.push({ code: "out_of_order" });
    if (Number(room.capacity) < perRoom) reasons.push({ code: "capacity", capacity: Number(room.capacity), needed: perRoom });
    for (const b of input.bookings.filter((b) => Number(b.room_id) === room.id)) reasons.push({ code: "booked", reference: b.reference, checkIn: b.check_in, checkOut: b.check_out });
    if (input.holds.includes(room.id)) reasons.push({ code: "payment_hold" });
    return { room, reasons };
  });
  // Category-level checks, as the engine sells rooms grouped by room type.
  const byType = new Map<string, typeof rows>();
  for (const r of rows) byType.set(r.room.room_type, [...(byType.get(r.room.room_type) ?? []), r]);
  const out: RoomExplanation[] = [];
  for (const [type, group] of byType) {
    const free = group.filter((g) => !g.reasons.length);
    const typeReasons: Reason[] = [];
    if (free.length < input.rooms) typeReasons.push({ code: "not_enough", free: free.length, requested: input.rooms });
    const need = requiredMinStay(input.minStay, input.checkIn, type);
    if (nights < need) typeReasons.push({ code: "min_stay", nights: need });
    const typeBase = Math.max(0, ...group.map((g) => Number(g.room.base_rate_cents) || 0));
    for (const g of free) {
      for (const date of dates) {
        const rule = input.rateRules.filter((r) => ruleTarget(r, type, g.room.code) > 0 && r.starts_on <= date && r.ends_on >= date && (r.minimum_stay !== null || r.maximum_stay !== null || Number(r.closed) === 1 || Number(r.closed_to_arrival) === 1 || Number(r.closed_to_departure) === 1)).at(-1);
        if (rule && (Number(rule.closed) === 1 || Number(rule.minimum_stay ?? 1) > nights || (rule.maximum_stay && Number(rule.maximum_stay) < nights) || (date === input.checkIn && Number(rule.closed_to_arrival) === 1) || (date === dates.at(-1) && Number(rule.closed_to_departure) === 1))) {
          if (!typeReasons.some((r) => r.code === "closed")) typeReasons.push({ code: "closed", detail: `${rule.starts_on} – ${rule.ends_on}` });
        }
        if (nightlyPrice(input.rateRules, date, type, g.room.code, Number(g.room.base_rate_cents) > 0 ? Number(g.room.base_rate_cents) : typeBase) <= 0 && !typeReasons.some((r) => r.code === "no_price")) typeReasons.push({ code: "no_price" });
      }
      // A restriction that applies to every rate plan hides the room.
      for (const r of input.restrictions.filter((r) => r.starts_on < input.checkOut && r.ends_on >= input.checkIn && !list<string>(r.rate_plan_keys).length && (!list<string>(r.room_codes).length || list<string>(r.room_codes).includes(g.room.code)))) {
        if (Number(r.minimum_stay) > nights || (r.maximum_stay && Number(r.maximum_stay) < nights) || list<number>(r.closed_arrival_weekdays).includes(arrivalDow) || list<number>(r.closed_departure_weekdays).includes(departureDow)) {
          if (!typeReasons.some((x) => x.code === "restriction" && x.name === r.name)) typeReasons.push({ code: "restriction", name: r.name });
        }
      }
    }
    // The guest sees the category name of the first room in the group.
    const card = group[0]?.room.category || type;
    for (const g of group) {
      const reasons = g.reasons.length ? g.reasons : typeReasons;
      out.push({ id: g.room.id, code: g.room.code, roomType: type, category: g.room.category, offered: reasons.length === 0, card, reasons });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}
