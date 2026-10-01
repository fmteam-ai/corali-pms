// What a booking-engine card shows for a room type: rooms of one type are sold together, so the card takes the
// photos of the first room that has any (a room without photos must not hide the others) and the characteristics
// of all its rooms, without duplicates (pure; unit tested).

type CardRoom = { images: unknown; amenity_list: unknown };
const list = <T,>(v: unknown): T[] => { if (Array.isArray(v)) return v as T[]; try { const x = JSON.parse(String(v ?? "[]")); return Array.isArray(x) ? x : []; } catch { return []; } };

export function cardImages(rooms: CardRoom[]): string[] {
  for (const r of rooms) {
    const images = list<string>(r.images).filter((u) => typeof u === "string" && u.trim() !== "");
    if (images.length) return images;
  }
  return [];
}

export function cardAmenities<T extends { icon?: string; el?: string; en?: string }>(rooms: CardRoom[]): T[] {
  const seen = new Set<string>(), out: T[] = [];
  for (const r of rooms) for (const a of list<T>(r.amenity_list)) {
    const key = `${a.icon ?? ""}|${(a.el ?? "").toLowerCase()}|${(a.en ?? "").toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); out.push(a); }
  }
  return out;
}
