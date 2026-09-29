import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getReservation } from "@/lib/reservations";
import { db } from "@/lib/db";
import { folioView } from "@/lib/folio-db";
import { getPmsT } from "@/lib/pms-lang";
import { pmsLocale, pmsStatus } from "@/lib/pms-i18n";
import { can } from "@/lib/security/permissions";
import { stayDates } from "@/lib/folio";
import { ReservationManager } from "./reservation-manager";
import { FolioPanel } from "./folio-panel";
import { CheckinCard, type Checkin } from "./checkin-card";
import { ArrivalCard } from "./arrival-card";
import { UpsellPanel } from "./upsell-panel";
import { reservationUpsell } from "@/lib/upsell-db";
import { arrivalInstructions } from "@/lib/arrival";
import { loadArrivalSettings } from "@/lib/arrival-db";
import { env } from "@/lib/env";
import { decryptField } from "@/lib/security/encryption";

function maskDocument(ciphertext: string): string {
  const key = env().PMS_DOCUMENT_KEY;
  if (!ciphertext || !key) return "••••";
  try {
    const value = decryptField(ciphertext, key);
    return `••••${value.slice(-3)}`;
  } catch {
    return "••••";
  }
}

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const id = Number((await params).id);
  const data = await getReservation(user.ownerId, id);
  if (!data) notFound();
  const b = data.booking as typeof data.booking & { folio_initialized_at: number | null; created_at: number };
  const financial = can(user.role, "folios.read", user.permissions);
  const folio = financial ? await folioView(db(), user.ownerId, b) : null;
  const ci = (await db().query(`SELECT * FROM guest_checkins WHERE owner_id=$1 AND booking_id=$2 ORDER BY submitted_at DESC LIMIT 1`, [user.ownerId, id])).rows[0];
  const checkin: Checkin | null = ci ? { submitted_at: Number(ci.submitted_at), first_name: ci.first_name, last_name: ci.last_name, email: ci.email, phone: ci.phone, arrival_time: ci.arrival_time, travel_details: ci.travel_details, special_requests: ci.special_requests, luggage_assistance: Number(ci.luggage_assistance), document_type: ci.document_type, masked: ci.identity_purged_at ? "" : maskDocument(ci.document_number), preferred_language: ci.preferred_language, email_marketing_consent: Number(ci.email_marketing_consent), whatsapp_marketing_consent: Number(ci.whatsapp_marketing_consent), purged: Boolean(ci.identity_purged_at) } : null;
  const arrivalSettings = await loadArrivalSettings(db(), user.ownerId);
  const hubName = (mode: string | null, hub: string | null) => (mode && hub ? arrivalInstructions(arrivalSettings, mode, hub, lang)?.hubName ?? hub : null);
  const transfers = (await db().query(`SELECT * FROM transfer_requests WHERE owner_id=$1 AND booking_id=$2 ORDER BY id DESC`, [user.ownerId, id])).rows.map((r) => ({ id: Number(r.id), arrival_mode: r.arrival_mode, hub_name: hubName(r.arrival_mode, r.arrival_hub) ?? r.arrival_hub, vehicle_name: r.vehicle_name, passengers: Number(r.passengers), price_cents: Number(r.price_cents), arrival_time: r.arrival_time, travel_details: r.travel_details, folio_entry_id: r.folio_entry_id ? Number(r.folio_entry_id) : null, status: r.status }));
  const upsell = financial && ["confirmed", "checked_in"].includes(b.status) ? await reservationUpsell(user.ownerId, { id: b.id, guest_email: b.guest_email, adults: Number(b.adults), children: Number(b.children), check_in: b.check_in, check_out: b.check_out, created_at: Number(b.created_at) }) : null;
  const money = (cents: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("res.title")}</h1><p>{b.reference} · {b.guest_name}</p></div><span className={`status ${b.status}`}>{pmsStatus(lang, b.status)}</span></div>
      <div className="detailGrid">
        <article><h2>{t("res.guest")}</h2><dl><dt>Email</dt><dd>{b.guest_email ?? "—"}</dd><dt>{t("res.phone")}</dt><dd>{b.guest_phone || "—"}</dd><dt>{t("res.country")}</dt><dd>{b.guest_country || "—"}</dd><dt>{t("res.language")}</dt><dd>{b.guest_language}</dd></dl></article>
        <article><h2>{t("res.stay")}</h2><dl><dt>{t("res.room")}</dt><dd>{b.room_code ?? "—"} · {b.room_type ?? t("res.noRoom")}</dd><dt>{t("res.arrival")}</dt><dd>{b.check_in}</dd><dt>{t("res.departure")}</dt><dd>{b.check_out}</dd><dt>{t("res.nights")}</dt><dd>{stayDates(b.check_in, b.check_out).length}</dd><dt>{t("res.adultsChildren")}</dt><dd>{b.adults} / {b.children}</dd><dt>{t("res.channel")}</dt><dd>{b.channel}</dd></dl></article>
        <article><h2>{t("res.payment")}</h2><dl>{financial && <><dt>{t("res.total")}</dt><dd>{money(b.total_cents)}</dd><dt>{t("res.balance")}</dt><dd>{money(b.balance_cents)}</dd></>}<dt>{t("res.plan")}</dt><dd>{b.rate_policy}</dd><dt>{t("res.freeCancel")}</dt><dd>{t("res.days", { n: b.cancellation_days })}</dd></dl></article>
        <article><h2>{t("res.extraInfo")}</h2><p>{b.special_requests || t("res.noRequests")}</p></article>
        <CheckinCard lang={lang} bookingId={b.id} checkin={checkin} canReveal={can(user.role, "reservations.edit", user.permissions)} />
        {upsell && <UpsellPanel lang={lang} bookingId={b.id} stays={upsell.stays} suggestions={upsell.suggestions} canAdd={can(user.role, "folios.write", user.permissions)} />}
        {(ci?.arrival_mode || transfers.length > 0) && <ArrivalCard lang={lang} bookingId={b.id} mode={ci?.arrival_mode ?? null} hubName={hubName(ci?.arrival_mode ?? null, ci?.arrival_hub ?? null)} initial={transfers} canEdit={can(user.role, "reservations.edit", user.permissions)} />}
      </div>
      <ReservationManager lang={lang} booking={b} canDelete={can(user.role, "reservations.delete", user.permissions)} canEdit={can(user.role, "reservations.edit", user.permissions)} canLinks={can(user.role, "reservations.write", user.permissions)} />
      {folio ? <FolioPanel lang={lang} bookingId={b.id} reference={b.reference} guestName={b.guest_name} initial={folio} canWrite={can(user.role, "folios.write", user.permissions)} canEditRates={can(user.role, "folios.write", user.permissions) && can(user.role, "reservations.edit", user.permissions)} /> : <article className="wide"><p>{t("folio.noAccess")}</p></article>}
      <article className="wide"><h2>{t("res.history")}</h2><ul>{data.audit.map((a) => <li key={a.id}>{new Date(Number(a.created_at)).toLocaleString(pmsLocale(lang))} · {a.action} · {t("res.byUser", { id: a.actor_id })}</li>)}</ul></article>
    </section>
  );
}
