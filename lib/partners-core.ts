// Partner businesses of the hotel (pure; unit tested): categories, what can be ordered, the price of an order with an
// approved offer / code, the hotel's commission and which order steps are allowed.
import { z } from "zod";

export const partnerCategories = ["restaurant", "bar", "cafe", "fast_food", "car_rental", "boat", "tours", "beauty", "shop", "other"] as const;
export type PartnerCategory = (typeof partnerCategories)[number];

export const categoryLabels: Record<PartnerCategory, { icon: string; el: string; en: string; fr: string; de: string; it: string; es: string }> = {
  restaurant: { icon: "🍽️", el: "Εστιατόρια", en: "Restaurants", fr: "Restaurants", de: "Restaurants", it: "Ristoranti", es: "Restaurantes" },
  bar: { icon: "🍹", el: "Μπαρ", en: "Bars", fr: "Bars", de: "Bars", it: "Bar", es: "Bares" },
  cafe: { icon: "☕", el: "Καφέ", en: "Cafés", fr: "Cafés", de: "Cafés", it: "Caffè", es: "Cafeterías" },
  fast_food: { icon: "🍔", el: "Fast food", en: "Fast food", fr: "Restauration rapide", de: "Fast Food", it: "Fast food", es: "Comida rápida" },
  car_rental: { icon: "🚗", el: "Ενοικιάσεις οχημάτων", en: "Car & bike rental", fr: "Location de véhicules", de: "Fahrzeugverleih", it: "Noleggio veicoli", es: "Alquiler de vehículos" },
  boat: { icon: "⛵", el: "Σκάφη & εκδρομές", en: "Boats & trips", fr: "Bateaux & excursions", de: "Boote & Ausflüge", it: "Barche & gite", es: "Barcos y excursiones" },
  tours: { icon: "🗺️", el: "Δραστηριότητες", en: "Activities", fr: "Activités", de: "Aktivitäten", it: "Attività", es: "Actividades" },
  beauty: { icon: "💆", el: "Ομορφιά & ευεξία", en: "Beauty & wellness", fr: "Beauté & bien-être", de: "Beauty & Wellness", it: "Bellezza & benessere", es: "Belleza y bienestar" },
  shop: { icon: "🛍️", el: "Καταστήματα", en: "Shops", fr: "Boutiques", de: "Geschäfte", it: "Negozi", es: "Tiendas" },
  other: { icon: "⭐", el: "Άλλα", en: "Other", fr: "Autres", de: "Sonstiges", it: "Altro", es: "Otros" },
};

const text = (max: number) => z.string().trim().max(max).default("");
const url = z.string().trim().max(500).refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "https").default("");

export const partnerInput = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(partnerCategories),
  descriptionEl: text(1500), descriptionEn: text(1500),
  phone: text(40), email: z.string().trim().max(200).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "email").default(""),
  address: text(200), website: url, menuUrl: url, hours: text(200),
  delivery: z.boolean().default(false), pickup: z.boolean().default(true),
  acceptsCash: z.boolean().default(true), acceptsPos: z.boolean().default(true), acceptsLink: z.boolean().default(false),
  commissionPercent: z.number().min(0).max(50).default(0),
  active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(999).default(0),
});
export type PartnerInput = z.infer<typeof partnerInput>;

export const itemInput = z.object({ section: text(60), nameEl: text(120), nameEn: text(120), description: text(400), priceEur: z.number().min(0).max(5000), active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(9999).default(0) }).refine((x) => x.nameEl || x.nameEn, "name");
export type ItemInput = z.infer<typeof itemInput>;

export const offerInput = z.object({
  titleEl: text(120), titleEn: text(120), bodyEl: text(800), bodyEn: text(800),
  discountPercent: z.number().min(1).max(90).nullable().default(null),
  code: z.string().trim().toUpperCase().max(30).refine((v) => v === "" || /^[A-Z0-9-]{3,30}$/.test(v), "code").default(""),
  startsOn: z.iso.date(), endsOn: z.iso.date(),
  /** Only for the hotel's guests: shown first in the guest portal; at the business the guest shows the guest pass. */
  guestsOnly: z.boolean().default(true),
  /** Uses per booking: 1 = once per guest; null = as often as wanted while the booking lasts. */
  maxUses: z.number().int().min(1).max(50).nullable().default(1),
  /** Daily hours (HH:MM, both or neither), e.g. happy hour; empty = all day. */
  timeFrom: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).default(""),
  timeTo: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).default(""),
}).refine((x) => x.titleEl || x.titleEn, "title").refine((x) => x.endsOn >= x.startsOn, "dates").refine((x) => !x.code || x.discountPercent !== null, "code needs a discount").refine((x) => !x.timeFrom === !x.timeTo, "hours");
export type OfferInput = z.infer<typeof offerInput>;

export const payMethods = ["cash", "pos", "link"] as const;
export type PayMethod = (typeof payMethods)[number];
export const orderInput = z.object({
  partnerId: z.number().int().positive(),
  items: z.array(z.object({ id: z.number().int().positive(), qty: z.number().int().min(1).max(50) })).min(1).max(40),
  fulfilment: z.enum(["delivery", "pickup"]),
  wantedAt: text(60), note: text(400),
  payMethod: z.enum(payMethods),
  code: z.string().trim().toUpperCase().max(30).default(""),
});
export type OrderInput = z.infer<typeof orderInput>;

type CatalogueItem = { id: number; name: string; priceCents: number; active: boolean };
type Offer = { id: number; discountPercent: number | null; code: string | null; startsOn: string; endsOn: string; status: string; maxUses?: number | null; timeFrom?: string; timeTo?: string };

/** Price an order from the catalogue (never from the guest's numbers); an approved, current code gives its discount. */
export function priceOrder(catalogue: CatalogueItem[], cart: { id: number; qty: number }[], offers: Offer[], code: string, today: string, commissionPercent: number, usedByOffer: Record<number, number> = {}, now = "12:00"):
  { ok: true; lines: { id: number; name: string; qty: number; priceCents: number }[]; subtotalCents: number; discountCents: number; totalCents: number; commissionCents: number; offerId: number | null } | { ok: false; error: "ITEM" | "CODE" | "USED" } {
  const lines: { id: number; name: string; qty: number; priceCents: number }[] = [];
  for (const c of cart) {
    const it = catalogue.find((x) => x.id === c.id && x.active);
    if (!it) return { ok: false, error: "ITEM" };
    const same = lines.find((l) => l.id === it.id);
    if (same) same.qty += c.qty; else lines.push({ id: it.id, name: it.name, qty: c.qty, priceCents: it.priceCents });
  }
  const subtotalCents = lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
  let discountCents = 0, offerId: number | null = null;
  if (code) {
    const o = offers.find((x) => x.status === "approved" && x.code && x.code.toUpperCase() === code.toUpperCase() && offerOpen(x, today, now) && x.discountPercent);
    if (!o) return { ok: false, error: "CODE" };
    if (!canUse(o.maxUses ?? null, usedByOffer[o.id] ?? 0)) return { ok: false, error: "USED" };
    discountCents = Math.round((subtotalCents * Number(o.discountPercent)) / 100);
    offerId = o.id;
  }
  const totalCents = subtotalCents - discountCents;
  return { ok: true, lines, subtotalCents, discountCents, totalCents, commissionCents: Math.round((totalCents * commissionPercent) / 100), offerId };
}

export const orderStatuses = ["placed", "accepted", "ready", "completed", "declined", "cancelled"] as const;
export type OrderStatus = (typeof orderStatuses)[number];

/** What the business may do next with an order. */
export function nextStatuses(s: string): OrderStatus[] {
  if (s === "placed") return ["accepted", "declined"];
  if (s === "accepted") return ["ready", "completed", "cancelled"];
  if (s === "ready") return ["completed", "cancelled"];
  return [];
}

/** Orders that count for the hotel's commission. */
export const commissionable = (s: string) => s === "completed";

/** Guest portal order: businesses with a current hotel-guests offer first (best discount first), then by sort order and name. */
export function sortPartners<T extends { name: string; sortOrder: number; guestDiscount: number | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.guestDiscount !== null ? 1 : 0) - (a.guestDiscount !== null ? 1 : 0) || (b.guestDiscount ?? 0) - (a.guestDiscount ?? 0) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** May this booking use the offer again? maxUses null = no limit while the booking lasts. */
export const canUse = (maxUses: number | null, used: number) => maxUses === null || used < maxUses;

/** Is the offer valid on this day and time? Hours may cross midnight (22:00–02:00). */
export function offerOpen(o: { startsOn: string; endsOn: string; timeFrom?: string; timeTo?: string }, today: string, now: string): boolean {
  if (o.startsOn > today || o.endsOn < today) return false;
  if (!o.timeFrom || !o.timeTo) return true;
  return o.timeFrom <= o.timeTo ? now >= o.timeFrom && now < o.timeTo : now >= o.timeFrom || now < o.timeTo;
}
