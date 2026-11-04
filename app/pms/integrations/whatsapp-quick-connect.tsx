"use client";
import { useState } from "react";

const errors: Record<string, string> = {
  APP_REQUIRED: "Συμπληρώστε App ID και App secret της εφαρμογής Meta (ίδια με του Facebook / Instagram: developers.facebook.com → η εφαρμογή → App settings → Basic).",
  TOKEN_INVALID: "Ο κωδικός δεν έγινε δεκτός. Πατήστε ξανά «Generate Access Token» στο Graph API Explorer και αντιγράψτε τον αμέσως (ο απλός κωδικός λήγει σε 1 ώρα).",
  NO_WHATSAPP: "Ο κωδικός δεν έχει πρόσβαση σε λογαριασμό WhatsApp Business. Στο Graph API Explorer προσθέστε τις άδειες whatsapp_business_management και whatsapp_business_messaging, πατήστε «Generate Access Token» και επιλέξτε τον λογαριασμό WhatsApp του ξενοδοχείου.",
  NO_PHONE: "Ο λογαριασμός WhatsApp Business δεν έχει ακόμα αριθμό τηλεφώνου. Προσθέστε τον στο WhatsApp Manager (business.facebook.com → WhatsApp Manager → Αριθμοί τηλεφώνου).",
  INVALID_INPUT: "Ελέγξτε τα πεδία (το App ID είναι μόνο αριθμοί).",
  FAILED: "Η σύνδεση με τη Meta απέτυχε — δοκιμάστε ξανά σε λίγο.",
};
const day = (ms: number) => new Date(ms).toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" });

/** Γρήγορη σύνδεση WhatsApp Business with the same Meta app; the PMS finds the business account and phone number. */
export function WhatsAppQuickConnect({ hasApp, expiresAt, onDone }: { hasApp: boolean; expiresAt: number; onDone: () => void }) {
  const [appId, setAppId] = useState(""), [appSecret, setAppSecret] = useState(""), [token, setToken] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [phones, setPhones] = useState<{ id: string; number: string; name: string }[]>([]);
  const [done, setDone] = useState<{ phone: { number: string; name: string }; expiresAt: number } | null>(null);
  async function connect(phoneNumberId?: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/whatsapp-connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(appId.trim() ? { appId: appId.trim() } : {}), ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}), token, ...(phoneNumberId ? { phoneNumberId } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setDone(d); setPhones([]); setToken(""); setAppSecret(""); onDone(); return; }
      if (d.error === "CHOOSE_PHONE") { setPhones(d.phones); setMsg("Βρέθηκαν περισσότεροι αριθμοί — επιλέξτε τον αριθμό του ξενοδοχείου:"); return; }
      setMsg(`${errors[d.error] ?? errors.FAILED}${d.detail ? ` (Meta: ${d.detail})` : ""}`);
    } finally { setBusy(false); }
  }
  const expiry = (ms: number) => (ms ? <p className="notice">⏳ Η σύνδεση ισχύει έως <b>{day(ms)}</b>. Το PMS θα σας ειδοποιήσει μία εβδομάδα πριν· τότε επαναλαμβάνετε τη «Γρήγορη σύνδεση» (1 λεπτό). Για σύνδεση που δεν λήγει ποτέ, επικολλήστε εδώ token «System User» (business.facebook.com → Ρυθμίσεις επιχείρησης → Χρήστες συστήματος → Δημιουργία token).</p> : <p className="muted">✓ Μόνιμη σύνδεση (token System User) — δεν λήγει.</p>);
  if (done) return (
    <div className="metaQuick ok">
      <h3>✓ Συνδέθηκε</h3>
      <p>Αριθμός WhatsApp: <b>{done.phone.number}</b>{done.phone.name ? <> · {done.phone.name}</> : null}</p>
      {expiry(done.expiresAt)}
      <p>Δοκιμάστε την από <b>Αυτόματα μηνύματα → Δοκιμαστική αποστολή → 💬 WhatsApp</b> (πρότυπο hello_world).</p>
    </div>
  );
  return (
    <div className="metaQuick">
      <h3>🔗 Γρήγορη σύνδεση WhatsApp</h3>
      {expiresAt > 0 && expiry(expiresAt)}
      <ol>
        <li>Στην εφαρμογή Meta <b>Hotel Corali PMS</b> (developers.facebook.com) → <b>Add use cases</b> → «<b>Connect with customers through WhatsApp</b>» (μία φορά).</li>
        <li>Ανοίξτε <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer">Graph API Explorer ↗</a> → Meta App: <b>Hotel Corali PMS</b> → Add a Permission: <b>whatsapp_business_management</b>, <b>whatsapp_business_messaging</b>, <b>business_management</b> → <b>Generate Access Token</b> → επιλέξτε τον λογαριασμό WhatsApp του ξενοδοχείου → Αποθήκευση.</li>
        <li>Αντιγράψτε τον κωδικό, επικολλήστε τον εδώ και πατήστε <b>Σύνδεση</b>.</li>
      </ol>
      {!hasApp && <div className="metaQuickApp">
        <label>App ID<input value={appId} inputMode="numeric" placeholder="π.χ. 1234567890123456" onChange={(e) => setAppId(e.target.value)} /></label>
        <label>App secret<input type="password" value={appSecret} autoComplete="off" onChange={(e) => setAppSecret(e.target.value)} /></label>
        <small className="muted">Αν έχετε ήδη συνδέσει Facebook / Instagram, το PMS χρησιμοποιεί την ίδια εφαρμογή — αφήστε τα κενά.</small>
      </div>}
      <label>Κωδικός από το Graph API Explorer (ή token System User)<textarea rows={3} value={token} autoComplete="off" spellCheck={false} placeholder="EAA…" onChange={(e) => setToken(e.target.value)} /></label>
      <button type="button" className="primaryAction" disabled={busy || token.trim().length < 20} onClick={() => void connect()}>{busy ? "Σύνδεση…" : "Σύνδεση"}</button>
      {phones.length > 0 && <div className="metaQuickPages">{phones.map((p) => <button type="button" key={p.id} className="secondaryButton" disabled={busy} onClick={() => void connect(p.id)}>{p.number}{p.name ? ` · ${p.name}` : ""}</button>)}</div>}
      {msg && <p className="notice" role="status">{msg}</p>}
      <details><summary>Χειροκίνητη συμπλήρωση</summary><p className="muted">Τα πεδία παρακάτω μένουν για όποιον θέλει να τα συμπληρώσει μόνος του.</p></details>
    </div>
  );
}
