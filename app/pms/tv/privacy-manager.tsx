"use client";
// PMS → Corali TV → «Καθαρισμός στο check-out (GDPR)» (v161): rooms whose TV is cleared at check-out, the on-prem
// gateway's last contact, each check-out's result per app as the gateway reported it, guest-installed apps (removal
// only by explicit approval, one by one), staff review, and the TV capability status (what is and is not proven).
import { useCallback, useEffect, useState } from "react";
import type { PrivacyJob } from "@/lib/tv-privacy";
import { TV_CAPABILITIES } from "../../../scripts/tv-privacy-core.mjs";
import { Fold } from "./fold";

type Room = { room_id: number; room_code: string; enabled: boolean; executor: string; baseline_at: number | null; app_version: number | null };
type Data = { jobs: PrivacyJob[]; rooms: Room[]; gateway: { lastSeenAt: number; dryRun: boolean | null } | null; bridgeConfigured: boolean };

const EL: Record<string, string> = {
  title: "Καθαρισμός στο check-out (GDPR)",
  help: "Στο check-out ενός δωματίου με ενεργό καθαρισμό, ο υπολογιστής-gateway του ξενοδοχείου (στο τοπικό δίκτυο, με ADB) σβήνει τα δεδομένα του επισκέπτη από YouTube, Netflix, Prime Video, Disney+ και YouTube Music. Ο λογαριασμός Google του ξενοδοχείου, το Corali TV, το καλωσόρισμα, το Wi-Fi και οι ρυθμίσεις Hotel Mode δεν αγγίζονται. Το «καθαρίστηκε» σημαίνει τοπικό σβήσιμο δεδομένων της εφαρμογής — όχι πιστοποιημένη αποσύνδεση: ελέγξτε την οθόνη κάθε εφαρμογής και πατήστε «Ελέγχθηκε».",
  help2: "Από τη v162 μπορεί να το κάνει η ίδια η τηλεόραση (Corali TV 1.13, «Εκτέλεση: η ίδια η TV»), χωρίς υπολογιστή: καθαρίζει εφαρμογές και προσωρινά αρχεία, αφαιρεί προφίλ επισκέπτη και ελέγχει για λογαριασμό Google ή Bluetooth επισκέπτη. Μέχρι να αποδειχθούν όλα, το δωμάτιο δείχνει «Εκκρεμεί εκκαθάριση προσωπικών δεδομένων» και η TV ξαναδοκιμάζει μόνη της.",
  gateway: "Gateway", gwNever: "δεν έχει συνδεθεί ποτέ", gwOnline: "συνδεδεμένο", gwOffline: "εκτός σύνδεσης από", dry: "δοκιμαστική λειτουργία (χωρίς διαγραφές)", live: "κανονική λειτουργία",
  notConfigured: "Η σύνδεση gateway δεν είναι ενεργή: χρειάζεται TV_PRIVACY_BRIDGE_TOKEN (≥ 32 χαρακτήρες) στο runtime.env του PMS (οδηγίες: tools/tv-privacy-gateway/INSTALL-GR.md).",
  rooms: "Δωμάτια με καθαρισμό στο check-out",
  roomsHelp: "Τσεκαρισμένο = η TV του δωματίου καθαρίζεται στο check-out. «Εκτέλεση»: ποιος κάνει τον καθαρισμό — η ίδια η TV (Corali TV 1.13+, χωρίς υπολογιστή) ή ο υπολογιστής-gateway στο δίκτυο του ξενοδοχείου.",
  allRooms: "Όλα τα δωμάτια", allOn: "Ενεργοποίηση καθαρισμού", allOff: "Απενεργοποίηση καθαρισμού", allTv: "Εκτέλεση: η ίδια η TV", allGw: "Εκτέλεση: gateway",
  bulkConfirm: "{a} σε {n} δωμάτια;", history: "Ιστορικό ανά check-out", room: "Δωμάτιο", booking: "Κράτηση", checkout: "Check-out", status: "Αποτέλεσμα", apps: "Εφαρμογές", guestApps: "Εφαρμογές επισκέπτη", review: "Έλεγχος προσωπικού",
  reviewed: "Ελέγχθηκε", markReviewed: "Ελέγχθηκε", retry: "Επανάληψη", remove: "Αφαίρεση", removeConfirm: "Αφαίρεση της εφαρμογής «{p}» από την τηλεόραση του δωματίου {r};\n\nΘα αφαιρεθεί μόνο αυτή η εφαρμογή, μόνο αν δεν έχει κάνει check-in νέος επισκέπτης. Τα δεδομένα της θα χαθούν.",
  none: "—", noJobs: "Δεν υπάρχουν ακόμα check-out με καθαρισμό.", caps: "Κατάσταση δυνατοτήτων τηλεόρασης (όπως έχει τεκμηριωθεί)", failed: "Η ενέργεια δεν επιτράπηκε ή απέτυχε.",
  s_QUEUED: "⏳ σε αναμονή του gateway",
  pendingTitle: "Εκκρεμεί εκκαθάριση προσωπικών δεδομένων", readyTitle: "✓ Έτοιμη για τον επόμενο επισκέπτη",
  a_QUEUED: "η τηλεόραση δεν έχει συνδεθεί ακόμα (κλειστή ή εκτός δικτύου) — θα γίνει μόλις συνδεθεί",
  a_RUNNING: "εκτελείται τώρα στην τηλεόραση", a_RETRY_PENDING: "νέα προσπάθεια αυτόματα", a_NEEDS_STAFF: "χρειάζεται ενέργεια προσωπικού",
  s_READY: "✓ έτοιμη για τον επόμενο επισκέπτη", s_RETRY_PENDING: "⏳ εκκρεμεί — νέα προσπάθεια", s_NEEDS_STAFF: "⚠ εκκρεμεί — ενέργεια προσωπικού",
  p_ADB: "η τηλεόραση δεν μπόρεσε να εκτελέσει τον καθαρισμό (ADB)", p_BASELINE: "δεν έχει αποθηκευτεί η αρχική κατάσταση της TV (ρυθμίσεις Corali TV → «Αποθήκευση αρχικής κατάστασης»)",
  p_APPS: "αποτυχία καθαρισμού εφαρμογής", p_GUEST_APPS: "αποτυχία καθαρισμού εφαρμογής επισκέπτη", p_CACHE: "αποτυχία καθαρισμού προσωρινών αρχείων", p_CHECKS: "δεν ολοκληρώθηκε ο έλεγχος λογαριασμών / προφίλ / Bluetooth", p_WELCOME: "δεν επέστρεψε στην οθόνη καλωσορίσματος",
  p_GUEST_GOOGLE_ACCOUNT: "υπάρχει λογαριασμός Google επισκέπτη — αφαιρέστε τον από τη TV: Ρυθμίσεις → Λογαριασμοί και σύνδεση (όχι τον λογαριασμό του ξενοδοχείου)",
  p_GUEST_PROFILE: "υπάρχει προφίλ επισκέπτη που δεν αφαιρέθηκε — Ρυθμίσεις → Λογαριασμοί και σύνδεση",
  p_GUEST_BLUETOOTH: "υπάρχει συσκευή Bluetooth επισκέπτη — Ρυθμίσεις → Τηλεχειριστήρια και αξεσουάρ → κατάργηση σύζευξης (όχι το τηλεχειριστήριο)",
  nextTry: "επόμενη προσπάθεια", recheck: "Έλεγχος τώρα", executor: "Εκτέλεση", ex_gateway: "υπολογιστής-gateway", ex_tv_agent: "η ίδια η TV (Corali TV 1.13)",
  noBaseline: "χωρίς αρχική κατάσταση", oldApp: "χρειάζεται Corali TV 1.13", ready: "Έτοιμη", pending: "Εκκρεμεί",
  st_cache: "προσωρινά αρχεία", st_accounts: "λογαριασμοί επισκέπτη", st_profiles: "προφίλ επισκέπτη", st_bt: "Bluetooth επισκέπτη", st_welcome: "καλωσόρισμα", st_removed: "αφαιρέθηκαν", s_RUNNING: "▶ εκτελείται", s_CLEARED_LOCAL_NEEDS_REVIEW: "✓ καθαρίστηκε τοπικά — χρειάζεται έλεγχος", s_PARTIAL: "◐ μερικώς", s_FAILED: "✗ απέτυχε", s_BLOCKED_NEW_GUEST: "⛔ σταμάτησε: νέος επισκέπτης", s_BLOCKED_UNREGISTERED: "⛔ σταμάτησε: η TV/κράτηση άλλαξε", s_BLOCKED_SECURITY: "⛔ σταμάτησε: λάθος συσκευή", s_UNVERIFIED: "? χωρίς επιβεβαίωση", s_DRY_RUN: "δοκιμαστικά (καμία διαγραφή)",
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
  // v162: a TV that clears itself — «pending» until every step is proven; what is missing, and what staff must do.
  const agentStatus = (j: PrivacyJob) => {
    const c = j.checks as { pending?: string[]; cache?: boolean; accounts?: number | null; profiles?: number | null; profilesRemoved?: number; bluetooth?: number | null; welcome?: boolean };
    if (j.status === "READY") return <><span className="credit">{T.readyTitle}</span>{j.ready_at_ms ? <small className="muted"> · {at(j.ready_at_ms)}</small> : null}</>;
    if (j.status.startsWith("BLOCKED")) return <span className="debit">{tx(`s_${j.status}`)}</span>;
    return (
      <>
        <span className="debit">⏳ {T.pendingTitle}</span><br />
        <small className="muted">{tx(`a_${j.status}`)}{j.next_retry_ms && j.status !== "RUNNING" ? ` · ${T.nextTry} ${at(j.next_retry_ms)}` : ""}{j.attempt_count ? ` · ${j.attempt_count}×` : ""}</small>
        {(c.pending ?? []).map((p) => <div key={p}><small className="debit">• {tx(`p_${p}`)}</small></div>)}
        {c.accounts !== undefined && <div><small className="muted">{T.st_cache}: {c.cache ? "✓" : "✗"} · {T.st_accounts}: {c.accounts ?? "?"} · {T.st_profiles}: {c.profiles ?? "?"}{c.profilesRemoved ? ` (${T.st_removed} ${c.profilesRemoved})` : ""} · {T.st_bt}: {c.bluetooth ?? "?"} · {T.st_welcome}: {c.welcome ? "✓" : "✗"}</small></div>}
      </>
    );
  };

  return (
    <Fold card title={T.title}>
      <small>{T.help}</small>
      <small> {T.help2}</small>
      {!data.bridgeConfigured && data.rooms.some((r) => r.enabled && r.executor === "gateway") && <p className="notice">{T.notConfigured}</p>}
      {data.rooms.some((r) => r.executor === "gateway" && r.enabled) && <p><b>{T.gateway}:</b> {!data.gateway ? <span className="debit">{T.gwNever}</span> : gwOnline ? <span className="credit">● {T.gwOnline}</span> : <span className="debit">{T.gwOffline} {at(data.gateway.lastSeenAt)}</span>}
        {data.gateway?.dryRun !== null && data.gateway?.dryRun !== undefined && <small className="muted"> · {data.gateway.dryRun ? T.dry : T.live}</small>}</p>}

      <Fold title={T.rooms} count={data.rooms.filter((r) => r.enabled).length}>
      <small className="muted">{T.roomsHelp}</small>
      {canAdmin && data.rooms.length > 0 && <div className="tvAdminChecks">
        <b>{T.allRooms} ({data.rooms.length}):</b>
        {([[T.allOn, { enabled: true }], [T.allOff, { enabled: false }], [T.allTv, { executor: "tv_agent" }], [T.allGw, { executor: "gateway" }]] as const).map(([label, patch]) => (
          <button key={label} type="button" className="secondaryButton" disabled={busy} onClick={() => { if (window.confirm(T.bulkConfirm.replace("{a}", label).replace("{n}", String(data.rooms.length)))) void post({ action: "rooms", roomIds: data.rooms.map((r) => r.room_id), ...patch }); }}>{label}</button>
        ))}
      </div>}
      <div className="tableWrap"><table>
        <thead><tr><th>{T.room}</th><th>{T.executor}</th><th>{T.status}</th></tr></thead>
        <tbody>{data.rooms.map((r) => {
          const last = data.jobs.find((j) => j.room_id === r.room_id);
          const ready = last && last.status === "READY";
          const pendingNow = last && last.executor === "tv_agent" && !ready;
          return (
            <tr key={r.room_id}>
              <td><label className="inline"><input type="checkbox" checked={r.enabled} disabled={!canAdmin || busy} onChange={(e) => void post({ action: "room", roomId: r.room_id, enabled: e.target.checked })} /> <b>{r.room_code}</b></label></td>
              <td><select value={r.executor} disabled={!canAdmin || busy} onChange={(e) => void post({ action: "room", roomId: r.room_id, enabled: r.enabled, executor: e.target.value })}>
                <option value="gateway">{T.ex_gateway}</option><option value="tv_agent">{T.ex_tv_agent}</option></select>
                {r.executor === "tv_agent" && <><br /><small className={r.baseline_at ? "muted" : "debit"}>{r.baseline_at ? `✓ ${at(r.baseline_at)}` : T.noBaseline}</small>
                  {(r.app_version === null || r.app_version < 14) && <small className="debit"> · {T.oldApp}</small>}</>}</td>
              <td>{!last ? T.none : ready ? <span className="credit">{T.readyTitle}</span> : pendingNow ? <span className="debit">{T.pendingTitle}</span> : <small className="muted">{tx(`s_${last.status}`)}</small>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      </Fold>

      <Fold title={T.history} count={data.jobs.length}>
      {!data.jobs.length ? <p className="muted">{T.noJobs}</p> : (
        <div className="tableWrap"><table>
          <thead><tr><th>{T.room}</th><th>{T.booking}</th><th>{T.checkout}</th><th>{T.status}</th><th>{T.apps}</th><th>{T.guestApps}</th><th>{T.review}</th></tr></thead>
          <tbody>{data.jobs.map((j) => (
            <tr key={j.id}>
              <td><b>{j.room_code}</b></td>
              <td>{j.booking_ref}</td>
              <td>{at(j.checkout_at_ms)}</td>
              <td>{j.executor === "tv_agent" ? agentStatus(j) : <span className={j.status === "CLEARED_LOCAL_NEEDS_REVIEW" ? "credit" : ["FAILED", "PARTIAL", "UNVERIFIED"].includes(j.status) || j.status.startsWith("BLOCKED") ? "debit" : ""}>{tx(`s_${j.status}`)}</span>}
                {j.executor !== "tv_agent" && j.attempt_count > 0 && <small className="muted"> · {j.attempt_count}×</small>}{j.finished_at_ms ? <small className="muted"> · {at(j.finished_at_ms)}</small> : null}
                {j.executor !== "tv_agent" && j.error_code && !["CLEARED_LOCAL_NEEDS_REVIEW", "ACCOUNT_REVIEW_REQUIRED"].includes(j.error_code) && <><br /><small className="muted">{j.error_code}</small></>}
                {canAdmin && ["FAILED", "PARTIAL", "UNVERIFIED", "DRY_RUN", "BLOCKED_SECURITY"].includes(j.status) && <><br /><button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "retry", jobId: j.id })}>{T.retry}</button></>}
                {canAdmin && j.executor === "tv_agent" && ["RETRY_PENDING", "NEEDS_STAFF"].includes(j.status) && <><br /><button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "retry", jobId: j.id })}>{T.recheck}</button></>}</td>
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
      </Fold>

      <details>
        <summary><b>{T.caps}</b></summary>
        <ul className="plainList">{Object.entries(TV_CAPABILITIES).map(([k, v]) => <li key={k}><b>{tx(`c_${k}`)}:</b> <code>{v.status}</code> <small className="muted">{v.note}</small></li>)}</ul>
      </details>
      {msg && <p className="notice" role="status">{msg}</p>}
    </Fold>
  );
}
