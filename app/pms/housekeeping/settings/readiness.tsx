"use client";
import { useState } from "react";

/** v186: rooms that housekeeping has not approved are not sold for today and nobody is checked into them. */
export function ReadinessSettings({ initial }: { initial: { blockSameDay: boolean; blockCheckin: boolean } }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  async function save(next: typeof s) {
    setS(next); setMsg("");
    const r = await fetch("/api/pms/housekeeping/readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
    setMsg(r?.ok ? "Αποθηκεύτηκε." : "Η αποθήκευση απέτυχε.");
  }
  return (
    <section className="card hkInspectors">
      <h2>Δωμάτια που δεν είναι έτοιμα</h2>
      <p className="muted">«Έτοιμο» είναι ένα δωμάτιο χωρίς ανοιχτή εργασία housekeeping (για καθάρισμα, σε καθαρισμό, σε αναμονή έγκρισης, βλάβη). Για αφίξεις <b>επόμενων</b> ημερών το δωμάτιο πωλείται κανονικά, αφού θα έχει καθαριστεί ως τότε.</p>
      <label className="check"><input type="checkbox" checked={s.blockSameDay} onChange={(e) => void save({ ...s, blockSameDay: e.target.checked })} /> Να μην πωλείται για άφιξη <b>σήμερα</b> (σελίδα κρατήσεων και Booking.com / Airbnb / Expedia μέσω channel manager) μέχρι να εγκριθεί. Μόλις εγκριθεί, γίνεται ξανά διαθέσιμο αυτόματα.</label>
      <label className="check"><input type="checkbox" checked={s.blockCheckin} onChange={(e) => void save({ ...s, blockCheckin: e.target.checked })} /> Να μη γίνεται check-in σε δωμάτιο που δεν έχει εγκριθεί.</label>
      <p className="notice" role="status">{msg}</p>
    </section>
  );
}
