"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { GuestExperience } from "@/lib/guest-experience";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

type Tab = "comfort" | "turnover" | "causes";
const LEVEL: Record<string, { el: string; en: string; cls: string }> = {
  ok: { el: "Χωρίς εκκρεμότητες", en: "Nothing pending", cls: "ok" }, attention: { el: "Χρειάζεται προσοχή", en: "Needs attention", cls: "warn" }, act: { el: "Χρειάζεται ενέργεια", en: "Needs action", cls: "fail" },
};
const STEP: Record<string, { el: string; en: string }> = {
  cleaning: { el: "Καθαρισμός & επιθεώρηση", en: "Cleaning & inspection" }, equipment: { el: "Έλεγχος εξοπλισμού", en: "Equipment check" },
  tv: { el: "Αποσύνδεση λογαριασμών TV", en: "TV accounts cleared" }, wifi: { el: "Ανάκληση Wi-Fi", en: "Wi-Fi revoked" }, access: { el: "Κάρτες πρόσβασης", en: "Access cards" },
};
const STATE: Record<string, { icon: string; cls: string }> = { done: { icon: "✓", cls: "ok" }, pending: { icon: "…", cls: "warn" }, failed: { icon: "✕", cls: "fail" }, na: { icon: "–", cls: "inactive" } };
const TSTATUS: Record<string, { el: string; en: string; cls: string }> = {
  verified: { el: "Επιβεβαιώθηκε", en: "Verified", cls: "ok" }, ready: { el: "Έτοιμο για επιβεβαίωση", en: "Ready to verify", cls: "ok" },
  pending: { el: "Σε εξέλιξη", en: "In progress", cls: "warn" }, failed: { el: "Πρόβλημα", en: "Problem", cls: "fail" },
};

export function ExperienceView({ lang, initial, initialTab, canAct }: { lang: PmsLang; initial: GuestExperience; initialTab: Tab; canAct: boolean }) {
  const el = lang === "el";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setInterval(() => void fetch("/api/pms/guest-experience", { cache: "no-store" }).then((r) => r.json()).then((d) => d.ok && setData(d)).catch(() => undefined), 60_000); return () => clearInterval(id); }, []);
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : "—");
  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/guest-experience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error === "REASON_REQUIRED" ? (el ? "Γράψτε τον λόγο." : "Give a reason.") : (el ? "Δεν ολοκληρώθηκε." : "Not done.")); return; }
      setData(d);
      if (d.info && d.info.ok === false && d.info.blocking) { setMsg(`${el ? "Δεν επιβεβαιώνεται ακόμη" : "Cannot verify yet"}: ${d.info.blocking.join(" · ")}`); return; }
      setMsg(ok);
    } finally { setBusy(false); }
  }
  const c = data.comfort, t = data.turnover, rc = data.causes;
  return (
    <div className="rcPage">
      <div className="rcBar">
        <span className="prcNav" role="tablist">
          {([["comfort", el ? `Άνεση (${c.summary.act + c.summary.attention}/${c.summary.rooms})` : `Comfort (${c.summary.act + c.summary.attention}/${c.summary.rooms})`], ["turnover", el ? `Παράδοση δωματίων (${t.turnovers.filter((x) => x.status !== "verified").length})` : `Turnover (${t.turnovers.filter((x) => x.status !== "verified").length})`], ["causes", el ? `Αιτίες (${rc.findings.filter((f) => !f.action).length})` : `Causes (${rc.findings.filter((f) => !f.action).length})`]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "current" : ""} onClick={() => setTab(k)}>{label}</button>
          ))}
        </span>
      </div>
      <p className="notice" role="status">{msg}</p>

      {tab === "comfort" && (
        <>
          <p className="muted">{el ? "Ο δείκτης (0–100) μετρά μόνο καταστάσεις που ελέγχει το ξενοδοχείο: θερμοκρασία/υγρασία, ανοιχτά αιτήματα και η ηλικία τους, βλάβες, καθυστερημένες παραγγελίες, τηλεόραση και Wi-Fi. Ό,τι δεν μετριέται φαίνεται ως «άγνωστο»." : "The index (0–100) counts only conditions the hotel controls: temperature/humidity, open requests and their age, faults, late orders, TV and Wi-Fi. What is not measured is shown as «unknown»."}</p>
          {c.rooms.length === 0 && <p className="card">{el ? "Κανένα κατειλημμένο δωμάτιο." : "No occupied room."}</p>}
          <div className="rcGrid">{c.rooms.map((r) => (
            <article key={r.roomId} className={`card rcArea st-${LEVEL[r.level].cls}`}>
              <header><span className="rcDot" aria-hidden>{r.score}</span><h2>{el ? "Δωμάτιο" : "Room"} {r.code}</h2></header>
              <p className="rcSummary">{LEVEL[r.level][lang]} · {r.guest} · {el ? "αναχώρηση" : "departs"} {r.checkOut}</p>
              {r.signals.length > 0 && <ul className="rcItems">{r.signals.map((s) => <li key={s.key} className={`rcItem lv-${s.penalty >= 15 ? "fail" : "warn"}`}><span className="rcDot" aria-hidden>−{s.penalty}</span><span><b>{s.label}</b>: {s.detail}</span></li>)}</ul>}
              {r.unknown.length > 0 && <small className="muted">{el ? "Άγνωστο" : "Unknown"}: {r.unknown.map((u) => `${u.label} (${u.detail})`).join(" · ")}</small>}
              <Link href={`/pms/reservations?q=${encodeURIComponent(r.reference)}`} className="linkButton">{r.reference} →</Link>
            </article>
          ))}</div>
        </>
      )}

      {tab === "turnover" && (
        <>
          <p className="muted">{el ? "Μετά από κάθε check-out: καθαρισμός με έγκριση επιθεώρησης, έλεγχος εξοπλισμού από άτομο, αποσύνδεση λογαριασμών TV, ανάκληση Wi-Fi και καρτών. Η τελική επιβεβαίωση γίνεται μόνο όταν όλα τα βήματα που ισχύουν είναι ολοκληρωμένα, και αποθηκεύεται με τα στοιχεία κάθε βήματος." : "After each check-out: cleaning approved at inspection, an equipment check by a person, TV accounts cleared, Wi-Fi and cards revoked. The final confirmation is possible only when every applicable step is done, and is stored with each step's evidence."}</p>
          {t.turnovers.length === 0 && <p className="card">{el ? "Κανένα check-out τις τελευταίες 3 ημέρες." : "No check-out in the last 3 days."}</p>}
          <div className="rcGrid">{t.turnovers.map((x) => (
            <article key={x.bookingId} className={`card rcArea st-${TSTATUS[x.status].cls}`}>
              <header><span className="rcDot" aria-hidden>{x.status === "verified" ? "✓" : x.status === "failed" ? "✕" : "…"}</span><h2>{el ? "Δωμάτιο" : "Room"} {x.code}</h2></header>
              <p className="rcSummary">{TSTATUS[x.status][lang]} · {x.reference} · check-out {when(x.checkoutAt)}{x.nextArrival ? ` · ${el ? "επόμενη άφιξη" : "next arrival"} ${x.nextArrival}` : ""}</p>
              <ul className="rcItems">{Object.entries(x.steps).map(([k, s]) => <li key={k} className={`rcItem lv-${STATE[s.state].cls}`}><span className="rcDot" aria-hidden>{STATE[s.state].icon}</span><span><b>{STEP[k]?.[lang] ?? k}</b>: {s.detail}</span></li>)}</ul>
              {x.status === "verified" && <small className="muted">{el ? "Επιβεβαίωσε" : "Verified by"} {x.verifiedBy} · {when(x.verifiedAt)}</small>}
              {canAct && x.status !== "verified" && x.steps.equipment?.state === "pending" && <button type="button" className="secondaryButton" disabled={busy} onClick={() => { const note = window.prompt(el ? "Σημείωση ελέγχου εξοπλισμού (προαιρετικά):" : "Equipment check note (optional):") ?? null; if (note !== null) void post({ action: "equipment", bookingId: x.bookingId, roomId: x.roomId, note }, el ? "Ο έλεγχος εξοπλισμού καταγράφηκε." : "Equipment check recorded."); }}>✓ {el ? "Έλεγχος εξοπλισμού OK" : "Equipment OK"}</button>}
              {canAct && x.status !== "verified" && <button type="button" className="primaryAction" disabled={busy || x.status !== "ready"} onClick={() => void post({ action: "verify", bookingId: x.bookingId }, el ? "Η παράδοση του δωματίου επιβεβαιώθηκε και καταγράφηκε." : "Room turnover verified and recorded.")}>{el ? "Οριστική επιβεβαίωση" : "Final confirmation"}</button>}
            </article>
          ))}</div>
        </>
      )}

      {tab === "causes" && (
        <>
          <p className="muted">{el ? `Επαναλαμβανόμενες αιτίες των τελευταίων ${rc.days} ημερών (${rc.events} καταγραφές προβλημάτων, ${rc.ratings} αξιολογήσεις). Οι διαφορές στις βαθμολογίες είναι συσχέτιση, όχι απόδειξη αιτίας· ευρήματα με πολύ μικρό δείγμα δεν εμφανίζονται.` : `Recurring causes of the last ${rc.days} days (${rc.events} recorded problems, ${rc.ratings} ratings). Rating differences are an association, not proof of cause; findings with too small a sample are not shown.`}</p>
          {rc.findings.length === 0 && <p className="card">{el ? "Δεν βρέθηκε επαναλαμβανόμενη αιτία." : "No recurring cause found."}</p>}
          <div className="rcGrid">{rc.findings.map((f) => (
            <article key={f.key} className={`card rcArea st-${f.action ? "ok" : f.severity === "high" ? "fail" : "warn"}`}>
              <header><span className="rcDot" aria-hidden>{f.sample}</span><h2>{f.title}</h2></header>
              <ul className="rcItems">{f.evidence.map((e, i) => <li key={i} className="rcItem"><span className="rcDot" aria-hidden>i</span><span>{e}</span></li>)}</ul>
              <p className="rcSummary">{f.suggestion}</p>
              {f.action && <small className="muted">{f.action.status === "maintenance" ? (el ? `Δημιουργήθηκε εργασία συντήρησης #${f.action.maintenanceId}` : `Maintenance task #${f.action.maintenanceId} created`) : (el ? "Αγνοήθηκε" : "Dismissed")} · {when(f.action.at)}</small>}
              {canAct && !f.action && (
                <span>
                  {f.roomId && <button type="button" className="primaryAction" disabled={busy} onClick={() => void post({ action: "finding", key: f.key, kind: "maintenance" }, el ? "Δημιουργήθηκε εργασία συντήρησης." : "Maintenance task created.")}>{el ? "Δημιουργία εργασίας συντήρησης" : "Create maintenance task"}</button>}
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => { const reason = window.prompt(el ? "Γιατί αγνοείται; (καταγράφεται)" : "Why dismiss? (recorded)") ?? ""; if (reason.trim()) void post({ action: "finding", key: f.key, kind: "dismiss", reason }, el ? "Καταγράφηκε." : "Recorded."); }}>{el ? "Αγνόηση" : "Dismiss"}</button>
                </span>
              )}
            </article>
          ))}</div>
        </>
      )}
    </div>
  );
}
