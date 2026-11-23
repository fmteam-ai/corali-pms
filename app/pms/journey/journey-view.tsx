"use client";
import Link from "next/link";
import { useState } from "react";
import type { JourneyStay, automationHealth } from "@/lib/journey";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

type Health = Awaited<ReturnType<typeof automationHealth>>;
const ICON: Record<string, string> = { succeeded: "✓", failed: "✕", unconfirmed: "?", pending: "…", skipped: "–" };
const LABEL: Record<string, { el: string; en: string }> = {
  succeeded: { el: "Επιτυχές", en: "Succeeded" }, failed: { el: "Απέτυχε", en: "Failed" }, unconfirmed: { el: "Μη επιβεβαιωμένο", en: "Unconfirmed" },
  pending: { el: "Σε εξέλιξη", en: "In progress" }, skipped: { el: "Δεν ισχύει", en: "Not applicable" }, ok: { el: "OK", en: "OK" }, timeout: { el: "Λήξη χρόνου", en: "Timed out" },
};

export function JourneyView({ lang, initialStays, initialHealth, initialTab, canAct }: { lang: PmsLang; initialStays: JourneyStay[]; initialHealth: Health; initialTab: "stays" | "automations"; canAct: boolean }) {
  const el = lang === "el";
  const [tab, setTab] = useState(initialTab);
  const [stays, setStays] = useState(initialStays);
  const [health, setHealth] = useState(initialHealth);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }) : "—");
  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/journey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(el ? "Δεν ολοκληρώθηκε. Δοκιμάστε ξανά." : "Not done. Please try again."); return; }
      setStays(d.stays); setHealth(d.health); setMsg(ok);
    } finally { setBusy(false); }
  }
  const failing = stays.filter((s) => s.actions.some((a) => a.status === "failed")).length;
  const badSteps = health.steps.filter((s) => s.status !== "ok").length;
  return (
    <div className="jyPage">
      <nav className="prcNav" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "stays"} className={tab === "stays" ? "current" : ""} onClick={() => setTab("stays")}>{el ? "Διαμονές" : "Stays"}{failing ? ` (${failing} ✕)` : ""}</button>
        <button type="button" role="tab" aria-selected={tab === "automations"} className={tab === "automations" ? "current" : ""} onClick={() => setTab("automations")}>{el ? "Αυτοματισμοί" : "Automations"}{badSteps ? ` (${badSteps} ✕)` : ""}</button>
      </nav>
      <p className="notice" role="status">{msg}</p>
      {tab === "stays" ? (
        <>
          {canAct && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "run" }, el ? "Έγινε έλεγχος όλων των διαμονών." : "All stays checked.")}>↻ {el ? "Έλεγχος τώρα" : "Check now"}</button>}
          {stays.length === 0 && <p className="muted">{el ? "Καμία άφιξη τις επόμενες 2 μέρες και κανένας πελάτης στο ξενοδοχείο." : "No arrivals in the next 2 days and no guests in house."}</p>}
          <div className="jyList">{stays.map((s) => (
            <article key={s.bookingId} className={`card jyStay sum-${s.summary}`}>
              <header onClick={() => setOpen(open === s.bookingId ? null : s.bookingId)}>
                <b>{s.room ? `${el ? "Δωμ." : "Room"} ${s.room}` : el ? "Χωρίς δωμάτιο" : "No room"} · {s.guest}</b>
                <small><Link href={`/pms/reservations?q=${encodeURIComponent(s.reference)}`}>{s.reference}</Link> · {s.checkIn.split("-").reverse().join("/")} → {s.checkOut.split("-").reverse().join("/")} · {s.status === "checked_in" ? (el ? "στο ξενοδοχείο" : "in house") : el ? "άφιξη" : "arriving"}</small>
                <span className="jyChips">{s.actions.map((a) => <span key={a.id} className={`jyChip st-${a.status}`} title={`${a.label}: ${LABEL[a.status]?.[lang] ?? a.status}`}>{ICON[a.status] ?? "·"} {a.label.split(" · ")[0]}</span>)}</span>
              </header>
              {open === s.bookingId && (
                <div className="jyDetail">
                  {s.actions.length === 0 && <p className="muted">{el ? "Δεν έχει γίνει έλεγχος ακόμη." : "Not checked yet."}</p>}
                  {s.actions.map((a) => (
                    <div key={a.id} className={`jyAction st-${a.status}`}>
                      <div><b>{ICON[a.status]} {a.label}</b> <span className={`jyStatus st-${a.status}`}>{LABEL[a.status]?.[lang] ?? a.status}</span></div>
                      <p>{a.detail}</p>
                      <small className="muted">{el ? "Έλεγχοι" : "Checks"}: {a.attempts} · {el ? "τελευταίος" : "last"} {when(a.updatedAt)}{a.status !== "succeeded" && a.status !== "skipped" ? ` · ${el ? "επόμενος" : "next"} ${when(a.nextCheckAt)}` : ""}</small>
                      {canAct && a.status !== "succeeded" && a.status !== "skipped" && (
                        <span className="actions">
                          <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "retry", id: a.id }, el ? "Έγινε νέα προσπάθεια." : "Retried.")}>↻ {el ? "Επανάληψη" : "Retry"}</button>
                          <button type="button" className="secondaryButton" disabled={busy} onClick={() => { const note = prompt(el ? "Τι ελέγξατε; (σημείωση)" : "What did you check? (note)"); if (note !== null) void post({ action: "confirm", id: a.id, note }, el ? "Επιβεβαιώθηκε." : "Confirmed."); }}>✓ {el ? "Επιβεβαίωση χειροκίνητα" : "Confirm by hand"}</button>
                        </span>
                      )}
                    </div>
                  ))}
                  {s.events.length > 0 && <details><summary>{el ? "Ιστορικό" : "History"} ({s.events.length})</summary><ul className="jyHistory">{s.events.map((e, i) => <li key={i}><small>{when(e.at)}</small> <b>{ICON[e.status]}</b> {e.detail} <small className="muted">{e.actor === "system" ? "" : `· ${e.actor.startsWith("user:") ? (el ? "χρήστης" : "user") : e.actor}`}</small></li>)}</ul></details>}
                </div>
              )}
            </article>
          ))}</div>
        </>
      ) : (
        <>
          <div className="card"><div className="tableWrap"><table>
            <thead><tr><th>{el ? "Αυτοματισμός" : "Automation"}</th><th>{el ? "Αποτέλεσμα" : "Result"}</th><th>{el ? "Τελευταία εκτέλεση" : "Last run"}</th><th>{el ? "Τελευταία επιτυχία" : "Last success"}</th><th>{el ? "Αποτυχίες" : "Failures"}</th></tr></thead>
            <tbody>{health.steps.map((s) => (
              <tr key={s.name} className={s.status !== "ok" ? "jyBad" : ""}><td><b>{s.name}</b></td><td><span className={`jyStatus st-${s.status === "ok" ? "succeeded" : "failed"}`}>{LABEL[s.status]?.[lang] ?? s.status}</span>{s.error ? <small className="muted"> · {s.error}</small> : null}</td><td>{when(s.lastRunAt)} <small className="muted">{s.ms} ms</small></td><td>{when(s.lastOkAt)}</td><td>{s.failures}/{s.runs}{s.consecutive ? <small className="error"> · {s.consecutive} {el ? "στη σειρά" : "in a row"}</small> : null}</td></tr>
            ))}</tbody>
          </table></div>{health.steps.length === 0 && <p className="muted">{el ? "Δεν έχει καταγραφεί ακόμη εκτέλεση (καταγράφεται από την v187 και μετά)." : "No runs recorded yet (recorded from v187)."}</p>}</div>
          <div className="card">
            <h2>{el ? "Αποτυχημένα μηνύματα πελατών (7 μέρες)" : "Failed guest messages (7 days)"}</h2>
            {health.failedMessages.length === 0 ? <p className="muted">{el ? "Κανένα." : "None."}</p> : <>
              {canAct && <button type="button" className="primaryAction" disabled={busy} onClick={() => void post({ action: "retry_messages" }, el ? "Μπήκαν ξανά σε αποστολή." : "Queued again.")}>↻ {el ? "Επανάληψη όλων" : "Retry all"}</button>}
              <div className="tableWrap"><table><tbody>{health.failedMessages.map((m) => <tr key={m.id}><td>{when(m.at)}</td><td>{m.reference} · {m.guest}</td><td>{m.event} · {m.channel}</td><td className="muted">{m.error}</td><td>{canAct && <button type="button" className="linkButton" disabled={busy} onClick={() => void post({ action: "retry_messages", id: m.id }, el ? "Μπήκε ξανά σε αποστολή." : "Queued again.")}>↻</button>}</td></tr>)}</tbody></table></div>
            </>}
          </div>
          <div className="card">
            <h2>{el ? "Συμφωνία οικονομικών (30 μέρες)" : "Financial reconciliation (30 days)"}</h2>
            <p className="muted">{el ? "Πληρωμές παρόχων" : "Provider payments"} €{(health.reconciliation.totals.providerCents / 100).toFixed(2)} · {el ? "πληρωμές online στο folio" : "online payments on folios"} €{(health.reconciliation.totals.folioOnlineCents / 100).toFixed(2)} · POS {el ? "χρεώσεις δωματίου" : "room charges"} €{(health.reconciliation.totals.posRoomCents / 100).toFixed(2)} · {el ? "παραγγελίες εφαρμογής" : "app orders"} €{(health.reconciliation.totals.appOrdersCents / 100).toFixed(2)}</p>
            {health.reconciliation.issues.length === 0 ? <p className="jyStatus st-succeeded">✓ {el ? "Καμία απόκλιση." : "No differences."}</p> : <ul className="jyHistory">{health.reconciliation.issues.map((i, n) => <li key={n}><b className="error">✕</b> {i.reference} · {i.detail}</li>)}</ul>}
          </div>
          {health.failures.length > 0 && <div className="card"><h2>{el ? "Ιστορικό αποτυχιών (30 μέρες)" : "Failure history (30 days)"}</h2><ul className="jyHistory">{health.failures.map((f, i) => <li key={i}><small>{when(f.at)}</small> <b>{f.name}</b> · {LABEL[f.status]?.[lang] ?? f.status} <small className="muted">{f.error}</small></li>)}</ul></div>}
        </>
      )}
    </div>
  );
}
