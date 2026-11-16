"use client";
// PMS → Corali TV → «Καθαρισμός στο check-out (GDPR)» (v161): rooms whose TV is cleared at check-out, the on-prem
// gateway's last contact, each check-out's result per app as the gateway reported it, guest-installed apps (removal
// only by explicit approval, one by one), staff review, and the TV capability status (what is and is not proven).
import { useCallback, useEffect, useState } from "react";
import type { PrivacyJob } from "@/lib/tv-privacy";
import { TV_CAPABILITIES } from "../../../scripts/tv-privacy-core.mjs";

type Data = { jobs: PrivacyJob[]; rooms: { room_id: number; room_code: string; enabled: boolean }[]; gateway: { lastSeenAt: number; dryRun: boolean | null } | null; bridgeConfigured: boolean };

const EL: Record<string, string> = {
  title: "Καθαρισμός στο check-out (GDPR)",
  help: "Στο check-out ενός δωματίου με ενεργό καθαρισμό, ο υπολογιστής-gateway του ξενοδοχείου (στο τοπικό δίκτυο, με ADB) σβήνει τα δεδομένα του επισκέπτη από YouTube, Netflix, Prime Video, Disney+ και YouTube Music. Ο λογαριασμός Google του ξενοδοχείου, το Corali TV, το καλωσόρισμα, το Wi-Fi και οι ρυθμίσεις Hotel Mode δεν αγγίζονται. Το «καθαρίστηκε» σημαίνει τοπικό σβήσιμο δεδομένων της εφαρμογής — όχι πιστοποιημένη αποσύνδεση: ελέγξτε την οθόνη κάθε εφαρμογής και πατήστε «Ελέγχθηκε».",
  gateway: "Gateway", gwNever: "δεν έχει συνδεθεί ποτέ", gwOnline: "συνδεδεμένο", gwOffline: "εκτός σύνδεσης από", dry: "δοκιμαστική λειτουργία (χωρίς διαγραφές)", live: "κανονική λειτουργία",
  notConfigured: "Η σύνδεση gateway δεν είναι ενεργή: χρειάζεται TV_PRIVACY_BRIDGE_TOKEN (≥ 32 χαρακτήρες) στο runtime.env του PMS (οδηγίες: tools/tv-privacy-gateway/INSTALL-GR.md).",
  rooms: "Δωμάτια με καθαρισμό στο check-out", history: "Ιστορικό ανά check-out", room: "Δωμάτιο", booking: "Κράτηση", checkout: "Check-out", status: "Αποτέλεσμα", apps: "Εφαρμογές", guestApps: "Εφαρμογές επισκέπτη", review: "Έλεγχος προσωπικού",
  reviewed: "Ελέγχθηκε", markReviewed: "Ελέγχθηκε", retry: "Επανάληψη", remove: "Αφαίρεση", removeConfirm: "Αφαίρεση της εφαρμογής «{p}» από την τηλεόραση του δωματίου {r};\n\nΘα αφαιρεθεί μόνο αυτή η εφαρμογή, μόνο αν δεν έχει κάνει check-in νέος επισκέπτης. Τα δεδομένα της θα χαθούν.",
  none: "—", noJobs: "Δεν υπάρχουν ακόμα check-out με καθαρισμό.", caps: "Κατάσταση δυνατοτήτων τηλεόρασης (όπως έχει τεκμηριωθεί)", failed: "Η ενέργεια δεν επιτράπηκε ή απέτυχε.",
  s_QUEUED: "⏳ σε αναμονή του gateway", s_RUNNING: "▶ εκτελείται", s_CLEARED_LOCAL_NEEDS_REVIEW: "✓ καθαρίστηκε τοπικά — χρειάζεται έλεγχος", s_PARTIAL: "◐ μερικώς", s_FAILED: "✗ απέτυχε", s_BLOCKED_NEW_GUEST: "⛔ σταμάτησε: νέος επισκέπτης", s_BLOCKED_UNREGISTERED: "⛔ σταμάτησε: η TV/κράτηση άλλαξε", s_BLOCKED_SECURITY: "⛔ σταμάτησε: λάθος συσκευή", s_UNVERIFIED: "? χωρίς επιβεβαίωση", s_DRY_RUN: "δοκιμαστικά (καμία διαγραφή)",
  a_CLEARED_LOCAL: "καθαρίστηκε", a_NOT_INSTALLED: "δεν υπάρχει", a_FAILED: "απέτυχε", a_BLOCKED_SECURITY: "μπλοκαρίστηκε", a_DRY_RUN: "δοκιμαστικά",
  u_APPROVED: "εγκρίθηκε", u_RUNNING: "εκτελείται", u_REMOVED: "αφαιρέθηκε", u_NOT_INSTALLED: "δεν υπάρχει πια", u_FAILED: "απέτυχε", u_BLOCKED_NEW_GUEST: "σταμάτησε: νέος επισκέπτης", u_BLOCKED_SECURITY: "σταμάτησε: λάθος συσκευή", u_BLOCKED_PROTECTED: "προστατευμένη — δεν αφαιρείται",
  c_volume: "Ένταση / σίγαση", c_powerOn: "Άναμμα από PMS (Power ON)", c_menuLock: "Κλείδωμα μενού", c_channelScanLock: "Κλείδωμα αναζήτησης καναλιών", c_checkoutClearAppData: "Καθαρισμός εφαρμογών στο check-out", c_removeGuestApps: "Αφαίρεση εφαρμογών επισκεπτών", c_hotelGoogleAccountProtected: "Προστασία λογαριασμού Google ξενοδοχείου",
};
const APP: Record<string, string> = { "com.google.android.youtube.tv": "YouTube", "com.netflix.ninja": "Netflix", "com.amazon.amazonvideo.livingroom": "Prime Video", "com.disney.disneyplus": "Disney+", "com.google.android.youtube.tvmusic": "YouTube Music" };

export function PrivacyManager({ lang, canAdmin, canReview }: { lang: string; canAdmin: boolean; canReview: boolean }) {
  const T = EL;
  const tx = (k: string) => T[k] ?? k;
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    try { const d = await (await fetch("/api/pms/tv-privacy", { cache: "no-store" })).json(); if (d.ok) { setData(d); setNow(Date.now()); } } catch { /* next tick */ }
  }, []);
  useEffect(() => {
    queueMicrotask(() => { void load(); });
    const id = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(id);
  }, [load]);
  async function post(body: unknown) {
    setBusy(true); setMsg("");
    try {
      const d = await (await fetch("/api/pms/tv-privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json().catch(() => ({}));
      if (d.ok) setData(d); else setMsg(`${T.failed}${d.error ? ` (${d.error})` : ""}`);
    } finally { setBusy(false); }
  }
  if (!data) return null;
  const at = (ms: number | null) => (ms ? new Date(ms).toLocaleString(lang === "en" ? "en-GB" : "el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : "—");
  const gwOnline = data.gateway && now - data.gateway.lastSeenAt < 120_000;

  return (
    <div className="hubCard">
      <h2>{T.title}</h2>
      <small>{T.help}</small>
      {!data.bridgeConfigured && <p className="notice">{T.notConfigured}</p>}
      <p><b>{T.gateway}:</b> {!data.gateway ? <span className="debit">{T.gwNever}</span> : gwOnline ? <span className="credit">● {T.gwOnline}</span> : <span className="debit">{T.gwOffline} {at(data.gateway.lastSeenAt)}</span>}
        {data.gateway?.dryRun !== null && data.gateway?.dryRun !== undefined && <small className="muted"> · {data.gateway.dryRun ? T.dry : T.live}</small>}</p>

      <h3>{T.rooms}</h3>
      <div className="tvAdminChecks">{data.rooms.map((r) => (
        <label key={r.room_id} className="inline"><input type="checkbox" checked={r.enabled} disabled={!canAdmin || busy} onChange={(e) => void post({ action: "room", roomId: r.room_id, enabled: e.target.checked })} /> {r.room_code}</label>
      ))}</div>

      <h3>{T.history}</h3>
      {!data.jobs.length ? <p className="muted">{T.noJobs}</p> : (
        <div className="tableWrap"><table>
          <thead><tr><th>{T.room}</th><th>{T.booking}</th><th>{T.checkout}</th><th>{T.status}</th><th>{T.apps}</th><th>{T.guestApps}</th><th>{T.review}</th></tr></thead>
          <tbody>{data.jobs.map((j) => (
            <tr key={j.id}>
              <td><b>{j.room_code}</b></td>
              <td>{j.booking_ref}</td>
              <td>{at(j.checkout_at_ms)}</td>
              <td><span className={j.status === "CLEARED_LOCAL_NEEDS_REVIEW" ? "credit" : ["FAILED", "PARTIAL", "UNVERIFIED"].includes(j.status) || j.status.startsWith("BLOCKED") ? "debit" : ""}>{tx(`s_${j.status}`)}</span>
                {j.attempt_count > 0 && <small className="muted"> · {j.attempt_count}×</small>}{j.finished_at_ms ? <small className="muted"> · {at(j.finished_at_ms)}</small> : null}
                {j.error_code && !["CLEARED_LOCAL_NEEDS_REVIEW", "ACCOUNT_REVIEW_REQUIRED"].includes(j.error_code) && <><br /><small className="muted">{j.error_code}</small></>}
                {canAdmin && ["FAILED", "PARTIAL", "UNVERIFIED", "DRY_RUN", "BLOCKED_SECURITY"].includes(j.status) && <><br /><button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "retry", jobId: j.id })}>{T.retry}</button></>}</td>
              <td>{j.package_results.length ? <small>{j.package_results.map((r) => `${APP[r.package] ?? r.package}: ${tx(`a_${r.status}`)}`).join(" · ")}</small> : T.none}</td>
              <td>{!j.added_packages.length && !j.uninstalls.length ? T.none : <ul className="plainList">{j.added_packages.map((p) => {
                const u = j.uninstalls.find((x) => x.package === p);
                return <li key={p}><code>{p}</code> {u ? <small className={u.status === "REMOVED" ? "credit" : u.status.startsWith("BLOCKED") || u.status === "FAILED" ? "debit" : ""}>{tx(`u_${u.status}`)}{u.error_code ? ` · ${u.error_code}` : ""}</small> : canAdmin && <button type="button" className="secondaryButton" disabled={busy} onClick={() => { if (window.confirm(T.removeConfirm.replace("{p}", p).replace("{r}", j.room_code))) void post({ action: "approve_uninstall", jobId: j.id, package: p }); }}>{T.remove}</button>}</li>;
              })}</ul>}</td>
              <td>{j.staff_checked_at_ms ? <small className="credit">✓ {at(j.staff_checked_at_ms)}{j.staff_checked_by ? ` · ${j.staff_checked_by}` : ""}</small>
                : canReview && ["CLEARED_LOCAL_NEEDS_REVIEW", "PARTIAL", "UNVERIFIED"].includes(j.status) ? <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "review", jobId: j.id })}>{T.markReviewed}</button> : T.none}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <details>
        <summary><b>{T.caps}</b></summary>
        <ul className="plainList">{Object.entries(TV_CAPABILITIES).map(([k, v]) => <li key={k}><b>{tx(`c_${k}`)}:</b> <code>{v.status}</code> <small className="muted">{v.note}</small></li>)}</ul>
      </details>
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
