// Housekeeping on the phone (/hk): what each room needs today and what changed since the last refresh (pure; unit tested).

/** turnover = a guest leaves and another arrives the same day (clean first). */
export type HkRoomKind = "turnover" | "departure" | "arrival" | "stayover" | "vacant";
export const hkKindOrder: Record<HkRoomKind, number> = { turnover: 0, departure: 1, arrival: 2, stayover: 3, vacant: 4 };

export function roomDayKind(x: { departure: boolean; arrival: boolean; stayover: boolean }): HkRoomKind {
  if (x.departure && x.arrival) return "turnover";
  if (x.departure) return "departure";
  if (x.arrival) return "arrival";
  return x.stayover ? "stayover" : "vacant";
}

/** A room is worth showing when something happens in it today or work is open. */
export function roomHasWork(x: { kind: HkRoomKind; taskOpen: boolean; notices: number; due: number }): boolean {
  return x.kind !== "vacant" || x.taskOpen || x.notices > 0 || x.due > 0;
}

export type HkSnapshot = {
  rooms: { code: string; departed: boolean; task: { id: number; assignedToMe: boolean } | null }[];
  messages: { id: number; mine: boolean }[];
};

/** What should ring the phone: new messages to me, guests who just left, tasks newly given to me. */
export function hkChanges(prev: HkSnapshot | null, next: HkSnapshot): { messages: number; departed: string[]; tasks: string[] } {
  if (!prev) return { messages: 0, departed: [], tasks: [] };
  const seen = new Set(prev.messages.map((m) => m.id));
  const before = new Map(prev.rooms.map((r) => [r.code, r]));
  const departed: string[] = [], tasks: string[] = [];
  for (const r of next.rooms) {
    const p = before.get(r.code);
    if (r.departed && !p?.departed) departed.push(r.code);
    if (r.task?.assignedToMe && !(p?.task?.assignedToMe && p.task.id === r.task.id)) tasks.push(r.code);
  }
  return { messages: next.messages.filter((m) => !m.mine && !seen.has(m.id)).length, departed, tasks };
}
