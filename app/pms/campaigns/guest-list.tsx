"use client";
import { useCallback, useEffect, useState } from "react";
import type { PmsLang } from "@/lib/pms-i18n";

type Status = "eligible" | "no_consent" | "unsubscribed" | "ota_address" | "future_stay";
type WaStatus = "eligible" | "no_consent" | "unsubscribed" | "no_phone" | "future_stay";
type Filter = "all" | Status;
type Row = { email: string; name: string; phone: string; country: string; bookings: number; reference: string; bookingId: number; checkIn: string; checkOut: string; channelLabel: string; channels: string[]; status: Status; fromCheckin: boolean; whatsapp: WaStatus };
type Data = { rows: Row[]; total: number; counts: Record<Filter, number>; whatsappEligible: number };

const texts = {
  el: {
    title: "📇 Λίστα επισκεπτών", intro: "Συμπληρώνεται αυτόματα μόνο με το email που δίνει ο ίδιος ο επισκέπτης στη φόρμα online check-in (από κάθε κανάλι: απευθείας, Booking.com, Airbnb…). Μαζικά email λαμβάνουν όσοι τσέκαραν εκεί «Θέλω να λαμβάνω νέα και προσφορές» και έχουν ήδη μείνει στο ξενοδοχείο. Για να μπει κάποιος στη λίστα, στείλτε του το online check-in από την κράτηση.",
    search: "Αναζήτηση: όνομα, email, κράτηση, τηλέφωνο", csv: "⬇ Excel (CSV)", none: "Δεν βρέθηκαν επισκέπτες.", more: "Εμφανίζονται οι πρώτοι 300 από {n} — χρησιμοποιήστε αναζήτηση ή το Excel για όλους.",
    cols: ["Όνομα", "Email", "Κράτηση", "Κανάλι", "Μαζικά email", "WhatsApp"], stays: "κρατήσεις", fromCheckin: "από το online check-in", waCount: "Μαζικά WhatsApp λαμβάνουν: {n}",
    wa: { eligible: "✓ Λαμβάνει", no_consent: "Χωρίς συγκατάθεση", unsubscribed: "🚫 Διαγράφηκε", no_phone: "Χωρίς κινητό", future_stay: "Μετά τη διαμονή" },
    waHint: "Μαζικά WhatsApp λαμβάνουν μόνο όσοι έδωσαν κινητό και τσέκαραν τη συγκατάθεση WhatsApp στο online check-in (και για κρατήσεις από Booking.com / Airbnb).",
    filters: { all: "Όλοι", eligible: "✓ Λαμβάνουν", no_consent: "Χωρίς συγκατάθεση", future_stay: "Πριν τη διαμονή", unsubscribed: "Διαγράφηκαν", ota_address: "Διεύθυνση OTA" },
    status: { eligible: "✓ Λαμβάνει", no_consent: "Χωρίς συγκατάθεση", future_stay: "Μετά τη διαμονή", unsubscribed: "🚫 Διαγράφηκε", ota_address: "Διεύθυνση OTA" },
    hint: {
      eligible: "Έχει δώσει συγκατάθεση και έχει μείνει στο ξενοδοχείο.",
      no_consent: "Δεν τσέκαρε «Θέλω να λαμβάνω νέα και προσφορές» στο online check-in.",
      future_stay: "Έχει δώσει συγκατάθεση· θα λαμβάνει μετά την πρώτη του διαμονή.",
      unsubscribed: "Ζήτησε διαγραφή από τη λίστα.",
      ota_address: "Ο επισκέπτης έγραψε διεύθυνση πλατφόρμας (π.χ. …@guest.booking.com): οι πλατφόρμες απαγορεύουν τα διαφημιστικά σε αυτές.",
    },
  },
  en: {
    title: "📇 Guest list", intro: "Filled automatically only with the e-mail guests type themselves in the online check-in form (from every channel: direct, Booking.com, Airbnb…). Bulk e-mails go to those who ticked “I'd like news and offers” there and have already stayed. To add a guest, send them online check-in from the booking.",
    search: "Search: name, e-mail, booking, phone", csv: "⬇ Excel (CSV)", none: "No guests found.", more: "Showing the first 300 of {n} — use search or Excel for all.",
    cols: ["Name", "E-mail", "Booking", "Channel", "Bulk e-mail", "WhatsApp"], stays: "bookings", fromCheckin: "from online check-in", waCount: "Bulk WhatsApp reaches: {n}",
    wa: { eligible: "✓ Receives", no_consent: "No consent", unsubscribed: "🚫 Unsubscribed", no_phone: "No mobile", future_stay: "After the stay" },
    waHint: "Bulk WhatsApp only reaches guests who gave a mobile and ticked WhatsApp consent in online check-in (also for Booking.com / Airbnb bookings).",
    filters: { all: "All", eligible: "✓ Receive", no_consent: "No consent", future_stay: "Before the stay", unsubscribed: "Unsubscribed", ota_address: "OTA address" },
    status: { eligible: "✓ Receives", no_consent: "No consent", future_stay: "After the stay", unsubscribed: "🚫 Unsubscribed", ota_address: "OTA address" },
    hint: {
      eligible: "Gave consent and has stayed at the hotel.",
      no_consent: "Did not tick “I'd like news and offers” in online check-in.",
      future_stay: "Gave consent; receives messages after the first stay.",
      unsubscribed: "Asked to be removed from the list.",
      ota_address: "The guest typed a platform address (e.g. …@guest.booking.com): the platforms forbid marketing to these.",
    },
  },
};

/** The guest e-mail list behind bulk messages: who is on it, from which booking and channel, and who receives. */
export function GuestList({ lang, canExport }: { lang: PmsLang; canExport: boolean }) {
  const t = texts[lang === "en" ? "en" : "el"];
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const query = useCallback((extra: Record<string, string> = {}) => new URLSearchParams({ q, filter, lang: lang === "en" ? "en" : "el", ...extra }).toString(), [q, filter, lang]);
  useEffect(() => {
    const id = window.setTimeout(async () => {
      try { const d = await (await fetch(`/api/pms/campaigns/guests?${query()}`, { cache: "no-store" })).json(); if (d.ok) setData(d); } catch { /* keep the last list */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);
  return (
    <article className="card guestList">
      <h2>{t.title} {data ? `(${data.counts.all})` : ""}</h2>
      <p className="muted">{t.intro}</p>
      {data && <p className="muted"><b>{t.waCount.replace("{n}", String(data.whatsappEligible))}</b> · {t.waHint}</p>}
      <div className="guestListTools">
        <input type="search" value={q} placeholder={t.search} onChange={(e) => setQ(e.target.value)} />
        {canExport && <a className="secondaryButton" href={`/api/pms/campaigns/guests?${query({ format: "csv" })}`}>{t.csv}</a>}
      </div>
      <div className="guestListFilters" role="tablist">
        {(Object.keys(t.filters) as Filter[]).map((f) => <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{t.filters[f]} <small>{data?.counts[f] ?? 0}</small></button>)}
      </div>
      {data && data.rows.length === 0 && <p>{t.none}</p>}
      {data && data.rows.length > 0 && (
        <div className="tableWrap">
          <table>
            <thead><tr>{t.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((g) => (
                <tr key={g.email}>
                  <td>{g.name || "—"}{g.country ? <small> · {g.country}</small> : null}</td>
                  <td><a href={`mailto:${g.email}`}>{g.email}</a></td>
                  <td><a href={`/pms/reservations/${g.bookingId}`}>{g.reference}</a><small> {g.checkIn} → {g.checkOut}{g.bookings > 1 ? ` · ${g.bookings} ${t.stays}` : ""}</small></td>
                  <td>{g.channelLabel}{g.channels.length > 1 ? <small> ({g.channels.join(", ")})</small> : null}</td>
                  <td><span className={`guestStatus guestStatus-${g.status}`} title={t.hint[g.status]}>{t.status[g.status]}</span></td>
                  <td>{g.phone ? <span className="nowrap">{g.phone}</span> : null}<small className={`guestStatus guestStatus-${g.whatsapp}`} title={t.waHint}>{t.wa[g.whatsapp]}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.rows.length && <p className="muted">{t.more.replace("{n}", String(data.total))}</p>}
    </article>
  );
}
