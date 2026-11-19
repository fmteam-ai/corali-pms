"use client";
// PMS → Corali TV → «Ρεύμα & δίκτυο σε αναμονή» (v164, Corali TV ≥ 1.15): per room the measured power state (never ON
// just because the app is connected), the Network Standby Manager's state as the TV reports it (CPU / Wi-Fi locks,
// Low Power Standby, idle, validated network), silences of the TV (gaps), on-demand diagnostics, the OFF method, and
// standby tests (OFF now, ON after 10′ / 1 h / 12 h) whose verdict the PMS records by itself.
import { useCallback, useEffect, useState } from "react";
import { Fold } from "./fold";

type Ev = { at: number; kind: string; detail: { seconds?: number; screenBefore?: number | null; on?: boolean } };
type Room = { room_id: number; room_code: string; method: string; app_version: number | null; screen_off_permission: boolean | null; power_state: string; reachable: boolean; last_heartbeat: number | null;
  network_standby: boolean; off_mode: string; standby: Record<string, boolean | null> | null; last_command: { command: string; status: string; error: string; result_text: string; created_at: number } | null;
  diagnostics: { status: string; text: string; at: number } | null; events: Ev[] };
type Test = { id: number; room_id: number; minutes: number; started_at: number; verdict: string; off: { status: string; error: string; detail: string } | null; on: { status: string; error: string; detail: string; due: number | null; at: number | null } | null };
type Data = { now: number; standbyApp: number; rooms: Room[]; tests: Test[] };

const T: Record<string, string> = {
  title: "Ρεύμα & δίκτυο σε αναμονή (Network Standby)",
  help: "Η κατάσταση ρεύματος μετριέται από την ίδια την TV (οθόνη αναμμένη/σβηστή) σε κάθε έλεγχο (~20″). «ON» δεν εμφανίζεται ποτέ μόνο επειδή η εφαρμογή είναι συνδεδεμένη ή κρατά wake lock. Αν η TV σιωπήσει > 90″, καταγράφεται «διακοπή επικοινωνίας». Η «Δοκιμή standby» σβήνει την TV τώρα και τη ξανανάβει από το PMS μετά τον χρόνο που διαλέγετε· το αποτέλεσμα καταγράφεται αυτόματα.",
  room: "Δωμάτιο", state: "Κατάσταση", network: "Δίκτυο / Agent", standby: "Network Standby Manager", settings: "Ρυθμίσεις", tests: "Δοκιμές standby", events: "Συμβάντα",
  ps_ON: "● ON", ps_STANDBY: "◐ STANDBY", ps_WAKING: "⏳ WAKING", ps_UNKNOWN: "? UNKNOWN", ps_ERROR: "✗ ERROR",
  reachable: "συνδεδεμένη", unreachable: "δεν απαντά", lastSeen: "τελευταίος έλεγχος", never: "ποτέ",
  cpuWakeLockHeld: "CPU lock", wifiLockHeld: "Wi-Fi lock", lowPowerStandbyEnabled: "Low Power Standby", lowPowerStandbyExempt: "εξαίρεση LPS", deviceIdle: "Doze", networkValidated: "internet", networkStandby: "network standby",
  yes: "ναι", no: "όχι", unk: "?", ns: "Κράτηση δικτύου σε αναμονή", offMode: "Σβήσιμο από PMS", off_device_admin: "lockNow (τρέχον)", off_sleep_key: "πλήκτρο SLEEP (Self-ADB, δοκιμαστικό)", off_black_screen: "μαύρη οθόνη — η TV μένει αναμμένη, ξαναξεκινά μόνη μετά από διακοπή ρεύματος (Corali TV 1.16, δοκιμαστικό, για άδεια δωμάτια)",
  diag: "Διάγνωση", lastDiag: "Τελευταία διάγνωση", test: "Δοκιμή standby", t10: "10′", t60: "1 ώρα", t720: "12 ώρες",
  testConfirm: "Δοκιμή standby στο δωμάτιο {r}: η TV σβήνει ΤΩΡΑ και το PMS θα προσπαθήσει να την ανάψει μετά από {m}. Συνέχεια;",
  oldApp: "χρειάζεται Corali TV 1.15", notAgent: "μόνο για δωμάτια με μέθοδο ρεύματος «Corali TV (android_agent)»",
  gap: "διακοπή επικοινωνίας", screenOn: "οθόνη αναμμένη", screenOff: "οθόνη σβηστή", sec: "″",
  v_STARTING: "⏳ σβήνει…", v_OFF_FAILED: "✗ δεν έσβησε", v_WAITING: "⏳ σε αναμονή μέχρι", v_WAKE_DUE: "⏳ ώρα για άναμμα — περιμένει την TV", v_WAKING: "⏳ ανάβει…",
  v_PASS: "✓ PASS — ξύπνησε από το PMS", v_FAIL_UNREACHABLE: "✗ FAIL — η TV δεν απαντούσε σε αναμονή (δεν πήρε την εντολή)", v_FAIL_WAKE_REFUSED: "✗ FAIL — η TV πήρε την εντολή αλλά η οθόνη δεν άναψε",
  v_UNVERIFIED: "? χωρίς επιβεβαίωση", v_CANCELLED: "ακυρώθηκε (νεότερη εντολή)", v_ERROR: "σφάλμα", failed: "Η ενέργεια δεν επιτράπηκε ή απέτυχε.",
};

export function StandbyManager({ lang, canAdmin, canDiag }: { lang: string; canAdmin: boolean; canDiag: boolean }) {
  const tx = (k: string) => T[k] ?? k;
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try { const d = await (await fetch("/api/pms/tv/standby", { cache: "no-store" })).json(); if (d.ok) setData(d); } catch { /* next tick */ }
  }, []);
  useEffect(() => {
    queueMicrotask(() => { void load(); });
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);
  async function post(body: unknown) {
    setBusy(true); setMsg("");
    try {
      const d = await (await fetch("/api/pms/tv/standby", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json().catch(() => ({}));
      if (d.ok) setData(d); else setMsg(`${T.failed}${d.error ? ` (${d.error})` : ""}`);
    } finally { setBusy(false); }
  }
  if (!data) return null;
  const at = (ms: number | null) => (ms ? new Date(ms).toLocaleString(lang === "en" ? "en-GB" : "el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : T.never);
  const flag = (v: boolean | null | undefined) => (v === true ? T.yes : v === false ? T.no : T.unk);

  return (
    <Fold card title={T.title}>
      <small>{T.help}</small>
      <div className="tableWrap"><table>
        <thead><tr><th>{T.room}</th><th>{T.state}</th><th>{T.standby}</th><th>{T.settings}</th><th>{T.events}</th></tr></thead>
        <tbody>{data.rooms.map((r) => {
          const old = r.app_version === null || r.app_version < data.standbyApp;
          const agent = r.method === "android_agent";
          return (
            <tr key={r.room_id}>
              <td><b>{r.room_code}</b></td>
              <td>
                <b className={r.power_state === "ON" ? "credit" : r.power_state === "ERROR" ? "debit" : ""}>{tx(`ps_${r.power_state}`)}</b><br />
                <small className={r.reachable ? "credit" : "debit"}>{r.reachable ? T.reachable : T.unreachable}</small>
                <small className="muted"> · {T.lastSeen}: {at(r.last_heartbeat)}</small>
                {r.last_command && ["SCREEN_ON", "SCREEN_OFF"].includes(r.last_command.command) && <><br /><small className="muted">{r.last_command.command} → {r.last_command.status}{r.last_command.error ? ` · ${r.last_command.error}` : ""}{r.last_command.result_text ? ` · ${r.last_command.result_text}` : ""}</small></>}
              </td>
              <td>{old ? <small className="muted">{T.oldApp}</small> : r.standby ? <small>{["networkStandby", "cpuWakeLockHeld", "wifiLockHeld", "lowPowerStandbyEnabled", "lowPowerStandbyExempt", "deviceIdle", "networkValidated"].map((k) => `${tx(k)}: ${flag(r.standby?.[k])}`).join(" · ")}</small> : <small className="muted">—</small>}
                {r.diagnostics && <details><summary><small>{T.lastDiag}: {r.diagnostics.status} · {at(r.diagnostics.at)}</small></summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{r.diagnostics.text || "—"}</pre></details>}
              </td>
              <td>
                <label className="inline"><input type="checkbox" checked={r.network_standby} disabled={!canAdmin || busy} onChange={(e) => void post({ action: "settings", roomId: r.room_id, networkStandby: e.target.checked, offMode: r.off_mode })} /> {T.ns}</label><br />
                <label className="inline">{T.offMode}: <select value={r.off_mode} disabled={!canAdmin || busy} onChange={(e) => void post({ action: "settings", roomId: r.room_id, networkStandby: r.network_standby, offMode: e.target.value })}>
                  <option value="device_admin">{T.off_device_admin}</option><option value="sleep_key">{T.off_sleep_key}</option><option value="black_screen">{T.off_black_screen}</option></select></label><br />
                {canDiag && !old && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "diagnostics", roomId: r.room_id })}>{T.diag}</button>}
                {canAdmin && !old && (agent ? <span> {T.test}: {[10, 60, 720].map((m) => <button key={m} type="button" className="secondaryButton" disabled={busy} onClick={() => { if (window.confirm(T.testConfirm.replace("{r}", r.room_code).replace("{m}", tx(`t${m}`)))) void post({ action: "start_test", roomId: r.room_id, minutes: m }); }}>{tx(`t${m}`)}</button>)}</span> : <><br /><small className="muted">{T.notAgent}</small></>)}
              </td>
              <td>{r.events.length ? <ul className="plainList">{r.events.map((e, i) => <li key={i}><small>{at(e.at)} · {e.kind === "GAP" ? <span className="debit">{T.gap} {e.detail.seconds}{T.sec}</span> : e.detail.on ? T.screenOn : T.screenOff}</small></li>)}</ul> : <small className="muted">—</small>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>

      {data.tests.length > 0 && <Fold title={T.tests} count={data.tests.length}>
        <div className="tableWrap"><table>
          <thead><tr><th>{T.room}</th><th>{T.test}</th><th>{T.state}</th></tr></thead>
          <tbody>{data.tests.map((t) => (
            <tr key={t.id}>
              <td><b>{data.rooms.find((r) => r.room_id === t.room_id)?.room_code ?? t.room_id}</b></td>
              <td><small>{at(t.started_at)} · {tx(`t${t.minutes}`)}</small></td>
              <td><b className={t.verdict === "PASS" ? "credit" : t.verdict.startsWith("FAIL") || t.verdict === "OFF_FAILED" ? "debit" : ""}>{tx(`v_${t.verdict}`)}{t.verdict === "WAITING" && t.on?.due ? ` ${at(t.on.due)}` : ""}</b>
                {t.off && <><br /><small className="muted">OFF: {t.off.status}{t.off.error ? ` · ${t.off.error}` : ""}{t.off.detail ? ` · ${t.off.detail}` : ""}</small></>}
                {t.on && <><br /><small className="muted">ON: {t.on.status}{t.on.error ? ` · ${t.on.error}` : ""}{t.on.detail ? ` · ${t.on.detail}` : ""}</small></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Fold>}
      {msg && <p className="notice" role="status">{msg}</p>}
    </Fold>
  );
}
