"use client";
import { useState } from "react";

type Range = { from: string; to: string };
export type BirthdaySettings = { percent: number; validDays: number; stayFrom: string | null; stayTo: string | null; blackout: Range[] };

// Staff type dates as DD/MM (every year) or DD/MM/YYYY; the server stores MM-DD or YYYY-MM-DD.
const toStored = (v: string) => {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const md = `${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return m[3] ? `${m[3]}-${md}` : md;
};
const toShown = (v: string | null) => (v ? v.split("-").reverse().join("/") : "");

export function BirthdayOfferForm({ initial, canEdit }: { initial: BirthdaySettings; canEdit: boolean }) {
  const [percent, setPercent] = useState(initial.percent);
  const [validDays, setValidDays] = useState(initial.validDays);
  const [stayFrom, setStayFrom] = useState(toShown(initial.stayFrom));
  const [stayTo, setStayTo] = useState(toShown(initial.stayTo));
  const [blackout, setBlackout] = useState(initial.blackout.map((r) => ({ from: toShown(r.from), to: toShown(r.to) })));
  const [msg, setMsg] = useState("");
  async function save() {
    const ranges = blackout.filter((r) => r.from || r.to).map((r) => ({ from: toStored(r.from), to: toStored(r.to) }));
    const from = stayFrom ? toStored(stayFrom) : null, to = stayTo ? toStored(stayTo) : null;
    if (ranges.some((r) => !r.from || !r.to || r.from.length !== r.to.length) || (stayFrom && !from) || (stayTo && !to) || Boolean(from) !== Boolean(to)) {
      setMsg("Ελέγξτε τις ημερομηνίες (ΗΗ/ΜΜ ή ΗΗ/ΜΜ/ΕΕΕΕ). / Check the dates (DD/MM or DD/MM/YYYY).");
      return;
    }
    const r = await fetch("/api/pms/birthday-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ percent, validDays, stayFrom: from, stayTo: to, blackout: ranges }) });
    setMsg(r.ok ? "Αποθηκεύτηκε· ισχύει για τους νέους κωδικούς. / Saved; applies to newly issued codes." : "Η αποθήκευση απέτυχε. / Saving failed.");
  }
  const setRange = (i: number, key: keyof Range, value: string) => setBlackout((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <article className="wide directDiscount birthdayOffer">
      <h2>Κωδικός γενεθλίων · Birthday code</h2>
      <p>Προσωπικός κωδικός μίας χρήσης για ενήλικες επισκέπτες με συναίνεση marketing. Ορίστε για ποιες ημερομηνίες διαμονής ισχύει και ποιες περίοδοι εξαιρούνται (π.χ. 20/07–20/08). Ημερομηνίες χωρίς έτος επαναλαμβάνονται κάθε χρόνο.</p>
      <div className="actions">
        <label>% <input type="number" min={1} max={50} value={percent} disabled={!canEdit} onChange={(e) => setPercent(Math.max(1, Math.min(50, Math.trunc(Number(e.target.value) || 1))))} /></label>
        <label>Κράτηση εντός (ημέρες) / Book within (days) <input type="number" min={7} max={365} value={validDays} disabled={!canEdit} onChange={(e) => setValidDays(Math.max(7, Math.min(365, Math.trunc(Number(e.target.value) || 7))))} /></label>
      </div>
      <fieldset disabled={!canEdit}>
        <legend>Ισχύει για διαμονές / Valid for stays</legend>
        <div className="actions">
          <label>Από / From <input placeholder="01/04" value={stayFrom} onChange={(e) => setStayFrom(e.target.value)} /></label>
          <label>Έως / To <input placeholder="31/10" value={stayTo} onChange={(e) => setStayTo(e.target.value)} /></label>
        </div>
        <small>Κενό = όλη η χρονιά. / Empty = all year.</small>
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend>Εξαιρούνται / Excluded periods</legend>
        {blackout.map((r, i) => (
          <div className="actions" key={i}>
            <label>Από / From <input placeholder="20/07" value={r.from} onChange={(e) => setRange(i, "from", e.target.value)} /></label>
            <label>Έως / To <input placeholder="20/08" value={r.to} onChange={(e) => setRange(i, "to", e.target.value)} /></label>
            <button type="button" className="secondary" onClick={() => setBlackout((list) => list.filter((_, j) => j !== i))}>Αφαίρεση / Remove</button>
          </div>
        ))}
        {blackout.length < 20 && <button type="button" className="secondary" onClick={() => setBlackout((list) => [...list, { from: "", to: "" }])}>+ Περίοδος / Period</button>}
      </fieldset>
      <p><small>Ο κωδικός απορρίπτεται στο booking engine αν έστω μία νύχτα της διαμονής πέφτει εκτός του διαστήματος ή μέσα σε εξαιρούμενη περίοδο. Οι όροι αναφέρονται και στο μήνυμα γενεθλίων.</small></p>
      {canEdit && <button type="button" onClick={save}>Αποθήκευση / Save</button>}
      <p className="notice" role="status">{msg}</p>
    </article>
  );
}
