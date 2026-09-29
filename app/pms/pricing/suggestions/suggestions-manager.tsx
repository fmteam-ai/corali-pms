"use client";
import { useState } from "react";
import type { Suggestion } from "@/lib/pricing-suggestions";

type Row = Suggestion & { key: string; rooms: number };
const reasons: Record<Suggestion["reason"], string> = {
  high_demand: "Πολύ υψηλή ζήτηση (≥85%) εντός 45 ημερών",
  strong_demand: "Υψηλή ζήτηση (≥70%) εντός 30 ημερών",
  low_demand_close_in: "Χαμηλή πληρότητα (≤35%) εντός 14 ημερών",
  very_low_close_in: "Πολύ χαμηλή πληρότητα (≤20%) εντός 7 ημερών",
};

export function SuggestionsManager({ initial, canDecide }: { initial: Row[]; canDecide: boolean }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState("");
  async function decide(row: Row, action: "approve" | "dismiss") {
    if (action === "approve" && !confirm(`Δημιουργία ειδικής τιμής ${row.percent > 0 ? "+" : ""}${row.percent}% για ${row.roomType} ${row.startsOn} → ${row.endsOn};`)) return;
    const r = await fetch("/api/pms/pricing-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, key: row.key }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setRows(d.suggestions); setMsg(action === "approve" ? "Εγκρίθηκε· δημιουργήθηκε ειδική τιμή." : "Απορρίφθηκε."); }
    else setMsg(d.error === "SUGGESTION_EXPIRED" ? "Η πρόταση άλλαξε· ανανεώστε τη σελίδα." : "Η ενέργεια απέτυχε.");
  }
  if (!rows.length) return <p>Δεν υπάρχουν ανοιχτές προτάσεις αυτή τη στιγμή.</p>;
  return (
    <>
      <div className="tableWrap"><table><thead><tr><th>Τύπος</th><th>Περίοδος</th><th>Πληρότητα</th><th>Πρόταση</th><th>Αιτία</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key}>
            <td>{r.roomType}<small>{r.rooms} δωμάτια</small></td>
            <td>{r.startsOn} → {r.endsOn}</td>
            <td>{Math.round(r.averageOccupancy * 100)}%</td>
            <td><b className={r.percent > 0 ? "credit" : "debit"}>{r.percent > 0 ? "+" : ""}{r.percent}%</b></td>
            <td>{reasons[r.reason]}</td>
            <td className="rowActions">{canDecide && <><button type="button" onClick={() => decide(r, "approve")}>Έγκριση</button><button type="button" className="secondaryButton" onClick={() => decide(r, "dismiss")}>Απόρριψη</button></>}</td>
          </tr>
        ))}</tbody></table></div>
      <p className="notice" role="status">{msg}</p>
    </>
  );
}
