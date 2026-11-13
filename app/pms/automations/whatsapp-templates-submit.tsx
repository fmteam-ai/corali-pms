"use client";
import { useCallback, useEffect, useState } from "react";

type Row = { name: string; language: string; status: string; rejectedReason: string | null; category: string | null };
type Outcome = { name: string; language: string; result: "created" | "updated" | "exists" | "failed"; status?: string; error?: string };
const LANGS = ["el", "en", "fr", "de", "it", "es"] as const;
const NAMES = ["booking_confirmation", "pre_arrival", "online_checkin", "welcome_message", "balance_reminder", "pre_departure", "payment_failed", "booking_cancelled", "review_request"];
const STATUS: Record<string, [string, string]> = {
  APPROVED: ["✓", "Εγκρίθηκε"], PENDING: ["⏳", "Σε έλεγχο"], IN_APPEAL: ["⏳", "Σε ένσταση"], REJECTED: ["✗", "Απορρίφθηκε"],
  PAUSED: ["⏸", "Σε παύση"], DISABLED: ["✗", "Απενεργοποιημένο"], FLAGGED: ["⚠", "Με σήμανση"], LIMIT_EXCEEDED: ["✗", "Όριο"],
};

/** One button that sends the PMS WhatsApp templates (9 × 6 languages) to Meta, and their review status. */
export function WhatsAppTemplatesSubmit({ editable }: { editable: boolean }) {
  const [state, setState] = useState<{ connected: boolean; rows: Row[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [report, setReport] = useState<{ outcomes: Outcome[]; filled: number; failed: number } | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await (await fetch("/api/pms/whatsapp-templates", { cache: "no-store" })).json();
      if (d.ok) setState({ connected: Boolean(d.connected), rows: d.templates ?? [] });
      else { setState({ connected: true, rows: [] }); setError(d.detail ? `Η Meta απάντησε: ${d.detail}` : "Δεν ήταν δυνατή η ανάγνωση από τη Meta."); }
    } catch { setError("Δεν ήταν δυνατή η ανάγνωση της κατάστασης."); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  async function submit() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 6000); return; }
    setArmed(false); setBusy(true); setError(""); setReport(null);
    try {
      const r = await fetch("/api/pms/whatsapp-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json().catch(() => ({}));
      if (d.outcomes) setReport({ outcomes: d.outcomes, filled: d.filled ?? 0, failed: d.failed ?? 0 });
      else setError(d.error === "NOT_CONNECTED" ? "Το WhatsApp δεν είναι συνδεδεμένο." : d.error === "TOO_MANY_ATTEMPTS" ? "Πολλές υποβολές σε λίγο χρόνο — δοκιμάστε ξανά σε μισή ώρα." : d.detail ? `Η Meta απάντησε: ${d.detail}` : "Η υποβολή απέτυχε.");
      await load();
    } finally { setBusy(false); }
  }

  if (!state) return <div className="waSubmit"><p className="muted">Έλεγχος κατάστασης στη Meta…</p></div>;
  if (!state.connected) return (
    <div className="waSubmit">
      <p><b>Αυτόματη υποβολή στη Meta</b> — διαθέσιμη μόλις συνδεθεί το WhatsApp: <a href="/pms/integrations">Ενσωματώσεις → WhatsApp → Γρήγορη σύνδεση</a>.</p>
    </div>
  );
  const byKey = new Map(state.rows.map((r) => [`${r.name}|${r.language}`, r]));
  const approved = state.rows.filter((r) => r.status === "APPROVED").length;
  const failedReport = report?.outcomes.filter((o) => o.result === "failed") ?? [];
  return (
    <div className="waSubmit">
      <p><b>Αυτόματη υποβολή στη Meta</b> — 9 πρότυπα σε 6 γλώσσες (54). Τα νέα στέλνονται για έλεγχο, όσα απορρίφθηκαν ξαναστέλνονται διορθωμένα, όσα εγκρίθηκαν ή είναι σε έλεγχο μένουν ως έχουν. Τα ονόματα γράφονται αυτόματα στους Αυτοματισμούς όπου είναι κενά.</p>
      <div className="waSubmitActions">
        {editable && <button type="button" className={armed ? "danger" : "primary"} disabled={busy} onClick={() => void submit()}>{busy ? "Υποβολή… (έως 1 λεπτό)" : armed ? "Πατήστε ξανά για επιβεβαίωση" : "📤 Υποβολή όλων στη Meta"}</button>}
        <button type="button" className="secondaryButton" disabled={busy} onClick={() => void load()}>↻ Ανανέωση κατάστασης</button>
        <span className="muted">{approved}/54 εγκεκριμένα</span>
      </div>
      {error && <p role="alert" className="formError">{error}</p>}
      {report && <p className={report.failed ? "formError" : "muted"} role="status">{report.failed ? `${54 - report.failed} από 54 στάλθηκαν· ${report.failed} απέτυχαν (δείτε παρακάτω).` : "✓ Όλα στάλθηκαν στη Meta."}{report.filled ? ` Συμπληρώθηκαν ${report.filled} ονόματα στους Αυτοματισμούς — ανανεώστε τη σελίδα για να τα δείτε.` : ""}</p>}
      {failedReport.length > 0 && <ul className="waSubmitErrors">{failedReport.map((o) => <li key={`${o.name}-${o.language}`}><code>{o.name}</code> ({o.language.toUpperCase()}): {o.error}</li>)}</ul>}
      <div className="tableWrap">
        <table className="waStatusTable">
          <thead><tr><th>Πρότυπο</th>{LANGS.map((l) => <th key={l}>{l.toUpperCase()}</th>)}</tr></thead>
          <tbody>
            {NAMES.map((n) => (
              <tr key={n}><td><code>{n}</code></td>{LANGS.map((l) => {
                const r = byKey.get(`${n}|${l}`); const [icon, label] = r ? STATUS[r.status] ?? ["•", r.status] : ["—", "Δεν έχει υποβληθεί"];
                return <td key={l} title={r?.rejectedReason ? `${label}: ${r.rejectedReason}` : label} className={r ? `waStatus waStatus-${r.status.toLowerCase()}` : "waStatus"}>{icon}</td>;
              })}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">✓ εγκρίθηκε · ⏳ σε έλεγχο (συνήθως λίγα λεπτά έως 24 ώρες) · ✗ απορρίφθηκε (περάστε το ποντίκι για την αιτία) · — δεν έχει υποβληθεί.</p>
    </div>
  );
}
