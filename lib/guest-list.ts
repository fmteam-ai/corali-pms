// PMS → Bulk messages → «Λίστα επισκεπτών»: every e-mail guests typed in online check-in, built automatically, with
// the booking, the channel it came from and whether bulk messages may be sent to it (and why not).
import { db } from "@/lib/db";
import { hotelToday } from "@/lib/tape-chart";
import { audienceQuery, channelName, CHECKIN_EMAIL_JOIN, CHECKIN_PHONE_JOIN, GUEST_EMAIL_SQL, isOtaRelayEmail, VALID_EMAIL_SQL } from "../scripts/campaign-core.mjs";

export type GuestListStatus = "eligible" | "no_consent" | "unsubscribed" | "ota_address" | "future_stay";
export type WhatsAppListStatus = "eligible" | "no_consent" | "unsubscribed" | "no_phone" | "future_stay";
export type GuestListRow = {
  email: string; name: string; phone: string; country: string; language: string;
  bookings: number; reference: string; bookingId: number; checkIn: string; checkOut: string;
  channel: string; channelLabel: string; channels: string[]; consent: boolean; status: GuestListStatus;
  fromCheckin: boolean; whatsappConsent: boolean; whatsapp: WhatsAppListStatus;
};
export type GuestListFilter = "all" | GuestListStatus;

/** Why an address does or does not get bulk e-mails (the same rules as the campaign audience). */
export function guestStatus(x: { email: string; consent: boolean; unsubscribed: boolean; pastStays: number }): GuestListStatus {
  if (isOtaRelayEmail(x.email)) return "ota_address";
  if (x.unsubscribed) return "unsubscribed";
  if (!x.consent) return "no_consent";
  if (x.pastStays < 1) return "future_stay";
  return "eligible";
}

/** The same for bulk WhatsApp messages (the mobile typed in online check-in and the WhatsApp consent ticked there). */
export function whatsappStatus(x: { phone: string; consent: boolean; unsubscribed: boolean; pastStays: number }): WhatsAppListStatus {
  const digits = x.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "no_phone";
  if (x.unsubscribed) return "unsubscribed";
  if (!x.consent) return "no_consent";
  if (x.pastStays < 1) return "future_stay";
  return "eligible";
}

export async function guestList(ownerId: string, opts: { q?: string; filter?: GuestListFilter; limit?: number; lang?: string } = {}) {
  const today = hotelToday();
  const params: unknown[] = [ownerId, today];
  let search = "";
  const q = (opts.q ?? "").trim().toLowerCase().slice(0, 100);
  if (q) { params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); search = `WHERE (g.email LIKE $${params.length} OR lower(g.name) LIKE $${params.length} OR lower(g.reference) LIKE $${params.length} OR g.phone LIKE $${params.length})`; }
  const r = await db().query(
    `WITH b AS (
       SELECT b.id,${GUEST_EMAIL_SQL} email,true from_checkin,
         b.guest_name,coalesce(nullif(cp.phone,''),'') phone,coalesce(b.guest_country,'') country,coalesce(b.guest_language,'') language,b.reference,b.check_in,b.check_out,coalesce(nullif(b.external_channel,''),b.channel,'') channel,
         coalesce(ci.consent,0) consent,coalesce(cp.consent,0) wa_consent
       FROM bookings b ${CHECKIN_EMAIL_JOIN} ${CHECKIN_PHONE_JOIN} WHERE b.owner_id=$1 AND b.status NOT IN ('cancelled') AND ci.email IS NOT NULL),
     g AS (
       SELECT email,(array_agg(guest_name ORDER BY check_in DESC))[1] name,(array_agg(phone ORDER BY check_in DESC))[1] phone,(array_agg(country ORDER BY check_in DESC))[1] country,(array_agg(language ORDER BY check_in DESC))[1] language,
         count(*)::int bookings,(array_agg(reference ORDER BY check_in DESC))[1] reference,(array_agg(id ORDER BY check_in DESC))[1] booking_id,max(check_in) check_in,(array_agg(check_out ORDER BY check_in DESC))[1] check_out,
         (array_agg(channel ORDER BY check_in DESC))[1] channel,array_agg(DISTINCT channel) channels,coalesce(max(consent),0) consent,coalesce(max(wa_consent),0) wa_consent,bool_or(from_checkin) from_checkin,count(*) FILTER (WHERE check_out<=$2)::int past_stays
       FROM b WHERE email ~ ${VALID_EMAIL_SQL} GROUP BY email)
     SELECT g.*,EXISTS(SELECT 1 FROM marketing_unsubscribes u WHERE u.owner_id=$1 AND u.channel='email' AND u.address=g.email) unsubscribed,
       EXISTS(SELECT 1 FROM marketing_unsubscribes u WHERE u.owner_id=$1 AND u.channel='whatsapp' AND u.address=regexp_replace(g.phone,'[^0-9]','','g')) wa_unsubscribed
     FROM g ${search} ORDER BY g.check_in DESC LIMIT 5000`,
    params,
  );
  const lang = opts.lang === "en" ? "en" : "el";
  const all: GuestListRow[] = r.rows.map((x) => {
    const consent = Number(x.consent) === 1;
    return {
      email: String(x.email), name: String(x.name ?? ""), phone: String(x.phone ?? ""), country: String(x.country ?? ""), language: String(x.language ?? ""),
      bookings: Number(x.bookings), reference: String(x.reference ?? ""), bookingId: Number(x.booking_id), checkIn: String(x.check_in ?? ""), checkOut: String(x.check_out ?? ""),
      channel: String(x.channel ?? ""), channelLabel: channelName(x.channel, lang), channels: (x.channels as string[] | null ?? []).filter(Boolean).map((c) => channelName(c, lang)),
      consent, status: guestStatus({ email: String(x.email), consent, unsubscribed: Boolean(x.unsubscribed), pastStays: Number(x.past_stays) }),
      fromCheckin: Boolean(x.from_checkin), whatsappConsent: Number(x.wa_consent) === 1,
      whatsapp: whatsappStatus({ phone: String(x.phone ?? ""), consent: Number(x.wa_consent) === 1, unsubscribed: Boolean(x.wa_unsubscribed), pastStays: Number(x.past_stays) }),
    };
  });
  const counts: Record<GuestListFilter, number> = { all: all.length, eligible: 0, no_consent: 0, unsubscribed: 0, ota_address: 0, future_stay: 0 };
  for (const g of all) counts[g.status]++;
  // Exactly who a bulk WhatsApp message would reach now (the campaign audience, all languages and countries).
  const wa = audienceQuery(ownerId, {}, "whatsapp", today);
  const whatsappEligible = (await db().query(`SELECT count(*)::int n FROM (${wa.sql}) x`, wa.params)).rows[0]?.n ?? 0;
  const filtered = opts.filter && opts.filter !== "all" ? all.filter((g) => g.status === opts.filter) : all;
  return { rows: filtered.slice(0, opts.limit ?? filtered.length), total: filtered.length, counts, whatsappEligible };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // A leading = + - @ would run as a formula in Excel: prefix it so the cell stays text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The list as CSV for Excel (UTF-8 with BOM so Greek shows correctly). */
export function guestListCsv(rows: GuestListRow[], statusLabels: Record<GuestListStatus, string>, waLabels: Record<WhatsAppListStatus, string>) {
  const head = ["Όνομα", "Email", "Τηλέφωνο", "Χώρα", "Γλώσσα", "Κράτηση", "Άφιξη", "Αναχώρηση", "Κανάλι", "Κρατήσεις", "Συγκατάθεση email", "Μαζικά email", "Συγκατάθεση WhatsApp", "Μαζικά WhatsApp", "Email από online check-in"];
  const lines = rows.map((g) => [g.name, g.email, g.phone, g.country, g.language, g.reference, g.checkIn, g.checkOut, g.channelLabel, g.bookings, g.consent ? "ναι" : "όχι", statusLabels[g.status], g.whatsappConsent ? "ναι" : "όχι", waLabels[g.whatsapp], g.fromCheckin ? "ναι" : ""].map(csvCell).join(","));
  return `﻿${[head.join(","), ...lines].join("\r\n")}\r\n`;
}
