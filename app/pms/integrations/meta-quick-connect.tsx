"use client";
import { useState } from "react";

type Result = { page: { id: string; name: string }; instagram: { id: string; username: string } | null; subscribed: boolean; verifyToken: string; webhookUrl: string };
const errors: Record<string, string> = {
  APP_REQUIRED: "Συμπληρώστε App ID και App secret (developers.facebook.com → η εφαρμογή → App settings → Basic).",
  TOKEN_INVALID: "Ο κωδικός δεν έγινε δεκτός. Πατήστε ξανά «Generate Access Token» στο Graph API Explorer και αντιγράψτε τον αμέσως (λήγει σε 1 ώρα). Ελέγξτε και ότι το App ID / App secret είναι της εφαρμογής Hotel Corali PMS.",
  NO_PAGES: "Ο κωδικός δεν έχει πρόσβαση σε σελίδα. Στο Graph API Explorer πατήστε «Generate Access Token» και στο παράθυρο του Facebook επιλέξτε τη σελίδα του ξενοδοχείου.",
  INVALID_INPUT: "Ελέγξτε τα πεδία (το App ID είναι μόνο αριθμοί).",
  FAILED: "Η σύνδεση με τη Meta απέτυχε — δοκιμάστε ξανά σε λίγο.",
};

/** Γρήγορη σύνδεση: App ID + App secret + the token from Graph API Explorer; the PMS finds and saves the rest. */
export function MetaQuickConnect({ hasApp, onDone }: { hasApp: boolean; onDone: () => void }) {
  const [appId, setAppId] = useState(""), [appSecret, setAppSecret] = useState(""), [token, setToken] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [pages, setPages] = useState<{ id: string; name: string }[]>([]), [done, setDone] = useState<Result | null>(null);
  async function connect(pageId?: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/meta-connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(appId.trim() ? { appId: appId.trim() } : {}), ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}), userToken: token, ...(pageId ? { pageId } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setDone(d); setPages([]); setToken(""); setAppSecret(""); onDone(); return; }
      if (d.error === "CHOOSE_PAGE") { setPages(d.pages); setMsg("Βρέθηκαν περισσότερες σελίδες — επιλέξτε τη σελίδα του ξενοδοχείου:"); return; }
      setMsg(`${errors[d.error] ?? errors.FAILED}${d.detail ? ` (Meta: ${d.detail})` : ""}`);
    } finally { setBusy(false); }
  }
  if (done) return (
    <div className="metaQuick ok">
      <h3>✓ Συνδέθηκε</h3>
      <p>Σελίδα Facebook: <b>{done.page.name}</b>{done.instagram ? <> · Instagram: <b>@{done.instagram.username || done.instagram.id}</b></> : <> · <span className="debit">δεν βρέθηκε συνδεδεμένο Instagram (Meta Business Suite → Ρυθμίσεις → Instagram)</span></>}</p>
      <p>Το token της σελίδας δεν λήγει. Οι εγκεκριμένες αναρτήσεις του PMS → Social ανεβαίνουν πλέον αυτόματα.</p>
      <p><b>Τελευταίο βήμα για τα μηνύματα:</b> developers.facebook.com → η εφαρμογή → <b>Messenger</b> (ή Webhooks) → <b>Configure webhooks</b>: Callback URL <code>{done.webhookUrl}</code> και Verify token <code>{done.verifyToken}</code> → Verify and save → ενεργοποιήστε το <b>messages</b>. {done.subscribed ? "Η σελίδα έχει ήδη εγγραφεί." : ""}</p>
    </div>
  );
  return (
    <div className="metaQuick">
      <h3>🔗 Γρήγορη σύνδεση</h3>
      <ol>
        <li>Ανοίξτε <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer">Graph API Explorer ↗</a>, επιλέξτε <b>Meta App: Hotel Corali PMS</b> και πατήστε <b>Generate Access Token</b> (επιλέξτε τη σελίδα και το Instagram του ξενοδοχείου → Αποθήκευση).</li>
        <li>Πατήστε το εικονίδιο <b>αντιγραφής</b> δίπλα στον κωδικό «Access Token» και επικολλήστε τον εδώ.</li>
        <li>Πατήστε <b>Σύνδεση</b> — το PMS βρίσκει μόνο του σελίδα, Instagram και μόνιμο token.</li>
      </ol>
      {!hasApp && <div className="metaQuickApp">
        <label>App ID<input value={appId} inputMode="numeric" placeholder="π.χ. 1234567890123456" onChange={(e) => setAppId(e.target.value)} /></label>
        <label>App secret<input type="password" value={appSecret} autoComplete="off" onChange={(e) => setAppSecret(e.target.value)} /></label>
        <small className="muted">developers.facebook.com → My Apps → Hotel Corali PMS → App settings → Basic.</small>
      </div>}
      <label>Κωδικός από το Graph API Explorer<textarea rows={3} value={token} autoComplete="off" spellCheck={false} placeholder="EAA…" onChange={(e) => setToken(e.target.value)} /></label>
      <button type="button" className="primaryAction" disabled={busy || token.trim().length < 20} onClick={() => void connect()}>{busy ? "Σύνδεση…" : "Σύνδεση"}</button>
      {pages.length > 0 && <div className="metaQuickPages">{pages.map((p) => <button type="button" key={p.id} className="secondaryButton" disabled={busy} onClick={() => void connect(p.id)}>{p.name}</button>)}</div>}
      {msg && <p className="notice" role="status">{msg}</p>}
      <details><summary>Χειροκίνητη συμπλήρωση</summary><p className="muted">Τα πεδία παρακάτω μένουν για όποιον θέλει να τα συμπληρώσει μόνος του.</p></details>
    </div>
  );
}
