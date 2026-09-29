"use client";
import { useState } from "react";

export function DirectDiscountForm({ initialPercent, initialActive, canEdit }: { initialPercent: number; initialActive: boolean; canEdit: boolean }) {
  const [percent, setPercent] = useState(initialPercent);
  const [active, setActive] = useState(initialActive);
  const [msg, setMsg] = useState("");
  async function save() {
    const r = await fetch("/api/pms/direct-discount", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ percent, active }) });
    setMsg(r.ok ? "Αποθηκεύτηκε. / Saved." : "Η αποθήκευση απέτυχε. / Saving failed.");
  }
  return (
    <article className="wide directDiscount">
      <h2>Έκπτωση απευθείας κράτησης · Direct booking discount</h2>
      <p>Η έκπτωση ισχύει μόνο στο πλάνο «Direct website rate» (Απευθείας τιμή ιστοσελίδας): εκεί η ιστοσελίδα εμφανίζει την κανονική τιμή διαγραμμένη και την απευθείας τιμή. Τα υπόλοιπα πλάνα (Flexible, Non-refundable) κρατούν μόνο τη δική τους προσαρμογή. · Applies only to the Direct website rate. Οι μη συνδυαζόμενοι κωδικοί (π.χ. γενεθλίων) αντικαθιστούν την έκπτωση, και ο επισκέπτης πληρώνει πάντα τη χαμηλότερη τιμή.</p>
      <div className="actions">
        <label><input type="checkbox" checked={active} disabled={!canEdit} onChange={(e) => setActive(e.target.checked)} /> Ενεργή / Active</label>
        <label>% <input type="number" min={0} max={50} value={percent} disabled={!canEdit} onChange={(e) => setPercent(Math.max(0, Math.min(50, Math.trunc(Number(e.target.value) || 0))))} /></label>
        {canEdit && <button type="button" onClick={save}>Αποθήκευση / Save</button>}
      </div>
      <p className="notice" role="status">{msg}</p>
    </article>
  );
}
