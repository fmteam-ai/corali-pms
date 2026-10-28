// Partner businesses in the database: managed in the PMS (details, catalogue, logins, offer approval, commission),
// used by each business in its partner app (/partner: orders, catalogue, offers, guest pass check) and by guests in
// "My booking" (browse, order, guest pass). Payment is always at the business: cash, POS or a payment link it sends.
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import webpush from "web-push";
import { after } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { documentKey, env } from "@/lib/env";
import { matchPassCode, passCode, passQr, PASS_WINDOW_MS, verifyPassQr } from "@/lib/guest-pass-core";
import { sendGuestPush } from "@/lib/guest-push";
import { canUse, categoryLabels, commissionable, offerOpen, nextStatuses, priceOrder, sortPartners, type ItemInput, type OfferInput, type OrderInput, type PartnerCategory, type PartnerInput } from "@/lib/partners-core";
import { pushNotification } from "@/lib/pms-notifications";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { hashToken, newOpaqueToken } from "@/lib/security/tokens";
import { vapidPublicKey } from "@/lib/staff-push";
import { hotelToday } from "@/lib/tape-chart";
import { hotelTime } from "@/lib/tv";

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const pickLang = (el: string, en: string, lang: string) => (lang === "el" ? el || en : en || el);
type Row = Record<string, unknown>;

// ───────────────────────────── PMS ─────────────────────────────

export type PartnerView = PartnerInput & { id: number; logo: string | null; items: ItemView[]; users: { id: number; email: string; name: string; active: boolean; lastLoginAt: number | null }[]; openOrders: number };
export type ItemView = { id: number; section: string; nameEl: string; nameEn: string; description: string; priceCents: number; active: boolean; sortOrder: number };
export type OfferView = { id: number; partnerId: number; partner: string; titleEl: string; titleEn: string; bodyEl: string; bodyEn: string; discountPercent: number | null; code: string | null; startsOn: string; endsOn: string; guestsOnly: boolean; maxUses: number | null; timeFrom: string; timeTo: string; status: string; rejectReason: string; createdAt: number };

const partnerView = (p: Row): PartnerInput & { id: number; logo: string | null } => ({
  id: Number(p.id), name: String(p.name), category: String(p.category) as PartnerCategory, descriptionEl: String(p.description_el), descriptionEn: String(p.description_en),
  phone: String(p.phone), email: String(p.email), address: String(p.address), website: String(p.website), menuUrl: String(p.menu_url), hours: String(p.hours),
  delivery: Number(p.delivery) === 1, pickup: Number(p.pickup) === 1, acceptsCash: Number(p.accepts_cash) === 1, acceptsPos: Number(p.accepts_pos) === 1, acceptsLink: Number(p.accepts_link) === 1,
  commissionPercent: Number(p.commission_percent), active: Number(p.active) === 1, sortOrder: Number(p.sort_order), logo: p.logo_data ? String(p.logo_data) : null,
});
const itemView = (i: Row): ItemView => ({ id: Number(i.id), section: String(i.section), nameEl: String(i.name_el), nameEn: String(i.name_en), description: String(i.description), priceCents: Number(i.price_cents), active: Number(i.active) === 1, sortOrder: Number(i.sort_order) });
const offerView = (o: Row): OfferView => ({ id: Number(o.id), partnerId: Number(o.partner_id), partner: String(o.partner_name ?? ""), titleEl: String(o.title_el), titleEn: String(o.title_en), bodyEl: String(o.body_el), bodyEn: String(o.body_en), discountPercent: o.discount_percent === null ? null : Number(o.discount_percent), code: o.code ? String(o.code) : null, startsOn: String(o.starts_on), endsOn: String(o.ends_on), guestsOnly: Number(o.guests_only) === 1, maxUses: o.max_uses === null || o.max_uses === undefined ? null : Number(o.max_uses), timeFrom: String(o.time_from ?? ""), timeTo: String(o.time_to ?? ""), status: String(o.status), rejectReason: String(o.reject_reason), createdAt: Number(o.created_at) });

export async function listPartners(ownerId: string): Promise<PartnerView[]> {
  const [ps, items, users, open] = await Promise.all([
    db().query(`SELECT * FROM partners WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY sort_order,name`, [ownerId]),
    db().query(`SELECT * FROM partner_items WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY section,sort_order,id`, [ownerId]),
    db().query(`SELECT id,partner_id,email,display_name,active,last_login_at FROM partner_users WHERE owner_id=$1 ORDER BY id`, [ownerId]),
    db().query(`SELECT partner_id,count(*)::int n FROM partner_orders WHERE owner_id=$1 AND status IN ('placed','accepted','ready') GROUP BY partner_id`, [ownerId]),
  ]);
  return ps.rows.map((p) => ({
    ...partnerView(p),
    items: items.rows.filter((i) => Number(i.partner_id) === Number(p.id)).map(itemView),
    users: users.rows.filter((u) => Number(u.partner_id) === Number(p.id)).map((u) => ({ id: Number(u.id), email: String(u.email), name: String(u.display_name), active: Number(u.active) === 1, lastLoginAt: u.last_login_at ? Number(u.last_login_at) : null })),
    openOrders: Number(open.rows.find((o) => Number(o.partner_id) === Number(p.id))?.n ?? 0),
  }));
}

export async function savePartner(ownerId: string, x: PartnerInput, id?: number): Promise<number> {
  const v = [x.name, x.category, x.descriptionEl, x.descriptionEn, x.phone, x.email, x.address, x.website, x.menuUrl, x.hours, x.delivery ? 1 : 0, x.pickup ? 1 : 0, x.acceptsCash ? 1 : 0, x.acceptsPos ? 1 : 0, x.acceptsLink ? 1 : 0, x.commissionPercent, x.active ? 1 : 0, x.sortOrder, Date.now(), ownerId];
  if (id) {
    const r = await db().query(`UPDATE partners SET name=$1,category=$2,description_el=$3,description_en=$4,phone=$5,email=$6,address=$7,website=$8,menu_url=$9,hours=$10,delivery=$11,pickup=$12,accepts_cash=$13,accepts_pos=$14,accepts_link=$15,commission_percent=$16,active=$17,sort_order=$18,updated_at=$19 WHERE owner_id=$20 AND id=$21 AND deleted_at IS NULL`, v.concat(id));
    if (!r.rowCount) throw Error("NOT_FOUND");
    return id;
  }
  const r = await db().query(`INSERT INTO partners(name,category,description_el,description_en,phone,email,address,website,menu_url,hours,delivery,pickup,accepts_cash,accepts_pos,accepts_link,commission_percent,active,sort_order,updated_at,owner_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$19) RETURNING id`, v);
  return Number(r.rows[0].id);
}

export async function removePartner(ownerId: string, id: number): Promise<void> {
  await db().query(`UPDATE partners SET deleted_at=$3,active=0 WHERE owner_id=$1 AND id=$2`, [ownerId, id, Date.now()]);
  await db().query(`UPDATE partner_users SET active=0 WHERE owner_id=$1 AND partner_id=$2`, [ownerId, id]);
  await db().query(`DELETE FROM partner_sessions WHERE owner_id=$1 AND partner_user_id IN (SELECT id FROM partner_users WHERE owner_id=$1 AND partner_id=$2)`, [ownerId, id]);
}

/** Logo: any image → 256 px PNG / JPEG kept as a data URL (shown in the guest portal). */
export async function setPartnerLogo(ownerId: string, id: number, base64: string | null): Promise<void> {
  let data: string | null = null;
  if (base64) {
    const out = await sharp(Buffer.from(base64, "base64"), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
    data = `data:image/png;base64,${out.toString("base64")}`;
  }
  await db().query(`UPDATE partners SET logo_data=$3,updated_at=$4 WHERE owner_id=$1 AND id=$2`, [ownerId, id, data, Date.now()]);
}

export async function saveItem(ownerId: string, partnerId: number, x: ItemInput, id?: number): Promise<number> {
  if (!(await db().query(`SELECT 1 FROM partners WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, partnerId])).rowCount) throw Error("NOT_FOUND");
  const v = [x.section, x.nameEl, x.nameEn, x.description, Math.round(x.priceEur * 100), x.active ? 1 : 0, x.sortOrder, Date.now(), ownerId, partnerId];
  if (id) {
    const r = await db().query(`UPDATE partner_items SET section=$1,name_el=$2,name_en=$3,description=$4,price_cents=$5,active=$6,sort_order=$7,updated_at=$8 WHERE owner_id=$9 AND partner_id=$10 AND id=$11 AND deleted_at IS NULL`, v.concat(id));
    if (!r.rowCount) throw Error("NOT_FOUND");
    return id;
  }
  return Number((await db().query(`INSERT INTO partner_items(section,name_el,name_en,description,price_cents,active,sort_order,updated_at,owner_id,partner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, v)).rows[0].id);
}

export async function removeItem(ownerId: string, partnerId: number, id: number): Promise<void> {
  await db().query(`UPDATE partner_items SET deleted_at=$4 WHERE owner_id=$1 AND partner_id=$2 AND id=$3`, [ownerId, partnerId, id, Date.now()]);
}

const newPassword = () => randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 12);

/** A login for the business's app; the password is shown once in the PMS. */
export async function createPartnerUser(ownerId: string, partnerId: number, email: string, name: string): Promise<string> {
  if (!(await db().query(`SELECT 1 FROM partners WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [ownerId, partnerId])).rowCount) throw Error("NOT_FOUND");
  const password = newPassword();
  const r = await db().query(`INSERT INTO partner_users(owner_id,partner_id,email,display_name,password_hash,created_at) VALUES($1,$2,lower($3),$4,$5,$6) ON CONFLICT(owner_id,email) DO NOTHING`, [ownerId, partnerId, email.trim(), name.trim().slice(0, 80), await hashPassword(password), Date.now()]);
  if (!r.rowCount) throw Error("EMAIL_TAKEN");
  return password;
}

export async function resetPartnerPassword(ownerId: string, userId: number): Promise<string> {
  const password = newPassword();
  const r = await db().query(`UPDATE partner_users SET password_hash=$3,active=1 WHERE owner_id=$1 AND id=$2`, [ownerId, userId, await hashPassword(password)]);
  if (!r.rowCount) throw Error("NOT_FOUND");
  await db().query(`DELETE FROM partner_sessions WHERE owner_id=$1 AND partner_user_id=$2`, [ownerId, userId]);
  return password;
}

export async function setPartnerUserActive(ownerId: string, userId: number, active: boolean): Promise<void> {
  await db().query(`UPDATE partner_users SET active=$3 WHERE owner_id=$1 AND id=$2`, [ownerId, userId, active ? 1 : 0]);
  if (!active) await db().query(`DELETE FROM partner_sessions WHERE owner_id=$1 AND partner_user_id=$2`, [ownerId, userId]);
}

export async function listOffers(ownerId: string, partnerId?: number): Promise<OfferView[]> {
  const r = await db().query(`SELECT o.*,p.name partner_name FROM partner_offers o JOIN partners p ON p.owner_id=o.owner_id AND p.id=o.partner_id WHERE o.owner_id=$1 AND ($2::bigint IS NULL OR o.partner_id=$2) AND (o.status='pending' OR o.ends_on>=$3) ORDER BY (o.status='pending') DESC, o.created_at DESC LIMIT 200`, [ownerId, partnerId ?? null, hotelToday()]);
  return r.rows.map(offerView);
}

/** The hotel approves (guests see it) or rejects (with a reason the business sees). */
export async function decideOffer(ownerId: string, id: number, approve: boolean, reason: string, userId: number): Promise<void> {
  const r = await db().query(`UPDATE partner_offers SET status=$3,reject_reason=$4,decided_by=$5,decided_at=$6 WHERE owner_id=$1 AND id=$2 AND status IN ('pending','approved') RETURNING partner_id,title_el,title_en`, [ownerId, id, approve ? "approved" : "rejected", approve ? "" : reason.slice(0, 300), userId, Date.now()]);
  if (!r.rowCount) throw Error("NOT_FOUND");
  const o = r.rows[0];
  partnerPushAfter(ownerId, Number(o.partner_id), { title: approve ? "✅ Η προσφορά εγκρίθηκε" : "❌ Η προσφορά απορρίφθηκε", body: `${o.title_el || o.title_en}${!approve && reason ? ` — ${reason}` : ""}`, url: "/partner?tab=offers" });
}

/** Commission per business for a month (YYYY-MM): completed orders and recorded guest-offer uses. */
export async function commissionReport(ownerId: string, month: string) {
  const from = Date.parse(`${month}-01T00:00:00Z`), to = Date.parse(`${month}-01T00:00:00Z`) + 32 * 86_400_000;
  const end = new Date(to); end.setUTCDate(1); const until = end.getTime();
  const [orders, uses] = await Promise.all([
    db().query(`SELECT partner_id,count(*)::int n,COALESCE(sum(total_cents),0)::bigint total,COALESCE(sum(commission_cents),0)::bigint commission FROM partner_orders WHERE owner_id=$1 AND status='completed' AND created_at>=$2 AND created_at<$3 GROUP BY partner_id`, [ownerId, from, until]),
    db().query(`SELECT partner_id,count(*)::int n,COALESCE(sum(amount_cents),0)::bigint total,COALESCE(sum(commission_cents),0)::bigint commission FROM partner_redemptions WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 GROUP BY partner_id`, [ownerId, from, until]),
  ]);
  const ps = (await db().query(`SELECT id,name,commission_percent FROM partners WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY name`, [ownerId])).rows;
  return ps.map((p) => {
    const o = orders.rows.find((x) => Number(x.partner_id) === Number(p.id)), u = uses.rows.find((x) => Number(x.partner_id) === Number(p.id));
    return { partnerId: Number(p.id), name: String(p.name), percent: Number(p.commission_percent), orders: Number(o?.n ?? 0), ordersTotalCents: Number(o?.total ?? 0), uses: Number(u?.n ?? 0), usesTotalCents: Number(u?.total ?? 0), commissionCents: Number(o?.commission ?? 0) + Number(u?.commission ?? 0) };
  });
}

export type OrderView = { id: number; partnerId: number; partner: string; reference: string; guest: string; room: string | null; lines: { name: string; qty: number; priceCents: number }[]; subtotalCents: number; discountCents: number; code: string | null; totalCents: number; commissionCents: number; fulfilment: string; wantedAt: string; note: string; payMethod: string; paymentLink: string; paid: boolean; status: string; partnerNote: string; createdAt: number; updatedAt: number };
const orderView = (o: Row): OrderView => ({
  id: Number(o.id), partnerId: Number(o.partner_id), partner: String(o.partner_name ?? ""), reference: String(o.reference ?? ""), guest: String(o.guest_name ?? ""), room: o.room_code ? String(o.room_code) : null,
  lines: (() => { try { return JSON.parse(String(o.items_json)); } catch { return []; } })(), subtotalCents: Number(o.subtotal_cents), discountCents: Number(o.discount_cents), code: o.code ? String(o.code) : null, totalCents: Number(o.total_cents), commissionCents: Number(o.commission_cents),
  fulfilment: String(o.fulfilment), wantedAt: String(o.wanted_at), note: String(o.note), payMethod: String(o.pay_method), paymentLink: String(o.payment_link), paid: Number(o.paid) === 1, status: String(o.status), partnerNote: String(o.partner_note), createdAt: Number(o.created_at), updatedAt: Number(o.updated_at),
});
const ORDER_SQL = `SELECT o.*,p.name partner_name,b.reference,b.guest_name,r.code room_code FROM partner_orders o JOIN partners p ON p.owner_id=o.owner_id AND p.id=o.partner_id JOIN bookings b ON b.owner_id=o.owner_id AND b.id=o.booking_id LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id`;

export async function listPartnerOrders(ownerId: string, partnerId?: number): Promise<OrderView[]> {
  const r = await db().query(`${ORDER_SQL} WHERE o.owner_id=$1 AND ($2::bigint IS NULL OR o.partner_id=$2) AND (o.status IN ('placed','accepted','ready') OR o.created_at>$3) ORDER BY (o.status IN ('placed','accepted','ready')) DESC, o.created_at DESC LIMIT 300`, [ownerId, partnerId ?? null, Date.now() - 30 * 86_400_000]);
  return r.rows.map(orderView);
}

/** On / off switch of the whole feature (PMS → Partner businesses); off until the hotel turns it on. */
export async function partnersEnabled(ownerId: string): Promise<boolean> {
  return Number((await db().query(`SELECT enabled FROM partner_settings WHERE owner_id=$1`, [ownerId])).rows[0]?.enabled ?? 0) === 1;
}
export async function setPartnersEnabled(ownerId: string, enabled: boolean): Promise<void> {
  await db().query(`INSERT INTO partner_settings(owner_id,enabled,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at`, [ownerId, enabled ? 1 : 0, Date.now()]);
}
/**
 * Partners for a room TV (prepared for a later TV tab and for the TV assistant): the same sorted list as "My booking",
 * hotel-guest offers first, only when the feature is on and "show on TV" is set.
 */
export async function tvPartners(ownerId: string, lang: string): Promise<GuestPartner[]> {
  const r = (await db().query(`SELECT enabled,show_on_tv FROM partner_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  return Number(r?.enabled) === 1 && Number(r?.show_on_tv) === 1 ? guestPartners(ownerId, lang) : [];
}
const ENABLED_SQL = "EXISTS(SELECT 1 FROM partner_settings ps WHERE ps.owner_id=u.owner_id AND ps.enabled=1)";

// ───────────────────────────── partner app ─────────────────────────────

export type PartnerSession = { ownerId: string; partnerId: number; userId: number; name: string; partner: string };
export const partnerCookie = "corali_partner";

export async function partnerLogin(email: string, password: string): Promise<{ token: string; expiresAt: number } | null> {
  const u = (await db().query(`SELECT u.* FROM partner_users u JOIN partners p ON p.owner_id=u.owner_id AND p.id=u.partner_id WHERE u.owner_id=$1 AND u.email=lower($2) AND u.active=1 AND ${ENABLED_SQL} AND p.deleted_at IS NULL AND p.active=1`, [env().PMS_OWNER_ID, email.trim()])).rows[0];
  if (!u || !(await verifyPassword(String(u.password_hash), password))) return null;
  const token = newOpaqueToken(), expiresAt = Date.now() + 60 * 86_400_000;
  await db().query(`INSERT INTO partner_sessions(token_hash,owner_id,partner_user_id,expires_at,created_at) VALUES($1,$2,$3,$4,$5)`, [hashToken(token), u.owner_id, u.id, expiresAt, Date.now()]);
  await db().query(`UPDATE partner_users SET last_login_at=$2 WHERE id=$1`, [u.id, Date.now()]);
  return { token, expiresAt };
}

export async function partnerSession(token: string | undefined): Promise<PartnerSession | null> {
  if (!token || token.length < 32 || token.length > 200) return null;
  const r = (await db().query(
    `SELECT u.owner_id,u.partner_id,u.id,u.display_name,u.email,p.name FROM partner_sessions s JOIN partner_users u ON u.id=s.partner_user_id AND u.owner_id=s.owner_id JOIN partners p ON p.owner_id=u.owner_id AND p.id=u.partner_id
      WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active=1 AND ${ENABLED_SQL} AND p.active=1 AND p.deleted_at IS NULL`,
    [hashToken(token), Date.now()],
  )).rows[0];
  return r ? { ownerId: String(r.owner_id), partnerId: Number(r.partner_id), userId: Number(r.id), name: String(r.display_name || r.email), partner: String(r.name) } : null;
}

export async function partnerLogout(token: string): Promise<void> {
  await db().query(`DELETE FROM partner_sessions WHERE token_hash=$1`, [hashToken(token)]);
}

export async function partnerHome(s: PartnerSession) {
  const p = (await db().query(`SELECT * FROM partners WHERE owner_id=$1 AND id=$2`, [s.ownerId, s.partnerId])).rows[0];
  const items = (await db().query(`SELECT * FROM partner_items WHERE owner_id=$1 AND partner_id=$2 AND deleted_at IS NULL ORDER BY section,sort_order,id`, [s.ownerId, s.partnerId])).rows.map(itemView);
  const uses = (await db().query(`SELECT r.created_at,r.amount_cents,o.title_el,o.title_en FROM partner_redemptions r LEFT JOIN partner_offers o ON o.id=r.offer_id WHERE r.owner_id=$1 AND r.partner_id=$2 ORDER BY r.id DESC LIMIT 30`, [s.ownerId, s.partnerId])).rows;
  return {
    me: { name: s.name, partner: s.partner }, partner: partnerView(p), items, offers: await listOffers(s.ownerId, s.partnerId), orders: await listPartnerOrders(s.ownerId, s.partnerId),
    uses: uses.map((u) => ({ at: Number(u.created_at), amountCents: u.amount_cents === null ? null : Number(u.amount_cents), offer: String(u.title_el || u.title_en || "") })),
    vapidPublicKey: await vapidPublicKey(s.ownerId),
  };
}

/** The business proposes an offer / discount code; it waits for the hotel's approval. */
export async function proposeOffer(s: PartnerSession, x: OfferInput): Promise<number> {
  if (x.code && (await db().query(`SELECT 1 FROM partner_offers WHERE owner_id=$1 AND upper(code)=$2 AND status IN ('pending','approved') AND ends_on>=$3`, [s.ownerId, x.code, hotelToday()])).rowCount) throw Error("CODE_TAKEN");
  return withTransaction(async (c) => {
    const r = await c.query(`INSERT INTO partner_offers(owner_id,partner_id,title_el,title_en,body_el,body_en,discount_percent,code,starts_on,ends_on,guests_only,max_uses,time_from,time_to,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [s.ownerId, s.partnerId, x.titleEl, x.titleEn, x.bodyEl, x.bodyEn, x.discountPercent, x.code || null, x.startsOn, x.endsOn, x.guestsOnly ? 1 : 0, x.maxUses, x.timeFrom, x.timeTo, s.userId, Date.now()]);
    await pushNotification(c, s.ownerId, { kind: "system", titleEl: `🏷️ ${s.partner}: νέα προσφορά για έγκριση — «${x.titleEl || x.titleEn}»`, titleEn: `🏷️ ${s.partner}: new offer to approve — “${x.titleEn || x.titleEl}”`, link: "/pms/partners?tab=offers" });
    return Number(r.rows[0].id);
  });
}

export async function withdrawOffer(s: PartnerSession, id: number): Promise<void> {
  await db().query(`UPDATE partner_offers SET status='withdrawn' WHERE owner_id=$1 AND partner_id=$2 AND id=$3 AND status IN ('pending','approved')`, [s.ownerId, s.partnerId, id]);
}

const guestStatus: Record<string, Record<string, string>> = {
  accepted: { el: "Η παραγγελία σας έγινε δεκτή", en: "Your order was accepted", fr: "Votre commande est acceptée", de: "Ihre Bestellung wurde angenommen", it: "Il tuo ordine è stato accettato", es: "Su pedido fue aceptado" },
  ready: { el: "Η παραγγελία σας είναι έτοιμη", en: "Your order is ready", fr: "Votre commande est prête", de: "Ihre Bestellung ist fertig", it: "Il tuo ordine è pronto", es: "Su pedido está listo" },
  completed: { el: "Η παραγγελία ολοκληρώθηκε — ευχαριστούμε!", en: "Order completed — thank you!", fr: "Commande terminée — merci !", de: "Bestellung abgeschlossen — danke!", it: "Ordine completato — grazie!", es: "Pedido completado — ¡gracias!" },
  declined: { el: "Η παραγγελία σας δεν έγινε δεκτή", en: "Your order was declined", fr: "Votre commande a été refusée", de: "Ihre Bestellung wurde abgelehnt", it: "Il tuo ordine è stato rifiutato", es: "Su pedido fue rechazado" },
  cancelled: { el: "Η παραγγελία σας ακυρώθηκε", en: "Your order was cancelled", fr: "Votre commande a été annulée", de: "Ihre Bestellung wurde storniert", it: "Il tuo ordine è stato annullato", es: "Su pedido fue cancelado" },
  link: { el: "Σύνδεσμος πληρωμής για την παραγγελία σας", en: "Payment link for your order", fr: "Lien de paiement pour votre commande", de: "Zahlungslink für Ihre Bestellung", it: "Link di pagamento per il tuo ordine", es: "Enlace de pago de su pedido" },
};

/** The business moves an order on (accept → ready → completed, or decline / cancel), sends a payment link, marks it paid. */
export async function updatePartnerOrder(s: PartnerSession, id: number, x: { status?: string; paymentLink?: string; paid?: boolean; note?: string }): Promise<void> {
  const o = (await db().query(`SELECT * FROM partner_orders WHERE owner_id=$1 AND partner_id=$2 AND id=$3`, [s.ownerId, s.partnerId, id])).rows[0];
  if (!o) throw Error("NOT_FOUND");
  if (x.status && !nextStatuses(String(o.status)).includes(x.status as never)) throw Error("STEP");
  if (x.paymentLink !== undefined && x.paymentLink && !/^https:\/\/[^\s]{6,500}$/.test(x.paymentLink)) throw Error("LINK");
  await db().query(
    `UPDATE partner_orders SET status=COALESCE($4,status),payment_link=COALESCE($5,payment_link),paid=COALESCE($6,paid),partner_note=COALESCE($7,partner_note),updated_at=$8 WHERE owner_id=$1 AND partner_id=$2 AND id=$3`,
    [s.ownerId, s.partnerId, id, x.status ?? null, x.paymentLink ?? null, x.paid === undefined ? null : x.paid ? 1 : 0, x.note === undefined ? null : x.note.slice(0, 300), Date.now()],
  );
  const what = x.status ?? (x.paymentLink ? "link" : null);
  if (what && guestStatus[what]) {
    after(() => sendGuestPush(s.ownerId, [Number(o.booking_id)], (lang) => ({ title: `${s.partner}`, body: `${guestStatus[what][lang] ?? guestStatus[what].en}${x.note ? ` — ${x.note}` : ""}`, tag: `partner-order-${id}`, url: `/manage-booking?app=1&lang=${lang}#partners` })).then(() => undefined));
  }
}

/** Guest pass check at the business: QR text or the 6 digits → the guest's first name and stay, or null. */
export async function checkGuestPass(s: PartnerSession, input: string): Promise<{ bookingId: number; firstName: string; checkOut: string; offers: { id: number; title: string; discountPercent: number | null; maxUses: number | null; used: number; available: boolean }[] } | null> {
  if (!(await allowCheck(s))) throw Error("TOO_MANY");
  const secret = documentKey(), now = Date.now(), today = hotelToday();
  const inHouse = (await db().query(`SELECT id,guest_name,check_out FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in') AND check_in<=$2 AND check_out>=$2`, [s.ownerId, today])).rows;
  const v = input.trim();
  const id = v.startsWith("CORALI-GP:") ? verifyPassQr(secret, v, now) : matchPassCode(secret, v.replace(/\s/g, ""), inHouse.map((b) => Number(b.id)), now);
  const b = id ? inHouse.find((x) => Number(x.id) === id) : null;
  if (!b) return null;
  const offers = (await db().query(`SELECT id,title_el,title_en,discount_percent,max_uses,starts_on,ends_on,time_from,time_to FROM partner_offers WHERE owner_id=$1 AND partner_id=$2 AND status='approved' AND guests_only=1 AND starts_on<=$3 AND ends_on>=$3 ORDER BY id`, [s.ownerId, s.partnerId, today])).rows.filter((o) => offerOpen({ startsOn: String(o.starts_on), endsOn: String(o.ends_on), timeFrom: String(o.time_from), timeTo: String(o.time_to) }, today, hotelTime()));
  const used = await usesByBooking(s.ownerId, Number(b.id));
  return { bookingId: Number(b.id), firstName: String(b.guest_name).trim().split(/\s+/)[0] ?? "", checkOut: String(b.check_out), offers: offers.map((o) => { const max = o.max_uses === null ? null : Number(o.max_uses), n = used[Number(o.id)] ?? 0; return { id: Number(o.id), title: String(o.title_el || o.title_en), discountPercent: o.discount_percent === null ? null : Number(o.discount_percent), maxUses: max, used: n, available: canUse(max, n) }; }) };
}

async function allowCheck(s: PartnerSession) {
  const { allowAttempt } = await import("@/lib/request-limit");
  return allowAttempt(`guest-pass:${s.partnerId}`, 40, 10 * 60_000, 10 * 60_000);
}

/** Record that a hotel guest used an offer (optional bill amount → commission). The pass is checked again. */
export async function recordRedemption(s: PartnerSession, x: { pass: string; offerId: number | null; amountEur: number | null }): Promise<void> {
  const g = await checkGuestPass(s, x.pass);
  if (!g) throw Error("PASS");
  if (x.offerId !== null && !g.offers.some((o) => o.id === x.offerId)) throw Error("OFFER");
  if (x.offerId !== null && !g.offers.find((o) => o.id === x.offerId)!.available) throw Error("USED");
  const p = (await db().query(`SELECT commission_percent FROM partners WHERE owner_id=$1 AND id=$2`, [s.ownerId, s.partnerId])).rows[0];
  const amount = x.amountEur === null ? null : Math.round(x.amountEur * 100);
  await db().query(`INSERT INTO partner_redemptions(owner_id,partner_id,booking_id,offer_id,amount_cents,commission_cents,partner_user_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [s.ownerId, s.partnerId, g.bookingId, x.offerId, amount, amount === null ? 0 : Math.round((amount * Number(p?.commission_percent ?? 0)) / 100), s.userId, Date.now()]);
}

export async function subscribePartner(s: PartnerSession, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await db().query(`INSERT INTO partner_push_subscriptions(owner_id,partner_user_id,endpoint,p256dh,auth,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(endpoint) DO UPDATE SET owner_id=$1,partner_user_id=$2,p256dh=$4,auth=$5,failures=0`, [s.ownerId, s.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now()]);
}

/** Notify everyone of a business who turned notifications on (new order, offer decision). After the response. */
export function partnerPushAfter(ownerId: string, partnerId: number, m: { title: string; body: string; url: string }): void {
  const run = async () => {
    try {
      const subs = (await db().query(`SELECT s.id,s.endpoint,s.p256dh,s.auth FROM partner_push_subscriptions s JOIN partner_users u ON u.id=s.partner_user_id AND u.owner_id=s.owner_id WHERE s.owner_id=$1 AND u.partner_id=$2 AND u.active=1`, [ownerId, partnerId])).rows;
      if (!subs.length) return;
      await vapidPublicKey(ownerId);
      const k = (await db().query(`SELECT public_key,private_key FROM push_vapid WHERE owner_id=$1`, [ownerId])).rows[0];
      const subject = env().BOOKING_ORIGIN.startsWith("https://") ? env().BOOKING_ORIGIN : "mailto:info@hotelcorali.gr";
      await Promise.all(subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ ...m, tag: m.url }), { vapidDetails: { subject, publicKey: k.public_key, privateKey: k.private_key }, TTL: 6 * 3600, urgency: "high", timeout: 10_000 });
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db().query(`DELETE FROM partner_push_subscriptions WHERE id=$1`, [sub.id]);
        }
      }));
    } catch (e) { console.error("Partner push failed", e); }
  };
  try { after(() => run()); } catch { void run(); }
}

/** How many times a booking has used each offer (orders not declined / cancelled, and recorded uses at the business). */
async function usesByBooking(ownerId: string, bookingId: number): Promise<Record<number, number>> {
  const r = await db().query(
    `SELECT offer_id,count(*)::int n FROM (SELECT offer_id FROM partner_orders WHERE owner_id=$1 AND booking_id=$2 AND offer_id IS NOT NULL AND status NOT IN ('declined','cancelled')
       UNION ALL SELECT offer_id FROM partner_redemptions WHERE owner_id=$1 AND booking_id=$2 AND offer_id IS NOT NULL) x GROUP BY offer_id`,
    [ownerId, bookingId],
  );
  return Object.fromEntries(r.rows.map((x) => [Number(x.offer_id), Number(x.n)]));
}

// ───────────────────────────── guests ─────────────────────────────

export type GuestPartner = { id: number; name: string; category: PartnerCategory; categoryLabel: string; icon: string; description: string; phone: string; address: string; website: string; menuUrl: string; hours: string; logo: string | null; delivery: boolean; pickup: boolean; payMethods: string[]; items: { id: number; section: string; name: string; description: string; priceCents: number }[]; offers: { id: number; title: string; body: string; discountPercent: number | null; code: string | null; endsOn: string; guestsOnly: boolean; maxUses: number | null; timeFrom: string; timeTo: string }[]; guestDiscount: number | null; sortOrder: number };

export async function guestPartners(ownerId: string, lang: string): Promise<GuestPartner[]> {
  const today = hotelToday();
  const [ps, items, offers] = await Promise.all([
    db().query(`SELECT * FROM partners WHERE owner_id=$1 AND active=1 AND deleted_at IS NULL`, [ownerId]),
    db().query(`SELECT * FROM partner_items WHERE owner_id=$1 AND active=1 AND deleted_at IS NULL ORDER BY section,sort_order,id`, [ownerId]),
    db().query(`SELECT * FROM partner_offers WHERE owner_id=$1 AND status='approved' AND starts_on<=$2 AND ends_on>=$2 ORDER BY discount_percent DESC NULLS LAST,id`, [ownerId, today]),
  ]);
  const list = ps.rows.map((p): GuestPartner => {
    const os = offers.rows.filter((o) => Number(o.partner_id) === Number(p.id)).map((o) => ({ id: Number(o.id), title: pickLang(String(o.title_el), String(o.title_en), lang), body: pickLang(String(o.body_el), String(o.body_en), lang), discountPercent: o.discount_percent === null ? null : Number(o.discount_percent), code: o.code ? String(o.code) : null, endsOn: String(o.ends_on), guestsOnly: Number(o.guests_only) === 1, maxUses: o.max_uses === null ? null : Number(o.max_uses), timeFrom: String(o.time_from), timeTo: String(o.time_to) }));
    const guestOffers = os.filter((o) => o.guestsOnly);
    const c = String(p.category) as PartnerCategory, label = categoryLabels[c] ?? categoryLabels.other;
    return {
      id: Number(p.id), name: String(p.name), category: c, categoryLabel: (label as Record<string, string>)[lang] ?? label.en, icon: label.icon,
      description: pickLang(String(p.description_el), String(p.description_en), lang), phone: String(p.phone), address: String(p.address), website: String(p.website), menuUrl: String(p.menu_url), hours: String(p.hours), logo: p.logo_data ? String(p.logo_data) : null,
      delivery: Number(p.delivery) === 1, pickup: Number(p.pickup) === 1, payMethods: [Number(p.accepts_cash) ? "cash" : "", Number(p.accepts_pos) ? "pos" : "", Number(p.accepts_link) ? "link" : ""].filter(Boolean),
      items: items.rows.filter((i) => Number(i.partner_id) === Number(p.id)).map((i) => ({ id: Number(i.id), section: String(i.section), name: pickLang(String(i.name_el), String(i.name_en), lang), description: String(i.description), priceCents: Number(i.price_cents) })),
      offers: os, guestDiscount: guestOffers.length ? Math.max(0, ...guestOffers.map((o) => o.discountPercent ?? 0)) : null, sortOrder: Number(p.sort_order),
    };
  });
  return sortPartners(list);
}

/** A guest orders from a business: priced on the server; the business is told (app notification). */
export async function placePartnerOrder(ownerId: string, booking: Row, lang: string, x: OrderInput): Promise<number> {
  const today = hotelToday();
  if (!(await partnersEnabled(ownerId))) throw Error("NOT_FOUND");
  if (!["confirmed", "checked_in"].includes(String(booking.status)) || String(booking.check_out) < today) throw Error("NOT_IN_HOUSE");
  const p = (await db().query(`SELECT * FROM partners WHERE owner_id=$1 AND id=$2 AND active=1 AND deleted_at IS NULL`, [ownerId, x.partnerId])).rows[0];
  if (!p) throw Error("NOT_FOUND");
  if ((x.fulfilment === "delivery" && !Number(p.delivery)) || (x.fulfilment === "pickup" && !Number(p.pickup))) throw Error("FULFILMENT");
  if (!Number({ cash: p.accepts_cash, pos: p.accepts_pos, link: p.accepts_link }[x.payMethod])) throw Error("PAYMENT");
  const items = (await db().query(`SELECT id,name_el,name_en,price_cents,active FROM partner_items WHERE owner_id=$1 AND partner_id=$2 AND deleted_at IS NULL`, [ownerId, x.partnerId])).rows.map((i) => ({ id: Number(i.id), name: pickLang(String(i.name_el), String(i.name_en), "el"), priceCents: Number(i.price_cents), active: Number(i.active) === 1 }));
  const offers = (await db().query(`SELECT id,discount_percent,code,starts_on,ends_on,status,max_uses,time_from,time_to FROM partner_offers WHERE owner_id=$1 AND partner_id=$2 AND status='approved'`, [ownerId, x.partnerId])).rows.map((o) => ({ id: Number(o.id), discountPercent: o.discount_percent === null ? null : Number(o.discount_percent), code: o.code ? String(o.code) : null, startsOn: String(o.starts_on), endsOn: String(o.ends_on), status: String(o.status), maxUses: o.max_uses === null ? null : Number(o.max_uses), timeFrom: String(o.time_from), timeTo: String(o.time_to) }));
  const priced = priceOrder(items, x.items, offers, x.code, today, Number(p.commission_percent), await usesByBooking(ownerId, Number(booking.id)), hotelTime());
  if (!priced.ok) throw Error(priced.error);
  const now = Date.now();
  const r = await db().query(
    `INSERT INTO partner_orders(owner_id,partner_id,booking_id,items_json,subtotal_cents,discount_cents,offer_id,code,total_cents,commission_percent,commission_cents,fulfilment,wanted_at,note,pay_method,lang,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id`,
    [ownerId, x.partnerId, booking.id, JSON.stringify(priced.lines.map((l) => ({ name: l.name, qty: l.qty, priceCents: l.priceCents }))), priced.subtotalCents, priced.discountCents, priced.offerId, x.code || null, priced.totalCents, Number(p.commission_percent), priced.commissionCents, x.fulfilment, x.wantedAt, x.note, x.payMethod, lang, now],
  );
  const id = Number(r.rows[0].id);
  partnerPushAfter(ownerId, x.partnerId, { title: `🛎️ Νέα παραγγελία · ${euro(priced.totalCents)}`, body: `${String(booking.guest_name)} · ${x.fulfilment === "delivery" ? "Παράδοση" : "Παραλαβή"}${x.wantedAt ? ` · ${x.wantedAt}` : ""}`, url: "/partner?tab=orders" });
  return id;
}

export async function guestPartnerOrders(ownerId: string, bookingId: number): Promise<OrderView[]> {
  return (await db().query(`${ORDER_SQL} WHERE o.owner_id=$1 AND o.booking_id=$2 ORDER BY o.created_at DESC LIMIT 50`, [ownerId, bookingId])).rows.map(orderView);
}

export async function guestCancelPartnerOrder(ownerId: string, bookingId: number, id: number): Promise<void> {
  const r = await db().query(`UPDATE partner_orders SET status='cancelled',updated_at=$4 WHERE owner_id=$1 AND booking_id=$2 AND id=$3 AND status='placed' RETURNING partner_id`, [ownerId, bookingId, id, Date.now()]);
  if (!r.rowCount) throw Error("TOO_LATE");
  partnerPushAfter(ownerId, Number(r.rows[0].partner_id), { title: "❌ Ακύρωση παραγγελίας", body: `#${id}`, url: "/partner?tab=orders" });
}

/** The guest pass shown in "My booking": QR + 6 digits for this minute, only during the stay. */
export function guestPass(booking: Row) {
  const now = Date.now(), secret = documentKey(), id = Number(booking.id);
  return { qr: passQr(secret, id, now), code: passCode(secret, id, now), firstName: String(booking.guest_name).trim().split(/\s+/)[0] ?? "", checkOut: String(booking.check_out), refreshInMs: PASS_WINDOW_MS - (now % PASS_WINDOW_MS) };
}

export { commissionable };
