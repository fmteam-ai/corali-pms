"use client";
import { useEffect, useMemo, useState } from "react";
import { normalizeBrand, renderBrandedEmail, whatsappSignature, whatsappTemplateSuggestions, type Brand } from "../../../scripts/email-brand-core.mjs";

const sample = {
  el: { subject: "Η άφιξή σας στο Hotel Corali σε 3 ημέρες · CRL-TEST01", text: "Αγαπητή Maria Papadopoulou,\n\nσας περιμένουμε την **Παρασκευή 12 Ιουνίου 2026**. Το check-in ξεκινά στις 13:00 και η ρεσεψιόν είναι ανοιχτή 07:30–21:00.\n\nΑν δεν έχετε ολοκληρώσει το online check-in: https://booking.hotelcorali.gr/check-in/abc\n\nΚαλό ταξίδι!" },
  en: { subject: "Your arrival at Hotel Corali in 3 days · CRL-TEST01", text: "Dear Maria Papadopoulou,\n\nwe look forward to seeing you on **Friday 12 June 2026**. Check-in starts at 13:00 and reception is open 07:30–21:00.\n\nIf you have not completed the online check-in yet: https://booking.hotelcorali.gr/check-in/abc\n\nSafe travels!" },
};

/** The hotel's details on every guest e-mail and WhatsApp message, with a live preview and ready WhatsApp templates. */
export function BrandEditor({ editable }: { editable: boolean }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [lang, setLang] = useState<"el" | "en">("el");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => { fetch("/api/pms/message-brand").then((r) => r.json()).then((d) => d.ok && setBrand(d.brand)).catch(() => setMsg("Αποτυχία φόρτωσης")); }, []);
  const html = useMemo(() => (brand ? renderBrandedEmail({ ...sample[lang], lang, brand, logoUrl: "/hotel-corali-logo.png" }) : ""), [brand, lang]);
  if (!brand) return <div className="card brandEditor"><h2>Εμφάνιση μηνυμάτων</h2><p className="muted">{msg || "…"}</p></div>;
  const set = (patch: Partial<Brand>) => setBrand({ ...brand, ...patch });
  async function save() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/message-brand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: normalizeBrand(brand) }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setBrand(d.brand); setMsg("✓ Αποθηκεύτηκε — ισχύει για κάθε νέο email."); } else setMsg("Η αποθήκευση απέτυχε.");
    } finally { setBusy(false); }
  }
  const copy = (key: string, text: string) => { void navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? "" : c)), 2000); };
  return (
    <div className="card brandEditor">
      <h2>✉️ Εμφάνιση μηνυμάτων (email & WhatsApp)</h2>
      <p className="muted">Κάθε email προς τους πελάτες (αυτόματα μηνύματα, επιβεβαιώσεις, ψηφιακά κλειδιά, γενέθλια, μαζικά μηνύματα, απαντήσεις) φεύγει με αυτό το σχέδιο: λογότυπο επάνω, κουμπί κάτω από κάθε σύνδεσμο και τα στοιχεία επικοινωνίας στο τέλος.</p>
      <div className="brandGrid">
        <div className="brandFields">
          <label>Όνομα ξενοδοχείου<input value={brand.name} maxLength={80} disabled={!editable} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Διεύθυνση<input value={brand.address} maxLength={160} disabled={!editable} onChange={(e) => set({ address: e.target.value })} /></label>
          <label>Τηλέφωνο<input value={brand.phone} maxLength={40} inputMode="tel" placeholder="+30 22840 …" disabled={!editable} onChange={(e) => set({ phone: e.target.value })} /></label>
          <label>Email<input type="email" value={brand.email} maxLength={120} placeholder="info@hotelcorali.gr" disabled={!editable} onChange={(e) => set({ email: e.target.value })} /></label>
          <label>Ιστοσελίδα<input value={brand.website} maxLength={200} placeholder="https://hotelcorali.gr" disabled={!editable} onChange={(e) => set({ website: e.target.value })} /></label>
          <label className="inline">Χρώμα κουμπιών <input type="color" value={brand.accent} disabled={!editable} onChange={(e) => set({ accent: e.target.value })} /></label>
          <small className="muted">Το λογότυπο είναι το /hotel-corali-logo.png του ξενοδοχείου. Τα κενά πεδία δεν εμφανίζονται.</small>
          {editable && <div className="actions"><button type="button" disabled={busy} onClick={() => void save()}>Αποθήκευση</button>{msg && <span role="status">{msg}</span>}</div>}
        </div>
        <div className="brandPreview">
          <div className="tvLangTabs" role="tablist">{(["el", "en"] as const).map((l) => <button type="button" role="tab" key={l} aria-selected={lang === l} className={lang === l ? "active" : ""} onClick={() => setLang(l)}>{l === "el" ? "Ελληνικά" : "English"}</button>)}</div>
          <iframe title="Προεπισκόπηση email" srcDoc={html} sandbox="" />
        </div>
      </div>
      <details className="brandWhatsapp">
        <summary><b>💬 Πρότυπα WhatsApp έτοιμα για υποβολή στη Meta</b></summary>
        <p className="muted">Το WhatsApp στέλνει στους πελάτες μόνο πρότυπα εγκεκριμένα από τη Meta, και το σχέδιό τους ορίζεται εκεί. Στο Meta Business Manager → WhatsApp Manager → Message templates δημιουργήστε τα παρακάτω (κατηγορία Utility, μάρκετινγκ μόνο για τα μαζικά): Header = Image με το λογότυπο, Body = το κείμενο, Footer = η γραμμή του ξενοδοχείου. Μετά την έγκριση γράψτε το όνομα του προτύπου στο αντίστοιχο μήνυμα πιο πάνω. Οι μεταβλητές {"{{1}}"}, {"{{2}}"}… συμπληρώνονται αυτόματα με αυτή τη σειρά.</p>
        <div className="brandWaList">
          {whatsappTemplateSuggestions(brand).map((s) => (
            <div className="brandWa" key={s.event}>
              <header><code>{s.name}</code><small>Header: {s.header} · Footer: {s.footer}</small></header>
              <div className="brandWaBodies">
                {(["el", "en"] as const).map((l) => <div key={l} className="waBubble"><pre>{s[l]}</pre><small>{s.footer}</small><button type="button" className="secondaryButton" onClick={() => copy(`${s.event}-${l}`, s[l])}>{copied === `${s.event}-${l}` ? "✓ Αντιγράφηκε" : `Αντιγραφή (${l.toUpperCase()})`}</button></div>)}
              </div>
            </div>
          ))}
        </div>
        <p className="muted">Υπογραφή για ελεύθερα μηνύματα WhatsApp (απαντήσεις μέσα σε 24 ώρες):</p>
        <pre className="waSignature">{whatsappSignature(brand).trim()}</pre>
      </details>
    </div>
  );
}
