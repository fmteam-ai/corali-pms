import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sentinelIncidents } from "../../../scripts/sentinel-core.mjs";

export const dynamic = "force-dynamic";
const SEV: Record<string, string> = { critical: "ΚΡΙΣΙΜΟ", high: "Υψηλό", medium: "Μέτριο" };
const ST: Record<string, string> = { open: "Ανοιχτό", recovering: "Σε αποκατάσταση (επιβεβαιώνεται)", resolved: "Επιλύθηκε — αποκατάσταση επιβεβαιώθηκε" };
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("el-GR", { timeZone: "Europe/Athens", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

/** v201 Corali Sentinel: what does not work, why (evidence), how it is fixed and confirmed. Read-only. */
export default async function SentinelPage() {
  const u = await requireUser("audit.read");
  const d = await sentinelIncidents({ pool: db(), owner: u.ownerId });
  const last = d.runs[0];
  return (
    <section className="rcPage">
      <div className="pageTitle"><div><h1>Corali Sentinel</h1><p>Παρακολούθηση μόνο για ανάγνωση: για κάθε πρόβλημα, τι δεν λειτουργεί, γιατί (με αποδεικτικά) και πώς διορθώνεται και επιβεβαιώνεται. Ο Sentinel δεν αλλάζει δεδομένα, δεν επανεκκινεί υπηρεσίες και δεν στέλνει εντολές σε συσκευές.</p></div></div>
      <p className={`card rcItem lv-${!last ? "warn" : last.status === "ok" ? "ok" : "fail"}`}>{last ? `Τελευταίος έλεγχος ${when(last.finishedAt ?? last.startedAt)} · ${last.status} · ${last.checks} ευρήματα · ${last.open} ανοιχτά · correlation ${last.correlationId.slice(0, 8)}` : "Ο Sentinel δεν έχει τρέξει ακόμη — προσθέστε το cron run-sentinel.mjs (DEPLOY-CPANEL.md)."}</p>
      {d.incidents.length === 0 && <p className="card">Κανένα συμβάν.</p>}
      <div className="rcGrid">{d.incidents.map((i) => (
        <article key={i.id} className={`card rcArea st-${i.status === "resolved" ? "ok" : i.severity === "medium" ? "warn" : "fail"}`}>
          <header><h2>{SEV[i.severity] ?? i.severity} · {i.title}</h2></header>
          <p className="rcSummary">{ST[i.status] ?? i.status} · πρώτη εμφάνιση {when(i.firstSeenAt)} · τελευταία {when(i.lastSeenAt)} · {i.occurrences} έλεγχοι</p>
          <p><b>Επίπτωση:</b> {i.report.impact}</p>
          <p><b>Επιβεβαιωμένα:</b></p><ul>{i.report.confirmed.map((c, k) => <li key={k}><small>{c}</small></li>)}</ul>
          <p><b>Πιθανές αιτίες (όχι επιβεβαιωμένες):</b></p><ul>{i.report.probableCauses.map((c, k) => <li key={k}><small>{c}</small></li>)}</ul>
          <p><b>Προτεινόμενη διόρθωση:</b></p><ul>{i.report.proposedFix.map((c, k) => <li key={k}><small>{c}</small></li>)}</ul>
          <p><b>Επαλήθευση:</b></p><ul>{i.report.validation.map((c, k) => <li key={k}><small>{c}</small></li>)}</ul>
          {i.report.recovery && <p className="rcItem lv-ok">Αποκατάσταση επιβεβαιώθηκε {when(i.report.recovery.verifiedAt)}: {i.report.recovery.method}</p>}
          <a className="linkButton" href={`/api/pms/sentinel?report=${i.id}`}>Αναφορά (Markdown) →</a>
        </article>
      ))}</div>
      <details className="card"><summary>Κάλυψη παρακολούθησης ({d.inventory.length} υπηρεσίες, εργασίες, ενσωματώσεις, συσκευές)</summary>
        <table className="table"><thead><tr><th>Υποσύστημα</th><th>Είδος</th><th>Παρακολουθείται από</th></tr></thead>
          <tbody>{d.inventory.map((x) => <tr key={x.id}><td>{x.el}{x.critical ? " ★" : ""}</td><td>{x.kind}</td><td><small>{x.checks.join(", ")}</small></td></tr>)}</tbody></table>
      </details>
    </section>
  );
}
