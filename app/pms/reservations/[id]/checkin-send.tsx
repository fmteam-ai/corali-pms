"use client";
import { useState } from "react";
import type { PmsLang } from "@/lib/pms-i18n";

const texts = {
  el: {
    lead: "Η φόρμα online check-in είναι υποχρεωτική για όλους τους επισκέπτες (από κάθε κανάλι). Στείλτε την ή συμπληρώστε την στη ρεσεψιόν. Εκεί συμπληρώνει στοιχεία, ώρα άφιξης και το δικό του email (χρήσιμο για κρατήσεις από Booking.com / Airbnb).",
    email: "✉ Αποστολή με email", wa: "💬 WhatsApp", desk: "🖥 Συμπλήρωση στη ρεσεψιόν", deskNote: "Ανοίγει τη φόρμα σε νέα καρτέλα — δώστε την οθόνη ή ένα tablet στον επισκέπτη να τη συμπληρώσει.", copy: "🔗 Αντιγραφή συνδέσμου", copied: "✓ Αντιγράφηκε",
    sent: "✓ Στάλθηκε στο {to}", otaNote: "Η διεύθυνση είναι της πλατφόρμας· η πλατφόρμα προωθεί το μήνυμα στον επισκέπτη.",
    waNote: "Ανοίγει το WhatsApp σας με έτοιμο μήνυμα — πατάτε μόνο αποστολή.", valid: "Ο σύνδεσμος ισχύει 7 ημέρες· κάθε νέα αποστολή ακυρώνει τον προηγούμενο.",
    errors: { NO_EMAIL: "Η κράτηση δεν έχει email — χρησιμοποιήστε WhatsApp ή αντιγραφή.", NOT_ACTIVE: "Η κράτηση δεν είναι ενεργή.", TOO_MANY_ATTEMPTS: "Πολλές αποστολές — δοκιμάστε σε μία ώρα.", EMAIL_FAILED: "Το email δεν στάλθηκε — ελέγξτε το SMTP στις Συνδέσεις.", FAILED: "Η ενέργεια απέτυχε." } as Record<string, string>,
  },
  en: {
    lead: "The online check-in form is required for every guest (any channel). Send it or fill it in at the desk. They fill in their details, arrival time and their own e-mail (useful for Booking.com / Airbnb bookings).",
    email: "✉ Send by e-mail", wa: "💬 WhatsApp", desk: "🖥 Fill in at the desk", deskNote: "Opens the form in a new tab — hand the screen or a tablet to the guest to fill it in.", copy: "🔗 Copy link", copied: "✓ Copied",
    sent: "✓ Sent to {to}", otaNote: "This is the platform's address; the platform forwards the message to the guest.",
    waNote: "Opens your WhatsApp with the message ready — you only press send.", valid: "The link is valid for 7 days; each new send cancels the previous one.",
    errors: { NO_EMAIL: "The booking has no e-mail — use WhatsApp or copy.", NOT_ACTIVE: "The booking is not active.", TOO_MANY_ATTEMPTS: "Too many sends — try again in an hour.", EMAIL_FAILED: "The e-mail was not sent — check SMTP in Integrations.", FAILED: "The action failed." } as Record<string, string>,
  },
};
const relay = /@(guest\.booking\.com|guest\.airbnb\.com|m\.expediapartnercentral\.com|agoda-messaging\.com|guest\.trip\.com|guest\.hotels\.com)$/i;

/** «Αποστολή online check-in» on a reservation whose guest has not filled the form yet. */
export function CheckinSend({ lang, bookingId, email, phone }: { lang: PmsLang; bookingId: number; email: string; phone: string }) {
  const t = texts[lang === "en" ? "en" : "el"];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  async function call(channel: "link" | "email") {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/pms/reservations/${bookingId}/check-in-send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel }) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setMsg(t.errors[d.error] ?? t.errors.FAILED); return null; }
      return d as { url: string; text: string; whatsappUrl: string | null; sentTo: string | null };
    } finally { setBusy(false); }
  }
  async function viaEmail() { const d = await call("email"); if (d?.sentTo) setMsg(t.sent.replace("{to}", d.sentTo)); }
  async function viaWhatsapp() {
    // Open the window first (browsers block pop-ups opened after an await), then point it at WhatsApp.
    const w = window.open("about:blank", "_blank");
    const d = await call("link");
    if (d?.whatsappUrl && w) w.location.href = d.whatsappUrl; else w?.close();
  }
  async function atDesk() {
    const w = window.open("about:blank", "_blank");
    const d = await call("link");
    if (d?.url && w) w.location.href = d.url; else w?.close();
  }
  async function copy() { const d = await call("link"); if (d) { await navigator.clipboard?.writeText(d.url).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 2500); } }
  const digits = phone.replace(/\D/g, "");
  return (
    <div className="checkinSend">
      <p>{t.lead}</p>
      <div className="actions">
        <button type="button" disabled={busy || !email} onClick={() => void viaEmail()}>{t.email}</button>
        {digits.length >= 10 && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void viaWhatsapp()}>{t.wa}</button>}
        <button type="button" className="secondaryButton" disabled={busy} onClick={() => void atDesk()} title={t.deskNote}>{t.desk}</button>
        <button type="button" className="secondaryButton" disabled={busy} onClick={() => void copy()}>{copied ? t.copied : t.copy}</button>
      </div>
      {email && relay.test(email) && <small className="muted">✉ {email} — {t.otaNote}</small>}
      {digits.length >= 10 && <small className="muted">💬 {t.waNote}</small>}
      <small className="muted">{t.valid}</small>
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
