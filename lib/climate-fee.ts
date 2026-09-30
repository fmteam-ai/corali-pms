// The Greek Climate Crisis Resilience Fee is charged per room per night by law (pure; unit tested).
// Names are compared with JavaScript case folding, which (unlike a C-locale database) handles Greek capitals.

type ChargeLike = { category?: unknown; name?: unknown; name_el?: unknown; name_en?: unknown; name_translations_json?: unknown };
const stems = ["κλιματ", "ανθεκτικ", "climate", "resilience", "résilience", "klima", "climatic"];
const fold = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function isClimateFee(c: ChargeLike): boolean {
  if (["climate_resilience", "climate_tax"].includes(String(c.category ?? ""))) return true;
  const text = [c.name, c.name_el, c.name_en, c.name_translations_json].map(fold).join(" ");
  return stems.some((s) => text.includes(fold(s)));
}

/** Calculation mode actually used: the climate fee is always per room per night. */
export function chargeMode(c: ChargeLike & { calculation_mode?: unknown }): string {
  return isClimateFee(c) ? "per_room_night" : String(c.calculation_mode ?? "per_booking");
}
