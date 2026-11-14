"use client";
import { useCallback, useEffect, useState } from "react";

type Status = { ready: boolean; reason?: string; webhook?: boolean; subscribed?: boolean; callback?: string; otherCallback?: string | null; readError?: string | null };
const errors: Record<string, string> = {
  NOT_CONNECTED: "Συνδέστε πρώτα το WhatsApp με τη «Γρήγορη σύνδεση».",
  APP_REQUIRED: "Λείπει το App ID (ή το App secret) της εφαρμογής Meta που έχει τον αριθμό WhatsApp. Συμπληρώστε παρακάτω το «App ID» (developers.facebook.com → η εφαρμογή → App settings → Basic → App ID), πατήστε «Αποθήκευση» και ανανεώστε τη σελίδα.",
  WEBHOOK_FAILED: "Η Meta δεν αποδέχτηκε τη διεύθυνση του PMS για τα μηνύματα.",
  SUBSCRIBE_FAILED: "Η Meta δεν συνέδεσε την εφαρμογή με τον λογαριασμό WhatsApp.",
  TOO_MANY_ATTEMPTS: "Πολλές προσπάθειες — δοκιμάστε ξανά σε μισή ώρα.",
  FORBIDDEN: "Το αίτημα απορρίφθηκε για λόγους ασφαλείας — ανανεώστε τη σελίδα (F5) και δοκιμάστε ξανά.",
};

/** «Εισερχόμενα WhatsApp»: guest messages to the hotel's number arrive in PMS → Social → Μηνύματα. */
export function WhatsAppInboxSetup({ editable }: { editable: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try { const d = await (await fetch("/api/pms/whatsapp-inbox", { cache: "no-store" })).json(); if (d.ok) setS(d); } catch { setS(null); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  async function enable() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/whatsapp-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const raw = await r.text().catch(() => "");
      let d: { ok?: boolean; error?: string; detail?: string; webhook?: boolean; subscribed?: boolean };
      try { d = JSON.parse(raw); } catch { d = { error: `HTTP ${r.status}`, detail: raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) }; }
      if (d.ok) { setS({ ready: true, ...d }); setMsg(d.webhook && d.subscribed ? "✓ Τα μηνύματα των επισκεπτών θα εμφανίζονται στο Social → Μηνύματα." : "Η Meta δέχτηκε τη ρύθμιση· η κατάσταση θα ενημερωθεί σε λίγο."); }
      else { const code = d.error ?? `HTTP ${r.status}`; setMsg(`${errors[code] ?? "Η ενεργοποίηση απέτυχε."}${d.detail ? ` (${code === "UNEXPECTED" || code.startsWith("HTTP") ? "" : "Meta: "}${d.detail})` : ""}${errors[code] ? "" : ` [${code}]`}`); }
    } finally { setBusy(false); }
  }
  if (!s) return null;
  const on = s.ready && s.webhook && s.subscribed;
  return (
    <div className={`metaQuick${on ? " ok" : ""}`}>
      <h3>📥 Εισερχόμενα WhatsApp {on ? "· ✓ ενεργά" : ""}</h3>
      {!s.ready ? <p className="muted">{errors[s.reason ?? ""] ?? "Συνδέστε πρώτα το WhatsApp."}</p> : <>
        <p>Όταν ένας επισκέπτης στέλνει μήνυμα (ή απαντά σε αυτόματο μήνυμα) στον αριθμό WhatsApp του ξενοδοχείου, εμφανίζεται στο <a href="/pms/social">Social → Μηνύματα</a> μαζί με την κράτησή του, με έτοιμη πρόταση απάντησης. Απαντάτε από εκεί μέσα σε 24 ώρες από το μήνυμά του.</p>
        <ul className="plainList">
          <li>{s.webhook ? "✓" : "✗"} Η Meta στέλνει τα μηνύματα στο PMS {s.callback ? <code>{s.callback}</code> : null}</li>
          <li>{s.subscribed ? "✓" : "✗"} Η εφαρμογή είναι συνδεδεμένη με τον λογαριασμό WhatsApp</li>
        </ul>
        {s.otherCallback && <p className="notice">Η εφαρμογή στέλνει σήμερα τα μηνύματα WhatsApp σε άλλη διεύθυνση (<code>{s.otherCallback}</code>). Η ενεργοποίηση θα την αλλάξει στο PMS.</p>}
        {s.readError && !on && <p className="muted">Meta: {s.readError}</p>}
        {editable && !on && <button type="button" className="primaryAction" disabled={busy} onClick={() => void enable()}>{busy ? "Ενεργοποίηση…" : "Ενεργοποίηση εισερχομένων"}</button>}
        {editable && on && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void load()}>↻ Έλεγχος</button>}
      </>}
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
