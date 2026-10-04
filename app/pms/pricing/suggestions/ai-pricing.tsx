"use client";
import { useState } from "react";
import type { PricingRecommendation } from "@/lib/pricing-ai-core";

type Line = PricingRecommendation & { key: string; on: boolean; rate: number };
const confidence = { low: "χαμηλή", medium: "μέτρια", high: "υψηλή" } as const;
const errors: Record<string, string> = {
  AI_NOT_CONFIGURED: "Δεν έχει οριστεί κλειδί Anthropic (Claude). Προσθέστε το στο ⚙️ Γενικά → Συνδέσεις.",
  TOO_MANY_REQUESTS: "Πολλές αναλύσεις σε λίγο χρόνο· δοκιμάστε ξανά αργότερα.",
  AI_UNAVAILABLE: "Ο AI δεν είναι διαθέσιμος αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγο.",
};

export function AiPricing({ aiConfigured, canApply }: { aiConfigured: boolean; canApply: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [compNights, setCompNights] = useState(0);

  async function analyze() {
    setBusy(true); setMsg("Ο AI αναλύει περίοδο, διαθεσιμότητα και ανταγωνισμό… (έως 1–2 λεπτά)");
    try {
      const r = await fetch("/api/pms/pricing-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "analyze" }) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setMsg(errors[d.error] ?? errors.AI_UNAVAILABLE); return; }
      setSummary(d.summary); setCompNights(Number(d.competitorNights) || 0);
      setLines((d.recommendations as PricingRecommendation[]).map((x, i) => ({ ...x, key: `${i}`, on: x.change_percent !== 0, rate: x.recommended_rate_eur })));
      setMsg(d.recommendations.length ? "" : "Ο AI δεν προτείνει αλλαγές: οι τρέχουσες τιμές φαίνονται σωστές.");
    } catch { setMsg(errors.AI_UNAVAILABLE); } finally { setBusy(false); }
  }
  async function apply() {
    const chosen = (lines ?? []).filter((l) => l.on && l.rate > 0);
    if (!chosen.length || !confirm(`Δημιουργία ${chosen.length} τιμών περιόδου από τις προτάσεις του AI;`)) return;
    setBusy(true);
    try {
      const items = chosen.map((l) => ({ roomType: l.room_type, startsOn: l.starts_on, endsOn: l.ends_on, priceCents: Math.round(l.rate * 100), note: l.reasoning.slice(0, 300) }));
      const r = await fetch("/api/pms/pricing-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", items }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setLines((v) => (v ?? []).filter((l) => !(l.on && l.rate > 0))); setMsg(`Εφαρμόστηκαν ${d.applied} τιμές. Θα τις βρείτε στο Τιμολόγηση → Τιμές περιόδου (με όνομα «AI · …»), όπου μπορείτε να τις αλλάξετε ή να τις διαγράψετε.`); }
      else setMsg(d.error === "INVALID_INPUT" ? "Ελέγξτε τις τιμές (από €10 έως €5.000)." : "Η εφαρμογή απέτυχε.");
    } finally { setBusy(false); }
  }
  const set = (key: string, patch: Partial<Line>) => setLines((v) => (v ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="hubCard aiPricing">
      <div className="aiPricingHead">
        <div>
          <h2>✨ Πρόταση τιμών με AI</h2>
          <p>Ο Claude εξετάζει για τις επόμενες 9 εβδομάδες, ανά κατηγορία δωματίου: την εποχή στην Πάρο, την πληρότητα και τον ρυθμό κρατήσεων, την πληρότητα της ίδιας περιόδου πέρσι και τις τιμές παρόμοιων καταλυμάτων της περιοχής (από τον Rate shopper). Καμία τιμή δεν αλλάζει χωρίς την έγκρισή σας και καμία πρόταση δεν απέχει πάνω από ±35% από την τρέχουσα τιμή.</p>
        </div>
        <button type="button" disabled={busy || !aiConfigured} onClick={analyze}>{busy && !lines ? "Ανάλυση…" : lines ? "Νέα ανάλυση" : "Ανάλυση τιμών"}</button>
      </div>
      {!aiConfigured && <p className="notice">{errors.AI_NOT_CONFIGURED}</p>}
      {summary && <p className="aiSummary">{summary}</p>}
      {lines && (
        <p><small>{compNights ? `Δεδομένα ανταγωνισμού: ${compNights} τιμές-νύχτες.` : "Δεν υπάρχουν τιμές ανταγωνισμού για αυτές τις ημερομηνίες· ο AI βασίστηκε μόνο σε εποχή και διαθεσιμότητα. Προσθέστε τιμές στο Revenue analytics → Rate shopper."}</small></p>
      )}
      {lines && lines.length > 0 && (
        <>
          <div className="tableWrap"><table><thead><tr><th /><th>Τύπος</th><th>Περίοδος</th><th>Τρέχουσα</th><th>Πρόταση €/νύχτα</th><th>Αιτιολόγηση</th></tr></thead>
            <tbody>{lines.map((l) => {
              const diff = Math.round(((l.rate - l.current_rate_eur) / l.current_rate_eur) * 100);
              return (
                <tr key={l.key}>
                  <td><input type="checkbox" aria-label="Επιλογή" checked={l.on} disabled={!canApply} onChange={(e) => set(l.key, { on: e.target.checked })} /></td>
                  <td>{l.room_type}</td>
                  <td>{l.starts_on} → {l.ends_on}</td>
                  <td>€{l.current_rate_eur}</td>
                  <td><input type="number" min={10} max={5000} step={1} value={l.rate} disabled={!canApply} onChange={(e) => set(l.key, { rate: Math.round(Number(e.target.value)) })} style={{ width: "6em" }} /> <b className={diff > 0 ? "credit" : diff < 0 ? "debit" : ""}>{diff > 0 ? "+" : ""}{diff}%</b></td>
                  <td>{l.reasoning}<small>Βεβαιότητα: {confidence[l.confidence]}</small></td>
                </tr>
              );
            })}</tbody></table></div>
          {canApply && <button type="button" disabled={busy || !lines.some((l) => l.on)} onClick={apply}>Εφαρμογή επιλεγμένων</button>}
        </>
      )}
      <p className="notice" role="status">{msg}</p>
    </div>
  );
}
