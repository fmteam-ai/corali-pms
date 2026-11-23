"use client";
import { useState } from "react";
import type { DeviceRegistry } from "@/lib/device-registry";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

type Unit = DeviceRegistry["units"][number];
const LEVEL: Record<string, { el: string; en: string; cls: string }> = {
  NONE: { el: "Καμία τρέχουσα απόδειξη", en: "Nothing currently proven", cls: "inactive" },
  DISCOVERED: { el: "Εντοπίστηκε", en: "Discovered", cls: "warn" },
  AUTHENTICATED: { el: "Τοπική σύνδεση", en: "Authenticated", cls: "warn" },
  STATUS_READ: { el: "Ανάγνωση ακατέργαστης κατάστασης", en: "Raw status read", cls: "ok" },
  COMMAND_CONFIRMED: { el: "Επιβεβαιωμένη εντολή (σε κάποια λειτουργία)", en: "Command confirmed (some function)", cls: "ok" },
};
const STATE: Record<string, { el: string; cls: string }> = {
  VERIFIED: { el: "ισχύει", cls: "ok" }, EXPIRED: { el: "έληξε — χρειάζεται νέα δοκιμή", cls: "warn" }, REVALIDATION_REQUIRED: { el: "χρειάζεται επανεπιβεβαίωση (αλλαγή firmware/υλικού)", cls: "warn" },
  FAILED: { el: "απέτυχε", cls: "fail" }, CLOCK_SKEW: { el: "χρόνος μεταγενέστερος του ρολογιού του PMS — δεν ισχύει", cls: "fail" }, SIGNATURE_INVALID: { el: "η υπογραφή της αυτόματης εγγραφής δεν επαληθεύεται — δεν ισχύει", cls: "fail" }, REVOKED: { el: "ανακλήθηκε", cls: "fail" }, NOT_TESTED: { el: "δεν δοκιμάστηκε", cls: "inactive" }, NOT_APPLICABLE: { el: "—", cls: "inactive" },
};
const FN: Record<string, string> = { power: "On/Off", setpoint: "Θερμοκρασία ρύθμισης", mode: "Λειτουργία (mode)", fan: "Ανεμιστήρας", room_temperature: "Θερμοκρασία χώρου" };
const VER: Record<string, string> = { PROBE: "AC Probe", MANUALLY_ATTESTED: "χειροκίνητη βεβαίωση", AUTOMATIC_READBACK_VERIFIED: "αυτόματη επαλήθευση με νέα ανάγνωση" };
const ERRORS: Record<string, string> = {
  REPORT_IN_THE_FUTURE: "Η ώρα της αναφοράς είναι μεταγενέστερη από το ρολόι του PMS (πάνω από 2′) — διορθώστε το ρολόι του υπολογιστή που έτρεξε το AC Probe.",
  CALIBRATION_METHOD_REQUIRED: "Για θερμοκρασία χώρου δηλώστε τη μέθοδο αναφοράς (θερμόμετρο αναφοράς, θερμοστάτης τοίχου, οθόνη μονάδας).", TOLERANCE_REQUIRED: "Δηλώστε την ανοχή σε °C.", TOLERANCE_TOO_WIDE: "Η ανοχή δεν μπορεί να ξεπερνά 1,5 °C.",
  TEMPERATURE_OUTSIDE_TOLERANCE: "Η τιμή διαφέρει από την αναφορά περισσότερο από την ανοχή — πιθανώς λάθος datapoint.", TEMPERATURE_OUT_OF_RANGE: "Τιμή εκτός λογικού εύρους — ελέγξτε τον συντελεστή κλίμακας (π.χ. 0,1) και τη μονάδα (°C/°F).",
  MAPPING_NOT_NUMERIC: "Η τιμή πρέπει να είναι αριθμός.", REMOTE_CHANGE_NEEDS_ADAPTER: "Την αλλαγή από το τηλεχειριστήριο την καταγράφει μόνο το PMS μέσω πιστοποιημένου adapter.",
  NOT_AN_AC_PROBE_REPORT_V4: "Δεν είναι αναφορά AC Probe v4 ή νεότερη.", SHAREABLE_REPORT_HAS_NO_IDENTIFIERS: "Αυτή είναι η αναφορά κοινής χρήσης (χωρίς αναγνωριστικά) — εισάγετε την πλήρη, προστατευμένη αναφορά.",
  PREVIOUS_LEVEL_NOT_PROVEN: "Πρώτα πρέπει να ισχύει το προηγούμενο επίπεδο.", VALUES_REQUIRED: "Χρειάζονται οι τιμές που διαβάστηκαν.", MAPPING_REQUIRED: "Χρειάζεται η τιμή που διαβάστηκε και τι έδειξε η μονάδα.",
  MAPPING_DOES_NOT_MATCH: "Η τιμή που διαβάστηκε δεν ταιριάζει με αυτό που έδειξε η μονάδα.", FUNCTION_READ_NOT_CONFIRMED: "Πρώτα πρέπει να επιβεβαιωθεί η ανάγνωση αυτής της λειτουργίας.",
  COMMAND_REQUIRED: "Χρειάζεται η τιμή της εντολής.", READBACK_REQUIRED: "Χρειάζεται ανάγνωση πριν και μετά την εντολή.", READBACK_DOES_NOT_MATCH: "Η ανάγνωση μετά την εντολή δεν δείχνει την τιμή της εντολής.",
  NO_CHANGE_OBSERVED: "Η τιμή ήταν ήδη αυτή πριν την εντολή — δεν αποδεικνύει εκτέλεση.", DETAIL_REQUIRED: "Περιγράψτε τη δοκιμή (τουλάχιστον 10 χαρακτήρες).", MODEL_REQUIRED: "Χρειάζονται μάρκα, μοντέλο και Wi-Fi module.",
};

export function RegistryView({ lang, initial, canManage }: { lang: PmsLang; initial: DeviceRegistry; canManage: boolean }) {
  const el = lang === "el";
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : "—");
  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/device-registry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setMsg(ERRORS[d.error] ?? (el ? "Δεν ολοκληρώθηκε." : "Not done.")); return; }
      setData(d);
      const rej = d.result?.rejected?.length ? ` · ${d.result.rejected.length} εγγραφή(ές) απορρίφθηκαν από τους κανόνες: ${d.result.rejected.map((x: { error: string }) => ERRORS[x.error] ?? x.error).join(", ")}` : "";
      setMsg(ok + rej);
    } finally { setBusy(false); }
  }
  async function importFile(file: File) {
    let report: unknown;
    try { report = JSON.parse(await file.text()); } catch { setMsg(el ? "Το αρχείο δεν είναι JSON." : "Not a JSON file."); return; }
    await post({ action: "import", report }, el ? "Η αναφορά εισήχθη." : "Report imported.");
  }
  const ask = (q: string, d = "") => window.prompt(q, d);
  function assign(u: Unit) {
    const acBrand = ask("Μάρκα κλιματιστικού (π.χ. AUX, Inventor):"); if (!acBrand) return;
    const acModel = ask("Μοντέλο κλιματιστικού:"); if (!acModel) return;
    const wifiModule = ask("Wi-Fi module (π.χ. CTTG-40X24-WIFI-AKS2, EU-ODZ104):"); if (!wifiModule) return;
    const app = ask("Εφαρμογή (π.χ. AC Freedom, Inventor Control):") ?? "";
    const firmware = ask("Firmware (όπως φαίνεται στην εφαρμογή):") ?? "";
    const room = ask("Id δωματίου (προαιρετικό):") ?? "";
    void post({ action: "assign", unitId: u.id, roomId: /^\d+$/.test(room) ? Number(room) : null, model: { acBrand, acModel, wifiModule, app, firmware } }, el ? "Το μοντέλο ορίστηκε (αλλαγή μοντέλου/firmware → απαιτείται επανεπιβεβαίωση)." : "Model set.");
  }
  function mapRead(u: Unit) {
    const fn = ask("Λειτουργία που επιβεβαιώνεται (power, setpoint, mode, fan, room_temperature):"); if (!fn) return;
    const dp = ask("Datapoint / πεδίο (π.χ. 2):") ?? "";
    const value = ask("Τιμή που διαβάστηκε από το module (ακατέργαστη):"); if (value === null) return;
    const numeric = fn === "setpoint" || fn === "room_temperature";
    const scale = numeric ? Number((ask("Συντελεστής κλίμακας (1, ή 0.1 αν το module δίνει π.χ. 245 για 24,5 °C):", "1") ?? "1").replace(",", ".")) : undefined;
    const unit = numeric ? ((ask("Μονάδα του module (C ή F):", "C") ?? "C").toUpperCase() === "F" ? "F" : "C") : undefined;
    const observed = ask(fn === "room_temperature" ? "Θερμοκρασία αναφοράς την ίδια στιγμή (°C):" : "Τι έδειχνε η ίδια η μονάδα / το τηλεχειριστήριο εκείνη τη στιγμή:"); if (observed === null) return;
    let method: string | undefined, tolerance: number | undefined;
    if (fn === "room_temperature") {
      method = ({ "1": "reference_thermometer", "2": "wall_thermostat", "3": "unit_display" } as Record<string, string>)[ask("Μέθοδος αναφοράς: 1 = θερμόμετρο αναφοράς, 2 = θερμοστάτης τοίχου, 3 = οθόνη μονάδας", "1") ?? ""];
      tolerance = Number((ask("Ανοχή σε °C (έως 1,5):", "1") ?? "").replace(",", "."));
    }
    const detail = ask("Πώς έγινε ο έλεγχος;") ?? "";
    const num = (x: string) => (numeric && x.trim() !== "" && Number.isFinite(Number(x.replace(",", "."))) ? Number(x.replace(",", ".")) : x);
    void post({ action: "evidence", unitId: u.id, level: "STATUS_READ", result: "PASS", method: "manual-mapping", function: fn, detail, functions: { mapping: { dp, value: num(value), observed: num(observed), ...(numeric ? { scale, unit } : {}), ...(method ? { method, tolerance } : {}) } } }, el ? "Η αντιστοίχιση καταγράφηκε (χειροκίνητη βεβαίωση)." : "Mapping recorded.");
  }
  function command(u: Unit) {
    const fn = ask("Ποια λειτουργία δοκιμάστηκε; (power, setpoint, mode, fan)"); if (!fn) return;
    const value = ask("Τιμή εντολής:"); if (value === null) return;
    const before = ask("Τιμή που διαβάστηκε ΠΡΙΝ την εντολή:"); if (before === null) return;
    const after = ask("Τιμή που διαβάστηκε ΜΕΤΑ την εντολή:"); if (after === null) return;
    const detail = ask("Πώς έγινε η δοκιμή;") ?? "";
    void post({ action: "evidence", unitId: u.id, level: "COMMAND_CONFIRMED", result: "PASS", method: "manual-test", function: fn, detail, functions: { command: { value }, before: { value: before }, after: { value: after } } }, el ? "Η δοκιμή καταγράφηκε ως ΧΕΙΡΟΚΙΝΗΤΗ βεβαίωση — δεν επιτρέπει αυτόματο έλεγχο." : "Recorded as a manual attestation.");
  }
  function revoke(u: Unit, fn: string) {
    const detail = ask(`Γιατί ανακαλείται η εντολή «${FN[fn]}»;`) ?? ""; if (!detail.trim()) return;
    void post({ action: "revoke", unitId: u.id, function: fn, detail }, el ? "Η άδεια ανακλήθηκε." : "Permission revoked.");
  }
  function hardware(u: Unit) {
    const reason = ask("Τι άλλαξε; (π.χ. «ενημέρωση firmware 1.2.0», «αντικατάσταση module»)") ?? ""; if (!reason.trim()) return;
    void post({ action: "hardware_change", unitId: u.id, reason }, el ? "Καταγράφηκε — όλα τα προηγούμενα τεκμήρια χρειάζονται επανεπιβεβαίωση." : "Recorded — revalidation required.");
  }
  const modelOf = (id: number | null) => data.models.find((m) => m.id === id);
  return (
    <div className="rcPage">
      <p className="muted">{el ? `Επίπεδα μονάδας: Εντοπίστηκε → Τοπική σύνδεση → Ανάγνωση ακατέργαστης κατάστασης → Επιβεβαιωμένη εντολή. Οι άδειες δίνονται ΑΝΑ ΛΕΙΤΟΥΡΓΙΑ (On/Off, θερμοκρασία ρύθμισης, mode, ανεμιστήρας): η επιβεβαίωση μίας δεν επιτρέπει τις άλλες. Τα τεκμήρια λήγουν (${data.ttlDays.DISCOVERED} ημέρες για τα επίπεδα, ${data.ttlDays.COMMAND} για εντολές) και μια αλλαγή firmware ή υλικού απαιτεί νέα δοκιμή — τα παλιά μένουν στο ιστορικό. Αυτόματος έλεγχος (π.χ. όριο θερμοκρασίας) επιτρέπεται μόνο με «αυτόματη επαλήθευση με νέα ανάγνωση», ποτέ με χειροκίνητη βεβαίωση.` : "Per-function permissions, evidence expires, firmware/hardware change requires revalidation; automatic control only with automatic read-back verification."}</p>
      {canManage && <p>
        <label className="secondaryButton">{el ? "Εισαγωγή αναφοράς AC Probe (πλήρης, προστατευμένη)" : "Import AC Probe report"} <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} /></label>{" "}
        <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "seed_hotel_modules" }, el ? "Τα modules του ξενοδοχείου προστέθηκαν στον κατάλογο." : "Hotel modules added.")}>{el ? "Modules του ξενοδοχείου & πλάνο δοκιμών" : "Hotel modules & test plan"}</button>
      </p>}
      {msg && <p className="notice" role="status">{msg}</p>}
      <article className="card">
        <h2>{el ? "Κατάλογος μοντέλων και πλάνο δοκιμών" : "Models and test plan"}</h2>
        {data.models.length === 0 ? <p className="muted">{el ? "Κενός κατάλογος." : "Empty."}</p> :
          <table className="table"><thead><tr><th>{el ? "Κλιματιστικό" : "A/C"}</th><th>Wi-Fi module</th><th>{el ? "Εφαρμογή" : "App"}</th><th>Firmware</th><th>{el ? "Στόχος / πλάνο" : "Target / plan"}</th><th>{el ? "Μονάδες ανά επίπεδο" : "Units per level"}</th><th>{el ? "Τρέχουσες άδειες" : "Current permissions"}</th></tr></thead>
            <tbody>{data.models.map((m) => <tr key={m.id}><td>{m.acBrand} {m.acModel}{m.installed ? "" : <small className="muted"> (μη εγκατεστημένο)</small>}</td><td>{m.wifiModule}</td><td>{m.app || "—"}</td><td>{m.firmware || "—"}</td>
              <td>{m.targetLevel ? `${LEVEL[m.targetLevel]?.[lang] ?? m.targetLevel}${m.targetReached ? " ✓" : ""}` : "—"}{m.plan ? <><br /><small className="muted">{m.plan}</small></> : null}</td>
              <td>{Object.entries(m.byLevel).filter(([, n]) => n).map(([l, n]) => `${LEVEL[l][lang]}: ${n}`).join(" · ") || "—"}</td>
              <td>{[...m.confirmedRead.map((f) => `${el ? "ανάγνωση" : "read"} ${FN[f]}`), ...m.confirmedCommands.map((c) => `${el ? "εντολή" : "command"} ${FN[c.function]}${c.automatic ? " (αυτόματη)" : " (χειροκίνητη)"}`)].join(", ") || "—"}</td></tr>)}</tbody></table>}
      </article>
      <div className="rcGrid">{data.units.map((u) => {
        const m = modelOf(u.modelId);
        return (
          <article key={u.id} className={`card rcArea st-${LEVEL[u.level].cls}`}>
            <header><h2>{u.room ? `${el ? "Δωμάτιο" : "Room"} ${u.room}` : u.label || `#${u.id}`}</h2></header>
            <p className="rcSummary"><b>{LEVEL[u.level][lang]}</b> · {m ? `${m.acBrand} ${m.acModel} · ${m.wifiModule}${m.firmware ? ` · fw ${m.firmware}` : ""}` : (el ? "μοντέλο δεν έχει οριστεί" : "model not set")} · {u.detected.protocol || "—"}</p>
            {u.timeUncertain && <p className="rcItem lv-warn"><span className="rcDot" aria-hidden>⏱</span><span>{el ? "Τεκμήρια με απόκλιση ρολογιού: ισχύουν για ανάγνωση, όχι για αυτόματο έλεγχο." : "Evidence with clock skew: valid for reading, never for automatic control."}</span></p>}
            {u.revalidation && <p className="rcItem lv-warn"><span className="rcDot" aria-hidden>!</span><span>{el ? "Αλλαγή" : "Change"} {when(u.revalidation.at)}: {u.revalidation.reason} — {el ? "τεκμήρια πριν από αυτή δεν ισχύουν" : "earlier evidence no longer counts"}</span></p>}
            <ul className="rcItems">{(["DISCOVERED", "AUTHENTICATED", "STATUS_READ"] as const).map((l) => { const j = u.levels[l]; return <li key={l} className={`rcItem lv-${STATE[j.state].cls}`}><span className="rcDot" aria-hidden>{j.state === "VERIFIED" ? "✓" : "…"}</span><span><b>{LEVEL[l][lang]}</b>: {STATE[j.state].el}{j.lastVerifiedAt ? ` · τελευταία επιβεβαίωση ${when(j.lastVerifiedAt)}` : ""}{j.validUntil ? ` · ισχύει έως ${when(j.validUntil)}` : ""}</span></li>; })}</ul>
            <table className="table"><thead><tr><th>{el ? "Λειτουργία" : "Function"}</th><th>{el ? "Ανάγνωση" : "Read"}</th><th>{el ? "Εντολή" : "Command"}</th><th /></tr></thead>
              <tbody>{data.functions.map((f) => { const s = u.functions[f]; const guard = (u.allowed.guard as Record<string, { step: string; ok: boolean }[]>)[f]; return <tr key={f}><td>{FN[f]}{u.candidates[f] !== undefined ? <small className="muted"> (υποψήφιο: {String(u.candidates[f])})</small> : null}</td>
                <td className={STATE[s.read.state].cls === "ok" ? "credit" : ""}>{STATE[s.read.state].el}{s.read.verification ? ` · ${VER[s.read.verification]}` : ""}</td>
                <td className={STATE[s.command.state].cls === "ok" ? "credit" : s.command.state === "REVOKED" ? "debit" : ""}>{STATE[s.command.state].el}{s.command.verification ? ` · ${VER[s.command.verification]}` : ""}{u.allowed.automation[f as "power"] ? " · αυτόματος έλεγχος ✓" : ""}{guard ? <><br /><small className="muted">Temperature Guard: {guard.map((g) => `${g.ok ? "✓" : "…"} ${({ read: "ανάγνωση", remote_change_detected: "αλλαγή τηλεχειριστηρίου εντοπίστηκε από το PMS", test_command_readback: "δοκιμαστική εντολή + νέα ανάγνωση (adapter)" } as Record<string, string>)[g.step]}`).join(" · ")}</small></> : null}</td>
                <td>{canManage && s.command.state === "VERIFIED" && <button type="button" className="secondaryButton" disabled={busy} onClick={() => revoke(u, f)}>{el ? "Ανάκληση" : "Revoke"}</button>}</td></tr>; })}</tbody></table>
            {u.refs && <small className="muted">{el ? "Προστατευμένα στοιχεία" : "Protected"}: {u.refs.ip} · {u.refs.mac ?? "—"}{u.refs.tuyaDeviceId ? ` · ${u.refs.tuyaDeviceId}` : ""}</small>}
            <details><summary>{el ? "Ιστορικό δοκιμών" : "Test history"} ({u.evidence.length})</summary>
              <ul className="rcItems">{u.evidence.map((e) => <li key={e.id} className={`rcItem lv-${e.result === "PASS" ? "ok" : e.result === "INCONCLUSIVE" ? "warn" : "fail"}`}><span className="rcDot" aria-hidden>{e.result === "PASS" ? "✓" : e.result === "INCONCLUSIVE" ? "?" : "✕"}</span><span><b>{LEVEL[e.level][lang]}{e.function ? ` · ${FN[e.function]}` : ""}</b> {e.result} — {e.detail} <small className="muted">{VER[e.verification] ?? e.verification}{e.signed ? " · υπογεγραμμένο" : ""}{e.commandId ? ` · εντολή ${e.commandId.slice(0, 8)}` : ""}{e.clockSkewMs ? ` · απόκλιση ρολογιού ${Math.round(e.clockSkewMs / 1000)}″` : ""} · {e.method} · {e.by} · {when(e.at)}</small></span></li>)}</ul>
            </details>
            {canManage && <span>
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => assign(u)}>{el ? "Μοντέλο / δωμάτιο" : "Model / room"}</button>{" "}
              <button type="button" className="secondaryButton" disabled={busy || u.levels.STATUS_READ.state !== "VERIFIED"} onClick={() => mapRead(u)}>{el ? "Επιβεβαίωση ανάγνωσης λειτουργίας" : "Confirm a function read"}</button>{" "}
              <button type="button" className="secondaryButton" disabled={busy || !data.functions.some((f) => u.functions[f].read.state === "VERIFIED" && f !== "room_temperature")} onClick={() => command(u)}>{el ? "Χειροκίνητη δοκιμή εντολής" : "Manual command test"}</button>{" "}
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => hardware(u)}>{el ? "Αλλαγή firmware / υλικού" : "Firmware / hardware change"}</button>
            </span>}
          </article>
        );
      })}</div>
    </div>
  );
}
