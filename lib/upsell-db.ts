// Upsell suggestions for a reservation from the guest's CRM history (previous stays and extras bought).
import { db } from "@/lib/db";
import { recommendExtras, type UpsellExtra, type UpsellReason } from "@/lib/upsell";

export type UpsellSuggestion = { id: number; name: string; unitCents: number; amountCents: number; quantity: number; reason: UpsellReason };

export async function reservationUpsell(ownerId: string, booking: { id: number; guest_email: string | null; adults: number; children: number; check_in: string; check_out: string; created_at: number }): Promise<{ stays: number; suggestions: UpsellSuggestion[] }> {
  const email = booking.guest_email?.trim().toLowerCase() || null;
  const [extras, past, sessions, folio] = await Promise.all([
    db().query(`SELECT id,code,name,name_el,description,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id`, [ownerId]),
    email ? db().query(`SELECT count(*)::int n FROM bookings WHERE owner_id=$1 AND lower(guest_email)=$2 AND id<>$3 AND status IN ('checked_out','checked_in','confirmed')`, [ownerId, email, booking.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
    email ? db().query(`SELECT selected_extra_ids FROM booking_sessions WHERE owner_id=$1 AND lower(guest_email)=$2 AND status='completed'`, [ownerId, email]) : Promise.resolve({ rows: [] }),
    email ? db().query(`SELECT f.description FROM folio_entries f JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id WHERE f.owner_id=$1 AND lower(b.guest_email)=$2 AND b.id<>$3 AND f.category='extra' AND f.entry_type='charge'`, [ownerId, email, booking.id]) : Promise.resolve({ rows: [] }),
  ]);
  const list = extras.rows.map((e) => ({ id: Number(e.id), code: String(e.code), name: String(e.name_el || e.name), description: e.description ?? "", pricing_mode: e.pricing_mode, price: Number(e.price_cents) })) as (UpsellExtra & { price: number })[];
  const purchased = new Set<number>();
  for (const s of sessions.rows) { try { for (const id of JSON.parse(s.selected_extra_ids || "[]")) purchased.add(Number(id)); } catch { /* ignore malformed history */ } }
  const lines = folio.rows.map((r) => String(r.description).toLowerCase());
  for (const e of list) if (lines.some((l) => l.includes(e.name.toLowerCase()) || l.includes(e.code.toLowerCase()))) purchased.add(e.id);
  const nights = Math.max(1, Math.round((Date.parse(`${booking.check_out}T00:00:00Z`) - Date.parse(`${booking.check_in}T00:00:00Z`)) / 86_400_000));
  const guests = Number(booking.adults) + Number(booking.children);
  const ranked = recommendExtras(list, { adults: Number(booking.adults), children: Number(booking.children), nights, checkIn: booking.check_in, bookingDate: new Date(Number(booking.created_at)).toISOString().slice(0, 10) }, 3, { purchasedIds: [...purchased], stays: Number(past.rows[0]?.n ?? 0) });
  const suggestions = ranked.map((r) => {
    const e = list.find((x) => x.id === r.id)!;
    const quantity = e.pricing_mode === "per_night" ? nights : e.pricing_mode === "per_person" ? guests : 1;
    return { id: e.id, name: e.name, unitCents: e.price, amountCents: e.price * quantity, quantity, reason: r.reason };
  });
  return { stays: Number(past.rows[0]?.n ?? 0), suggestions };
}
