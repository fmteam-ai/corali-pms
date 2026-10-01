// Dashboard widgets: catalogue, default arrangement and validation of a user's saved layout (pure; unit tested).
export const widgetIds = ["sticky_notes", "booking_search", "ai_assistant", "forecast", "arriving", "departing", "check_availability", "bookings_calendar", "latest_bookings", "rooms_today", "finance", "housekeeping", "notifications"] as const;
export type WidgetId = (typeof widgetIds)[number];
export type WidgetSize = 1 | 2 | 3;
export type WidgetPlacement = { id: WidgetId; size: WidgetSize; hidden: boolean };

/** Similar to a VikBooking dashboard: notes and front desk on the left, lookup/forecast/calendar on the right. */
export const defaultLayout: WidgetPlacement[] = [
  { id: "sticky_notes", size: 2, hidden: false },
  { id: "booking_search", size: 1, hidden: false },
  { id: "ai_assistant", size: 1, hidden: false },
  { id: "arriving", size: 2, hidden: false },
  { id: "forecast", size: 1, hidden: false },
  { id: "departing", size: 2, hidden: false },
  { id: "bookings_calendar", size: 1, hidden: false },
  { id: "check_availability", size: 2, hidden: false },
  { id: "latest_bookings", size: 1, hidden: false },
  { id: "rooms_today", size: 3, hidden: false },
  { id: "finance", size: 1, hidden: false },
  { id: "housekeeping", size: 1, hidden: false },
  { id: "notifications", size: 1, hidden: false },
];

const insertAfter: Partial<Record<WidgetId, WidgetId>> = { ai_assistant: "booking_search" };

/** Keep known widgets once each, in the saved order; widgets added in later releases are appended visible. */
export function normalizeLayout(raw: unknown): WidgetPlacement[] {
  let list: unknown = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch { list = null; } }
  if (!Array.isArray(list)) return defaultLayout.map((w) => ({ ...w }));
  const seen = new Set<string>();
  const out: WidgetPlacement[] = [];
  for (const item of list) {
    const id = item?.id;
    if (!(widgetIds as readonly string[]).includes(id) || seen.has(id)) continue;
    seen.add(id);
    const size = [1, 2, 3].includes(Number(item.size)) ? (Number(item.size) as WidgetSize) : defaultLayout.find((w) => w.id === id)!.size;
    out.push({ id, size, hidden: item.hidden === true });
  }
  for (const w of defaultLayout) {
    if (seen.has(w.id)) continue;
    // Widgets added in later releases go where they sit in the default layout (after their predecessor) when it is
    // the one they are designed to follow; otherwise at the end.
    const after = insertAfter[w.id];
    const at = after ? out.findIndex((x) => x.id === after) : -1;
    if (at >= 0) out.splice(at + 1, 0, { ...w });
    else out.push({ ...w });
  }
  return out;
}

export function moveWidget(layout: WidgetPlacement[], id: WidgetId, delta: -1 | 1): WidgetPlacement[] {
  const i = layout.findIndex((w) => w.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
