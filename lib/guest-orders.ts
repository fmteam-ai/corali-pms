// Guest orders in the database: what a guest can order now (with live prices), placing an order, and reception's
// confirm (charged to the folio; an upgrade also moves the booking) or decline. The guest sees the answer in "My booking".
import type { PoolClient } from "pg";
import { db, withTransaction } from "@/lib/db";
import { enqueueAvailability } from "@/lib/channel-sync";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { extraQuantity, lateCheckoutCents, LATE_CHECKOUT_UNTIL, orderTexts, orderWindow, type OrderKind } from "@/lib/guest-orders-core";
import { pushNotification } from "@/lib/pms-notifications";
import { publicAvailability, translatedText } from "@/lib/public-rate";
import { hotelToday } from "@/lib/tape-chart";
import { reservationUpsell } from "@/lib/upsell-db";
import type { BookingLanguage } from "@/lib/booking-i18n";

type Q = Pick<PoolClient, "query">;
type Booking = Record<string, unknown>;
const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const nightsOf = (b: Booking) => Math.max(1, Math.round((Date.parse(`${b.check_out}T00:00:00Z`) - Date.parse(`${b.check_in}T00:00:00Z`)) / 86_400_000));

async function accommodationCents(q: Q, ownerId: string, b: Booking): Promise<number> {
  const r = await q.query(`SELECT COALESCE(sum(amount_cents),0)::bigint s, count(*)::int n FROM booking_nightly_rates WHERE owner_id=$1 AND booking_id=$2`, [ownerId, b.id]);
  return Number(r.rows[0].n) ? Number(r.rows[0].s) : Number(b.total_cents);
}

export type GuestOffer = {
  extras: { id: number; name: string; description: string; unitCents: number; mode: string; quantity: number; amountCents: number; recommended: boolean }[];
  lateCheckout: { amountCents: number; until: string } | null;
  upgrades: { roomType: string; name: string; description: string; image: string | null; diffCents: number }[];
};

/** Offers for a booking (live prices); the late check-out only when nobody arrives in that room on the departure day. */
export async function guestOffers(ownerId: string, b: Booking, lang: BookingLanguage): Promise<GuestOffer> {
  const today = hotelToday(), w = orderWindow(String(b.status), String(b.check_in), String(b.check_out), today);
  const nights = nightsOf(b), persons = Number(b.adults ?? 1) + Number(b.children ?? 0);
  const out: GuestOffer = { extras: [], lateCheckout: null, upgrades: [] };
  if (w.extras) {
    const [extras, upsell] = await Promise.all([
      db().query(`SELECT id,code,name,name_el,name_en,description,description_el,description_en,name_translations_json,description_translations_json,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id`, [ownerId]),
      reservationUpsell(ownerId, { id: Number(b.id), guest_email: (b.guest_email as string) ?? null, adults: Number(b.adults ?? 1), children: Number(b.children ?? 0), check_in: String(b.check_in), check_out: String(b.check_out), created_at: Number(b.created_at ?? Date.now()) }).catch(() => ({ suggestions: [] as { id: number }[] })),
    ]);
    const rec = new Set(upsell.suggestions.map((s) => s.id));
    out.extras = extras.rows.map((e) => {
      const q = extraQuantity(String(e.pricing_mode), nights, persons);
      return { id: Number(e.id), name: translatedText(e.name_translations_json, lang, e.name_el, e.name_en, e.name), description: translatedText(e.description_translations_json, lang, e.description_el, e.description_en, e.description), unitCents: Number(e.price_cents), mode: String(e.pricing_mode), quantity: q, amountCents: Number(e.price_cents) * q, recommended: rec.has(Number(e.id)) };
    }).sort((a, b) => Number(b.recommended) - Number(a.recommended));
  }
  if (w.lateCheckout && b.room_id) {
    const next = await db().query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND check_in=$3 AND id<>$4 AND status NOT IN ('cancelled','no_show','checked_out') LIMIT 1`, [ownerId, b.room_id, b.check_out, b.id]);
    const amount = lateCheckoutCents(await accommodationCents(db(), ownerId, b), nights);
    if (!next.rowCount && amount > 0) out.lateCheckout = { amountCents: amount, until: LATE_CHECKOUT_UNTIL };
  }
  if (w.upgrade) {
    try {
      const a = await publicAvailability({ ownerId, checkIn: String(b.check_in), checkOut: String(b.check_out), adults: Number(b.adults ?? 1), children: Number(b.children ?? 0), rooms: 1, lang, excludeBookingId: Number(b.id) });
      const price = (r: (typeof a.rooms)[number]) => (r.plans.find((p) => p.key === b.rate_policy) ?? r.plans[0])?.totalCents ?? 0;
      const current = a.rooms.find((r) => r.roomType === b.room_type);
      if (current) {
        out.upgrades = a.rooms.filter((r) => r.roomType !== b.room_type && price(r) > price(current)).map((r) => ({ roomType: r.roomType, name: r.name, description: r.description, image: r.images?.[0] ?? null, diffCents: price(r) - price(current) })).sort((x, y) => x.diffCents - y.diffCents).slice(0, 2);
      }
    } catch { /* no upgrade offers when availability cannot be computed */ }
  }
  return out;
}

export type GuestOrderRow = { id: number; kind: OrderKind; title: string; amountCents: number; status: string; date: string | null; time: string | null; note: string; createdAt: number; declineReason: string };

export async function bookingOrders(ownerId: string, bookingId: number): Promise<GuestOrderRow[]> {
  const r = await db().query(`SELECT * FROM guest_orders WHERE owner_id=$1 AND booking_id=$2 ORDER BY id DESC LIMIT 50`, [ownerId, bookingId]);
  return r.rows.map((o) => ({ id: Number(o.id), kind: o.kind, title: String(o.title_guest), amountCents: Number(o.amount_cents), status: String(o.status), date: o.service_date, time: o.service_time, note: String(o.note ?? ""), createdAt: Number(o.created_at), declineReason: String(o.decline_reason ?? "") }));
}

/** A guest order, priced again on the server from the current offer. */
export async function placeOrder(ownerId: string, b: Booking, lang: BookingLanguage, x: { kind: OrderKind; extraId?: number; roomType?: string; date?: string; time?: string; note?: string; source: string }): Promise<void> {
  const offer = await guestOffers(ownerId, b, lang);
  const t = orderTexts[lang], tEl = orderTexts.el;
  let item: { titleEl: string; titleGuest: string; amount: number; quantity: number; extraId: number | null; roomType: string | null };
  if (x.kind === "extra") {
    const e = offer.extras.find((v) => v.id === x.extraId);
    if (!e) throw Error("NOT_AVAILABLE");
    const el = (await db().query(`SELECT COALESCE(NULLIF(name_el,''),name) n FROM extras WHERE owner_id=$1 AND id=$2`, [ownerId, e.id])).rows[0]?.n ?? e.name;
    item = { titleEl: `${el}${e.quantity > 1 ? ` × ${e.quantity}` : ""}`, titleGuest: `${e.name}${e.quantity > 1 ? ` × ${e.quantity}` : ""}`, amount: e.amountCents, quantity: e.quantity, extraId: e.id, roomType: null };
  } else if (x.kind === "late_checkout") {
    if (!offer.lateCheckout) throw Error("NOT_AVAILABLE");
    item = { titleEl: tEl.lateName.replace("{until}", LATE_CHECKOUT_UNTIL), titleGuest: t.lateName.replace("{until}", LATE_CHECKOUT_UNTIL), amount: offer.lateCheckout.amountCents, quantity: 1, extraId: null, roomType: null };
  } else {
    const u = offer.upgrades.find((v) => v.roomType === x.roomType);
    if (!u) throw Error("NOT_AVAILABLE");
    const nameEl = (await db().query(`SELECT COALESCE(NULLIF(c.name_el,''),r.room_type) n FROM rooms r LEFT JOIN room_categories c ON c.owner_id=r.owner_id AND c.id=r.category_id WHERE r.owner_id=$1 AND r.room_type=$2 LIMIT 1`, [ownerId, u.roomType])).rows[0]?.n ?? u.roomType;
    item = { titleEl: tEl.upgradeName.replace("{room}", String(nameEl)), titleGuest: t.upgradeName.replace("{room}", u.name), amount: u.diffCents, quantity: 1, extraId: null, roomType: u.roomType };
  }
  const date = x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= String(b.check_in) && x.date <= String(b.check_out) ? x.date : null;
  const time = x.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) ? x.time : null;
  await withTransaction(async (c) => {
    const dup = await c.query(`SELECT 1 FROM guest_orders WHERE owner_id=$1 AND booking_id=$2 AND kind=$3 AND status='pending' AND COALESCE(extra_id,0)=COALESCE($4::bigint,0) AND COALESCE(room_type,'')=COALESCE($5,'')`, [ownerId, b.id, x.kind, item.extraId, item.roomType]);
    if (dup.rowCount) throw Error("ALREADY_REQUESTED");
    await c.query(
      `INSERT INTO guest_orders(owner_id,booking_id,kind,extra_id,room_type,title_el,title_guest,quantity,amount_cents,service_date,service_time,note,status,source,created_at,lang) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15)`,
      [ownerId, b.id, x.kind, item.extraId, item.roomType, item.titleEl.slice(0, 200), item.titleGuest.slice(0, 200), item.quantity, item.amount, date, time, (x.note ?? "").trim().slice(0, 300), x.source, Date.now(), lang],
    );
    const when = [date, time].filter(Boolean).join(" ");
    await pushNotification(c, ownerId, { kind: "guest_order", titleEl: `🛎️ ${b.reference} · ${b.guest_name}: ${item.titleEl} · ${euro(item.amount)}${when ? ` · ${when}` : ""}`, titleEn: `🛎️ ${b.reference} · ${b.guest_name}: ${item.titleEl} · ${euro(item.amount)}${when ? ` · ${when}` : ""}`, link: "/pms/guest-orders" });
  });
}

export async function listOrders(ownerId: string) {
  const r = await db().query(
    `SELECT o.*,b.reference,b.guest_name,b.check_in,b.check_out,r.code room_code FROM guest_orders o JOIN bookings b ON b.owner_id=o.owner_id AND b.id=o.booking_id LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE o.owner_id=$1 AND (o.status='pending' OR o.created_at>$2) ORDER BY (o.status='pending') DESC, o.created_at DESC LIMIT 200`,
    [ownerId, Date.now() - 30 * 86_400_000],
  );
  return r.rows.map((o) => ({ id: Number(o.id), kind: String(o.kind), title: String(o.title_el), amountCents: Number(o.amount_cents), status: String(o.status), date: o.service_date, time: o.service_time, note: String(o.note ?? ""), source: String(o.source), createdAt: Number(o.created_at), reference: String(o.reference), guest: String(o.guest_name), room: o.room_code ? String(o.room_code) : null, checkIn: String(o.check_in), checkOut: String(o.check_out), declineReason: String(o.decline_reason ?? "") }));
}

async function tellGuest(c: Q, ownerId: string, b: Booking, text: string) {
  await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,$4,0,$4)`, [ownerId, b.id, text.slice(0, 4000), Date.now()]);
}

/** Reception confirms: charged to the folio; an upgrade moves the booking to a free room of the new category. */
export async function confirmOrder(ownerId: string, orderId: number, actor: number): Promise<void> {
  await withTransaction(async (c) => {
    const o = (await c.query(`SELECT * FROM guest_orders WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, orderId])).rows[0];
    if (!o) throw Error("NOT_FOUND");
    if (o.status !== "pending") throw Error("ALREADY_HANDLED");
    const b = (await c.query(`SELECT * FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, o.booking_id])).rows[0];
    if (!b || !["confirmed", "checked_in"].includes(String(b.status))) throw Error("BOOKING_CLOSED");
    if (o.kind === "upgrade") {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('rooms:' || $1))`, [ownerId]);
      const free = (await c.query(
        `SELECT r.id FROM rooms r WHERE r.owner_id=$1 AND r.room_type=$2 AND r.active=1 AND r.operational_status<>'out_of_order'
           AND NOT EXISTS (SELECT 1 FROM bookings x WHERE x.owner_id=r.owner_id AND x.room_id=r.id AND x.id<>$5 AND x.status NOT IN ('cancelled','checked_out','no_show') AND x.check_in<$4 AND x.check_out>$3)
           AND NOT EXISTS (SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>$6 AND s.check_in<$4 AND s.check_out>$3 AND s.room_allocations::jsonb @> jsonb_build_array(r.id))
          ORDER BY r.code LIMIT 1`,
        [ownerId, o.room_type, b.check_in, b.check_out, b.id, Date.now()],
      )).rows[0];
      if (!free) throw Error("NO_ROOM");
      await c.query(`UPDATE bookings SET room_id=$1,version=version+1 WHERE owner_id=$2 AND id=$3`, [free.id, ownerId, b.id]);
      await enqueueAvailability(c, ownerId, String(b.check_in), String(b.check_out), "move");
    }
    await ensureFolio(c, ownerId, { id: Number(b.id), total_cents: Number(b.total_cents), balance_cents: Number(b.balance_cents), check_in: b.check_in, check_out: b.check_out, folio_initialized_at: b.folio_initialized_at, created_at: Number(b.created_at) });
    const entry = await c.query(
      `INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge',$3,$4,$5,'guest',$6,$7) RETURNING id`,
      [ownerId, b.id, o.kind === "upgrade" ? "accommodation" : "extra", String(o.title_el).slice(0, 200), Number(o.amount_cents), String(actor), Date.now()],
    );
    await recalcBooking(c, ownerId, Number(b.id));
    await c.query(`UPDATE guest_orders SET status='confirmed',handled_by=$3,handled_at=$4,folio_entry_id=$5 WHERE owner_id=$1 AND id=$2`, [ownerId, orderId, actor, Date.now(), entry.rows[0].id]);
    const t = orderTexts[(String(o.lang || "en") as keyof typeof orderTexts)] ?? orderTexts.en;
    await tellGuest(c, ownerId, b, t.confirmedMsg.replace("{item}", String(o.title_guest)).replace("{amount}", euro(Number(o.amount_cents))));
  });
}

export async function declineOrder(ownerId: string, orderId: number, actor: number, reason: string): Promise<void> {
  await withTransaction(async (c) => {
    const o = (await c.query(`SELECT * FROM guest_orders WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, orderId])).rows[0];
    if (!o) throw Error("NOT_FOUND");
    if (o.status !== "pending") throw Error("ALREADY_HANDLED");
    await c.query(`UPDATE guest_orders SET status='declined',decline_reason=$3,handled_by=$4,handled_at=$5 WHERE owner_id=$1 AND id=$2`, [ownerId, orderId, reason.slice(0, 300), actor, Date.now()]);
    const b = (await c.query(`SELECT id FROM bookings WHERE owner_id=$1 AND id=$2`, [ownerId, o.booking_id])).rows[0];
    const t = orderTexts[(String(o.lang || "en") as keyof typeof orderTexts)] ?? orderTexts.en;
    if (b) await tellGuest(c, ownerId, b, t.declinedMsg.replace("{item}", String(o.title_guest)).replace("{reason}", reason.trim() ? ` ${reason.trim()}` : ""));
  });
}
