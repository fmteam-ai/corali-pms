"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Reliability, ReliabilityItem } from "../../../scripts/reliability-core.mjs";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

const ICON = { ok: "✓", warn: "!", fail: "✕", inactive: "–" } as const;
const ACTION: Record<string, { el: string; en: string }> = {
  retry_outbox: { el: "Επανάληψη συγχρονισμού", en: "Retry sync" }, retry_delivery: { el: "Νέα αποστολή", en: "Send again" },
  retry_fiscal: { el: "Νέα αποστολή στο myDATA", en: "Resend to myDATA" }, retry_webhook: { el: "Νέα παράδοση", en: "Deliver again" }, sync_now: { el: "Συγχρονισμός τώρα", en: "Sync now" },
  retry_alert: { el: "Νέα αποστολή ειδοποίησης", en: "Send alert again" }, resync_ota: { el: "Αποστολή διαφορών στα OTA", en: "Send differences to OTAs" }, reconcile_now: { el: "Έλεγχος τώρα", en: "Check now" },
};
type Delivery = { channel: string; recipient: string; purpose: string; status: string; attempts: number; error: string; sentAt: number | null };
type AlertRow = { id: number; area: string; severity: string; title: string; link: string; createdAt: number; acknowledgedAt: number | null; acknowledgedBy: string | null; escalatedAt: number | null; resolvedAt: number | null; deliveries: Delivery[] };
type State = Reliability & { version?: string; alerts?: AlertRow[] };
const DELIVERY: Record<string, { el: string; en: string }> = {
  sent: { el: "παραδόθηκε", en: "delivered" }, pending: { el: "σε αναμονή", en: "pending" }, sending: { el: "αποστέλλεται", en: "sending" },
  failed: { el: "απέτυχε", en: "failed" }, skipped: { el: "κανένα κινητό", en: "no phone" }, cancelled: { el: "δεν χρειάστηκε", en: "not needed" },
};

export function ReliabilityView({ lang, initial, canAct }: { lang: PmsLang; initial: State; canAct: boolean }) {
  const el = lang === "el";
  const [state, setState] = useState<State>(initial);
  const [onlyProblems, setOnlyProblems] = useState(initial.status !== "ok");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setInterval(() => void fetch("/api/pms/reliability", { cache: "no-store" }).then((r) => r.json()).then((d) => d.ok && setState(d)).catch(() => undefined), 60_000); return () => clearInterval(id); }, []);
  const when = (ms: number) => new Date(ms).toLocaleTimeString(pmsLocale(lang), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  async function act(type: string, id?: number) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/reliability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, id: id ?? null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(el ? "Δεν ολοκληρώθηκε." : "Not done."); return; }
      setState(d);
      if (type === "ack_alert") { setMsg(el ? "Καταγράφηκε ότι το είδατε· η κλιμάκωση σταμάτησε." : "Acknowledged; escalation stopped."); return; }
      setMsg(el ? `Μπήκαν ξανά σε εκτέλεση: ${d.queued}. Το αποτέλεσμα φαίνεται μετά την επόμενη εκτέλεση του cron (≤1′).` : `Queued again: ${d.queued}. The result shows after the next cron run (≤1′).`);
    } finally { setBusy(false); }
  }
  const areas = onlyProblems ? state.areas.filter((a) => a.status === "fail" || a.status === "warn") : state.areas;
  const item = (i: ReliabilityItem) => (
    <li key={i.key} className={`rcItem lv-${i.level}`}>
      <span className="rcDot" aria-hidden>{ICON[i.level]}</span>
      <span>{i.text}</span>
      {i.link && <Link href={i.link} className="linkButton">→</Link>}
      {canAct && i.action && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void act(i.action!.type, i.action!.id)}>↻ {ACTION[i.action.type]?.[lang]}</button>}
    </li>
  );
  return (
    <div className="rcPage">
      <div className="rcBar">
        <span className={`rcOverall st-${state.status}`}>{ICON[state.status]} {state.status === "ok" ? (el ? "Όλες οι εργασίες ολοκληρώνονται κανονικά" : "All work completes normally") : state.status === "warn" ? (el ? "Υπάρχουν εκκρεμότητες" : "Some work is pending") : (el ? "Υπάρχουν εργασίες που απέτυχαν" : "Some work failed")}</span>
        <span className="prcNav" role="tablist">
          <button type="button" role="tab" aria-selected={!onlyProblems} className={!onlyProblems ? "current" : ""} onClick={() => setOnlyProblems(false)}>{el ? "Όλα" : "All"}</button>
          <button type="button" role="tab" aria-selected={onlyProblems} className={onlyProblems ? "current" : ""} onClick={() => setOnlyProblems(true)}>{el ? "Προβλήματα" : "Problems"} ({state.areas.filter((a) => a.status === "fail" || a.status === "warn").length})</button>
        </span>
        <small className="muted">{el ? "Έλεγχος" : "Checked"} {when(state.at)}</small>
      </div>
      <p className="notice" role="status">{msg}</p>
      {areas.length === 0 && <p className="card rcAllGood">✓ {el ? "Κανένα πρόβλημα. Όλες οι υπηρεσίες ολοκληρώνουν τις εργασίες τους." : "No problems. Every service completes its work."}</p>}
      <div className="rcGrid">{areas.map((a) => (
        <article key={a.key} className={`card rcArea st-${a.status}`}>
          <header><span className="rcDot" aria-hidden>{ICON[a.status]}</span><h2>{el ? a.el : a.en}</h2></header>
          <p className="rcSummary">{a.status === "inactive" ? (el ? "Δεν είναι ενεργό" : "Not active") : a.summary}</p>
          {(a.items.length > 0 ? a.info : a.info.slice(1)).length > 0 && <small className="muted">{(a.items.length > 0 ? a.info : a.info.slice(1)).join(" · ")}</small>}
          {a.items.length > 0 && <ul className="rcItems">{a.items.slice(0, 20).map(item)}</ul>}
          {a.items.length > 20 && <small className="muted">+{a.items.length - 20}</small>}
          {canAct && a.items.filter((i) => i.action?.id).length > 1 && (() => { const t = a.items.find((i) => i.action?.id)!.action!.type; return <button type="button" className="primaryAction" disabled={busy} onClick={() => void act(t)}>↻ {el ? "Επανάληψη όλων" : "Retry all"}</button>; })()}
        </article>
      ))}</div>
      {(state.alerts?.length ?? 0) > 0 && (
        <article className="card rcAlerts">
          <h2>{el ? "Ειδοποιήσεις και παράδοση" : "Alerts and delivery"}</h2>
          <ul className="rcItems">{state.alerts!.slice(0, 15).map((a) => (
            <li key={a.id} className={`rcItem lv-${a.resolvedAt ? "ok" : a.severity}`}>
              <span className="rcDot" aria-hidden>{a.resolvedAt ? "✓" : ICON[a.severity === "warn" ? "warn" : "fail"]}</span>
              <span>
                {a.title}<br />
                <small className="muted">
                  {new Date(a.createdAt).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" })}
                  {" · "}{a.deliveries.map((d) => `${d.purpose === "escalation" ? (el ? "κλιμάκωση " : "escalation ") : ""}${d.channel === "email" ? d.recipient : "push"}: ${DELIVERY[d.status]?.[lang] ?? d.status}${d.status === "failed" && d.error ? ` (${d.error.slice(0, 60)})` : ""}`).join(" · ") || (el ? "μόνο στο PMS" : "PMS only")}
                  {a.acknowledgedAt ? ` · ${el ? "το είδε" : "seen by"} ${a.acknowledgedBy}` : ""}{a.resolvedAt ? ` · ${el ? "λύθηκε" : "resolved"}` : ""}
                </small>
              </span>
              {canAct && !a.acknowledgedAt && !a.resolvedAt && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void act("ack_alert", a.id)}>{el ? "Το είδα" : "Acknowledge"}</button>}
            </li>
          ))}</ul>
        </article>
      )}
    </div>
  );
}
