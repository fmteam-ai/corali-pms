"use client";

import { useEffect, useState } from "react";

type Setup = { secret: string; uri: string; qrDataUrl: string };

export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const [msg, setMsg] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/pms/profile/2fa").then((response) => response.json()).then((data) => setEnabled(Boolean(data.enabled)));
  }, []);

  async function save(form: FormData) {
    const response = await fetch("/api/pms/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    setMsg(response.ok ? "Το προφίλ αποθηκεύτηκε." : "Η αποθήκευση απέτυχε.");
  }

  async function twoFactor(body: object) {
    const response = await fetch("/api/pms/profile/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) {
      setMsg(data.error === "INVALID_CODE" ? "Ο κωδικός επαλήθευσης δεν είναι σωστός." : "Η αλλαγή 2FA απέτυχε.");
      return null;
    }
    return data;
  }

  async function begin() {
    const data = await twoFactor({ action: "begin" });
    if (data) { setSetup(data); setRecoveryCodes([]); setMsg("Σάρωσε το QR και επιβεβαίωσε έναν νέο εξαψήφιο κωδικό."); }
  }

  async function confirm(form: FormData) {
    const data = await twoFactor({ action: "confirm", code: form.get("code") });
    if (data) { setEnabled(true); setSetup(null); setRecoveryCodes(data.recoveryCodes); setMsg("Το 2FA ενεργοποιήθηκε. Αποθήκευσε τους κωδικούς ανάκτησης τώρα."); }
  }

  async function disable(form: FormData) {
    const data = await twoFactor({ action: "disable", password: form.get("password"), code: form.get("code") });
    if (data) { setEnabled(false); setRecoveryCodes([]); setMsg("Το 2FA απενεργοποιήθηκε."); }
  }

  return <div className="profileGrid">
    <form action={save} className="policyForm">
      <h2>Στοιχεία χρήστη</h2>
      <label>Ονοματεπώνυμο<input name="displayName" defaultValue={displayName} required /></label>
      <label>Email<input name="email" type="email" defaultValue={email} required /></label>
      <label>Νέος κωδικός<input name="password" type="password" minLength={12} placeholder="Κενό = χωρίς αλλαγή" /></label>
      <button>Αποθήκευση</button>
    </form>
    <section className="policyForm">
      <h2>Έλεγχος δύο παραγόντων (2FA)</h2>
      <p>Κατάσταση: <strong>{enabled ? "Ενεργό" : "Ανενεργό"}</strong></p>
      {!enabled && !setup && <button type="button" onClick={begin}>Ρύθμιση 2FA</button>}
      {setup && <>
        {/* This authenticated data URL never leaves the browser or calls a third-party QR service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="qr" src={setup.qrDataUrl} alt="QR ρύθμισης 2FA" />
        <p>Χειροκίνητο κλειδί: <code>{setup.secret}</code></p>
        <form action={confirm} className="inlineForm"><input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /><button>Επιβεβαίωση</button></form>
      </>}
      {enabled && <form action={disable} className="stackForm"><input name="password" type="password" placeholder="Τρέχων κωδικός" required /><input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="Κωδικός 2FA" required /><button className="danger">Απενεργοποίηση 2FA</button></form>}
      {recoveryCodes.length > 0 && <div className="recovery"><h3>Κωδικοί ανάκτησης μίας χρήσης</h3><p>Δεν θα εμφανιστούν ξανά.</p><ul>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul></div>}
    </section>
    <p className="notice" aria-live="polite">{msg}</p>
  </div>;
}
