"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { GuestExperience } from "@/lib/guest-experience";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";
import type { ComfortPolicy } from "../../../scripts/comfort-core.mjs";

type Tab = "comfort" | "turnover" | "causes";
const LEVEL: Record<string, { el: string; en: string; cls: string }> = {
  ok: { el: "Χωρίς εκκρεμότητες", en: "Nothing pending", cls: "ok" }, attention: { el: "Χρειάζεται προσοχή", en: "Needs attention", cls: "warn" }, act: { el: "Χρειάζεται ενέργεια", en: "Needs action", cls: "fail" },
};
const STEP: Record<string, { el: string; en: string }> = {
  cleaning: { el: "Καθαρισμός & επιθεώρηση", en: "Cleaning & inspection" }, equipment: { el: "Έλεγχος εξοπλισμού", en: "Equipment check" },
  tv: { el: "Αποσύνδεση λογαριασμών TV", en: "TV accounts cleared" }, wifi: { el: "Ανάκληση Wi-Fi", en: "Wi-Fi revoked" }, access: { el: "Κάρτες πρόσβασης", en: "Access cards" },
};
const STATE: Record<string, { icon: string; cls: string }> = { done: { icon: "✓", cls: "ok" }, pending: { icon: "…", cls: "warn" }, failed: { icon: "✕", cls: "fail" }, na: { icon: "–", cls: "inactive" } };
const CURRENT: Record<string, { el: string; en: string; cls: string }> = {
  ready: { el: "Τώρα: έτοιμο", en: "Now: ready", cls: "ok" }, not_ready: { el: "Τώρα: ΔΕΝ είναι έτοιμο", en: "Now: NOT ready", cls: "fail" }, occupied: { el: "Τώρα: με πελάτη", en: "Now: occupied", cls: "inactive" },
};
const RESOLUTION: Record<string, { el: string; en: string; cls: string }> = {
  open_task: { el: "Η εργασία είναι ανοιχτή", en: "Task open", cls: "warn" }, monitoring: { el: "Παρακολούθηση μετά την επισκευή", en: "Monitoring after the fix", cls: "warn" },
  effective: { el: "Η επισκευή έλυσε το πρόβλημα", en: "The fix worked", cls: "ok" }, recurred: { el: "Το πρόβλημα επανεμφανίστηκε", en: "The problem came back", cls: "fail" },
};
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
  const [editPolicy, setEditPolicy] = useState(false);
  const [pol, setPol] = useState<ComfortPolicy>(initial.comfort.policy);
  useEffect(() => { const id = setInterval(() => void fetch("/api/pms/guest-experience", { cache: "no-store" }).then((r) => r.json()).then((d) => d.ok && setData(d)).catch(() => undefined), 60_000); return () => clearInterval(id); }, []);
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : "—");
  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/guest-experience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error === "REASON_REQUIRED" ? (el ? "Χρειάζεται ουσιαστική αιτιολογία (τουλάχιστον 10 χαρακτήρες με λέξεις)." : "A real reason is needed (at least 10 characters with words).") : (el ? "Δεν ολοκληρώθηκε." : "Not done.")); return; }
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
          <p className="muted">{el ? "Όρια" : "Limits"}: {el ? "ψύξη" : "cooling"} {c.policy.cooling.min}–{c.policy.cooling.max}°C · {el ? "θέρμανση" : "heating"} {c.policy.heating.min}–{c.policy.heating.max}°C ({el ? "μήνες" : "months"} {c.policy.heatingMonths.join(", ")}) · {el ? "υγρασία" : "humidity"} ≤{c.policy.humidMax}% · {el ? "μέτρηση έως" : "reading up to"} {c.policy.staleMinutes}′{Object.keys(c.policy.rooms).length ? ` · ${Object.keys(c.policy.rooms).length} ${el ? "δωμάτια με δικά τους όρια" : "rooms with own limits"}` : ""} {canAct && <button type="button" className="linkButton" onClick={() => { setPol(c.policy); setEditPolicy(!editPolicy); }}>{el ? "Αλλαγή ορίων" : "Change limits"}</button>}</p>
          {editPolicy && canAct && (
            <form className="card" onSubmit={(e) => { e.preventDefault(); void post({ action: "policy", settings: pol }, el ? "Τα όρια αποθηκεύτηκαν." : "Limits saved.").then(() => setEditPolicy(false)); }}>
              <div className="formGrid">
                <label>{el ? "Ψύξη από" : "Cooling from"}<input type="number" step="0.5" value={pol.cooling.min} onChange={(e) => setPol({ ...pol, cooling: { ...pol.cooling, min: Number(e.target.value) } })} /></label>
                <label>{el ? "έως" : "to"}<input type="number" step="0.5" value={pol.cooling.max} onChange={(e) => setPol({ ...pol, cooling: { ...pol.cooling, max: Number(e.target.value) } })} /></label>
                <label>{el ? "Θέρμανση από" : "Heating from"}<input type="number" step="0.5" value={pol.heating.min} onChange={(e) => setPol({ ...pol, heating: { ...pol.heating, min: Number(e.target.value) } })} /></label>
                <label>{el ? "έως" : "to"}<input type="number" step="0.5" value={pol.heating.max} onChange={(e) => setPol({ ...pol, heating: { ...pol.heating, max: Number(e.target.value) } })} /></label>
                <label>{el ? "Μήνες θέρμανσης (π.χ. 11,12,1,2,3)" : "Heating months (e.g. 11,12,1,2,3)"}<input value={pol.heatingMonths.join(",")} onChange={(e) => setPol({ ...pol, heatingMonths: e.target.value.split(/[,\s]+/).map(Number).filter((m) => m >= 1 && m <= 12) })} /></label>
                <label>{el ? "Διπλή βαρύτητα πέρα από (°C)" : "Double weight beyond (°C)"}<input type="number" step="0.5" value={pol.hardMargin} onChange={(e) => setPol({ ...pol, hardMargin: Number(e.target.value) })} /></label>
                <label>{el ? "Μέγιστη υγρασία (%)" : "Max humidity (%)"}<input type="number" value={pol.humidMax} onChange={(e) => setPol({ ...pol, humidMax: Number(e.target.value) })} /></label>
                <label>{el ? "Παλαιότητα μέτρησης (λεπτά)" : "Reading age (minutes)"}<input type="number" value={pol.staleMinutes} onChange={(e) => setPol({ ...pol, staleMinutes: Number(e.target.value) })} /></label>
              </div>
              <p className="muted">{el ? "Όρια ανά δωμάτιο (υπερισχύουν της περιόδου):" : "Per-room limits (override the season):"}</p>
              {c.rooms.map((r) => { const own = pol.rooms[String(r.roomId)]; return (
                <label key={r.roomId} className="inlineField">{r.code}
                  <input type="checkbox" checked={Boolean(own)} onChange={(e) => { const rooms = { ...pol.rooms }; if (e.target.checked) rooms[String(r.roomId)] = { min: pol.cooling.min, max: pol.cooling.max }; else delete rooms[String(r.roomId)]; setPol({ ...pol, rooms }); }} />
                  {own && <><input type="number" step="0.5" value={own.min} onChange={(e) => setPol({ ...pol, rooms: { ...pol.rooms, [String(r.roomId)]: { ...own, min: Number(e.target.value) } } })} />–<input type="number" step="0.5" value={own.max} onChange={(e) => setPol({ ...pol, rooms: { ...pol.rooms, [String(r.roomId)]: { ...own, max: Number(e.target.value) } } })} /></>}
                </label>
              ); })}
              <button type="submit" className="primaryAction" disabled={busy}>{el ? "Αποθήκευση ορίων" : "Save limits"}</button>
            </form>
          )}
          {c.rooms.length === 0 && <p className="card">{el ? "Κανένα κατειλημμένο δωμάτιο." : "No occupied room."}</p>}
          <div className="rcGrid">{c.rooms.map((r) => (
            <article key={r.roomId} className={`card rcArea st-${LEVEL[r.level].cls}`}>
              <header><span className="rcDot" aria-hidden>{r.score}</span><h2>{el ? "Δωμάτιο" : "Room"} {r.code}</h2></header>
              <p className="rcSummary">{LEVEL[r.level][lang]} · {r.guest} · {el ? "αναχώρηση" : "departs"} {r.checkOut} · {el ? "όριο" : "range"} {r.range.min}–{r.range.max}°C</p>
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
            <article key={x.bookingId} className={`card rcArea st-${x.regressed ? "fail" : TSTATUS[x.status].cls}`}>
              <header><span className="rcDot" aria-hidden>{x.status === "verified" ? "✓" : x.status === "failed" ? "✕" : "…"}</span><h2>{el ? "Δωμάτιο" : "Room"} {x.code}</h2></header>
              <p className="rcSummary">{TSTATUS[x.status][lang]} · {x.reference} · check-out {when(x.checkoutAt)}{x.nextArrival ? ` · ${el ? "επόμενη άφιξη" : "next arrival"} ${x.nextArrival}` : ""}</p>
              <ul className="rcItems">{Object.entries(x.steps).map(([k, s]) => <li key={k} className={`rcItem lv-${STATE[s.state].cls}`}><span className="rcDot" aria-hidden>{STATE[s.state].icon}</span><span><b>{STEP[k]?.[lang] ?? k}</b>: {s.detail}</span></li>)}</ul>
              {x.status === "verified" && <small className="muted">VERIFIED_AT {when(x.verifiedAt)} · {x.verifiedBy}</small>}
              <p className={`rcItem lv-${CURRENT[x.current.state].cls}`}><span className="rcDot" aria-hidden>{x.current.state === "ready" ? "✓" : x.current.state === "occupied" ? "–" : "✕"}</span><span><b>{CURRENT[x.current.state][lang]}</b> — {x.current.detail}{x.regressed ? (el ? " (μετά την επιβεβαίωση)" : " (after the confirmation)") : ""}</span></p>
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
            <article key={f.key} className={`card rcArea st-${f.action?.resolution ? RESOLUTION[f.action.resolution.state].cls : f.action ? "ok" : f.severity === "high" ? "fail" : "warn"}`}>
              <header><span className="rcDot" aria-hidden>{f.sample}</span><h2>{f.title}</h2></header>
              <ul className="rcItems">{f.evidence.map((e, i) => <li key={i} className="rcItem"><span className="rcDot" aria-hidden>i</span><span>{e}</span></li>)}</ul>
              <p className="rcSummary">{f.suggestion}</p>
              {f.action?.resolution && <p className={`rcItem lv-${RESOLUTION[f.action.resolution.state].cls}`}><span className="rcDot" aria-hidden>{f.action.resolution.state === "effective" ? "✓" : f.action.resolution.state === "recurred" ? "✕" : "…"}</span><span><b>{RESOLUTION[f.action.resolution.state][lang]}</b> — {f.action.resolution.detail}</span></p>}
              {f.action && <small className="muted">{f.action.status === "maintenance" ? (el ? `Εργασία συντήρησης #${f.action.maintenanceId}` : `Maintenance task #${f.action.maintenanceId}`) : `${el ? "Αγνοήθηκε" : "Dismissed"}: ${f.action.note ?? ""}`} · {when(f.action.at)}</small>}
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
