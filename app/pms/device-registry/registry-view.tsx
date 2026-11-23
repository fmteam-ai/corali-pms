"use client";
import { useState } from "react";
import type { DeviceRegistry } from "@/lib/device-registry";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

const LEVEL: Record<string, { el: string; en: string; cls: string }> = {
  NONE: { el: "Καμία απόδειξη", en: "Nothing proven", cls: "inactive" },
  DISCOVERED: { el: "Εντοπίστηκε", en: "Discovered", cls: "warn" },
  AUTHENTICATED: { el: "Τοπική σύνδεση", en: "Authenticated", cls: "warn" },
  STATUS_READ: { el: "Ανάγνωση κατάστασης", en: "Status read", cls: "ok" },
  COMMAND_CONFIRMED: { el: "Εντολή επιβεβαιωμένη", en: "Command confirmed", cls: "ok" },
};
const ERRORS: Record<string, string> = {
  NOT_AN_AC_PROBE_REPORT_V4: "Δεν είναι αναφορά AC Probe v4 ή νεότερη.", SHAREABLE_REPORT_HAS_NO_IDENTIFIERS: "Αυτή είναι η αναφορά κοινής χρήσης (χωρίς αναγνωριστικά) — εισάγετε την πλήρη, προστατευμένη αναφορά.",
  PREVIOUS_LEVEL_NOT_PROVEN: "Πρώτα πρέπει να αποδειχθεί το προηγούμενο επίπεδο.", VALUES_REQUIRED: "Η ανάγνωση κατάστασης χρειάζεται τις τιμές που διαβάστηκαν.",
  COMMAND_REQUIRED: "Χρειάζεται η εντολή που στάλθηκε.", READBACK_REQUIRED: "Χρειάζεται ανάγνωση πριν και μετά την εντολή.", READBACK_DOES_NOT_MATCH: "Η ανάγνωση μετά την εντολή δεν δείχνει την τιμή της εντολής.",
  NO_CHANGE_OBSERVED: "Η τιμή ήταν ήδη αυτή πριν την εντολή — δεν αποδεικνύει εκτέλεση.", DETAIL_REQUIRED: "Περιγράψτε τη δοκιμή (τουλάχιστον 10 χαρακτήρες).", MODEL_REQUIRED: "Χρειάζονται μάρκα, μοντέλο και Wi-Fi module.",
};

export function RegistryView({ lang, initial, canManage }: { lang: PmsLang; initial: DeviceRegistry; canManage: boolean }) {
  const el = lang === "el";
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/device-registry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setMsg(ERRORS[d.error] ?? (el ? "Δεν ολοκληρώθηκε." : "Not done.")); return; }
      setData(d); setMsg(ok);
    } finally { setBusy(false); }
  }
  async function importFile(file: File) {
    let report: unknown;
    try { report = JSON.parse(await file.text()); } catch { setMsg(el ? "Το αρχείο δεν είναι JSON." : "Not a JSON file."); return; }
    await post({ action: "import", report }, el ? "Η αναφορά εισήχθη." : "Report imported.");
  }
  function assign(unitId: number) {
    const ask = (q: string, d = "") => window.prompt(q, d);
    const acBrand = ask("Μάρκα κλιματιστικού (π.χ. AUX, Inventor):"); if (!acBrand) return;
    const acModel = ask("Μοντέλο κλιματιστικού:"); if (!acModel) return;
    const wifiModule = ask("Wi-Fi module (π.χ. CTTG-40X24-WIFI-AKS2, EU-ODZ104):"); if (!wifiModule) return;
    const app = ask("Εφαρμογή (π.χ. AC Freedom, Inventor Control):") ?? "";
    const firmware = ask("Firmware (αν φαίνεται στην εφαρμογή):") ?? "";
    const room = ask("Αριθμός δωματίου (προαιρετικό, id):") ?? "";
    void post({ action: "assign", unitId, roomId: /^\d+$/.test(room) ? Number(room) : null, model: { acBrand, acModel, wifiModule, app, firmware } }, el ? "Το μοντέλο ορίστηκε." : "Model set.");
  }
  function command(unitId: number) {
    const name = window.prompt("Ποια λειτουργία δοκιμάστηκε; (π.χ. power, setpoint)"); if (!name) return;
    const value = window.prompt("Τιμή που στάλθηκε (π.χ. 24 ή true):"); if (value === null) return;
    const before = window.prompt("Τιμή που διαβάστηκε ΠΡΙΝ την εντολή:"); if (before === null) return;
    const after = window.prompt("Τιμή που διαβάστηκε ΜΕΤΑ την εντολή:"); if (after === null) return;
    const detail = window.prompt("Πώς έγινε η δοκιμή; (π.χ. «εντολή από τοπικό API, η οθόνη της μονάδας έδειξε 24°C»)") ?? "";
    void post({ action: "evidence", unitId, level: "COMMAND_CONFIRMED", result: "PASS", method: "manual-test", detail, functions: { command: { name, value }, before: { [name]: before }, after: { [name]: after } } }, el ? "Η δοκιμή εντολής καταγράφηκε." : "Command test recorded.");
  }
  const modelOf = (id: number | null) => data.models.find((m) => m.id === id);
  return (
    <div className="rcPage">
      <p className="muted">{el ? "Διαβάθμιση: Εντοπίστηκε → Τοπική σύνδεση → Ανάγνωση κατάστασης → Εντολή επιβεβαιωμένη. Κάθε επίπεδο αποδεικνύεται με ξεχωριστή δοκιμή· μια αποτυχημένη δοκιμή κατεβάζει το επίπεδο, μια χωρίς απάντηση (INCONCLUSIVE) δεν το αλλάζει. Το PMS διαβάζει μόνο από «Ανάγνωση κατάστασης» και στέλνει εντολές μόνο σε «Εντολή επιβεβαιωμένη»." : "Ladder: Discovered → Authenticated → Status read → Command confirmed. Each level is proven by its own test; a failed test lowers it, an unanswered one (INCONCLUSIVE) does not change it. The PMS reads only from «Status read» and sends commands only at «Command confirmed»."}</p>
      {canManage && <p><label className="secondaryButton">{el ? "Εισαγωγή αναφοράς AC Probe (πλήρης, προστατευμένη)" : "Import AC Probe report (full, protected)"} <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} /></label></p>}
      {msg && <p className="notice" role="status">{msg}</p>}
      <article className="card">
        <h2>{el ? "Μοντέλα" : "Models"}</h2>
        {data.models.length === 0 ? <p className="muted">{el ? "Δεν έχει οριστεί μοντέλο. Μετά την εισαγωγή αναφοράς, ορίστε το μοντέλο κάθε μονάδας." : "No model yet. After importing a report, set each unit's model."}</p> :
          <table className="table"><thead><tr><th>{el ? "Κλιματιστικό" : "A/C"}</th><th>Wi-Fi module</th><th>{el ? "Εφαρμογή" : "App"}</th><th>Firmware</th><th>{el ? "Μονάδες ανά επίπεδο" : "Units per level"}</th><th>{el ? "Επιβεβαιωμένες λειτουργίες" : "Confirmed functions"}</th></tr></thead>
            <tbody>{data.models.map((m) => <tr key={m.id}><td>{m.acBrand} {m.acModel}</td><td>{m.wifiModule}</td><td>{m.app || "—"}</td><td>{m.firmware || "—"}</td><td>{Object.entries(m.byLevel).filter(([, n]) => n).map(([l, n]) => `${LEVEL[l][lang]}: ${n}`).join(" · ") || "—"}</td><td>{[...m.confirmedRead.map((x) => `${el ? "ανάγνωση" : "read"} ${x}`), ...m.confirmedCommands.map((x) => `${el ? "εντολή" : "command"} ${x}`)].join(", ") || "—"}</td></tr>)}</tbody></table>}
      </article>
      <div className="rcGrid">{data.units.map((u) => {
        const m = modelOf(u.modelId);
        return (
          <article key={u.id} className={`card rcArea st-${LEVEL[u.level].cls}`}>
            <header><h2>{u.room ? `${el ? "Δωμάτιο" : "Room"} ${u.room}` : u.label || `#${u.id}`}</h2></header>
            <p className="rcSummary"><b>{LEVEL[u.level][lang]}</b> · {m ? `${m.acBrand} ${m.acModel} · ${m.wifiModule}${m.firmware ? ` · fw ${m.firmware}` : ""}` : (el ? "μοντέλο δεν έχει οριστεί" : "model not set")} · {u.detected.protocol || "—"}</p>
            <p className="muted">{el ? "Επιτρέπεται" : "Allowed"}: {u.allowed.read ? (el ? "ανάγνωση" : "read") : (el ? "όχι ανάγνωση" : "no read")} · {u.allowed.command ? (el ? "εντολές" : "commands") : (el ? "όχι εντολές" : "no commands")}</p>
            {u.refs && <small className="muted">{el ? "Προστατευμένα στοιχεία" : "Protected"}: {u.refs.ip} · {u.refs.mac ?? "—"}{u.refs.tuyaDeviceId ? ` · ${u.refs.tuyaDeviceId}` : ""}</small>}
            <ul className="rcItems">{u.evidence.map((e) => <li key={e.id} className={`rcItem lv-${e.result === "PASS" ? "ok" : e.result === "FAIL" ? "fail" : "warn"}`}><span className="rcDot" aria-hidden>{e.result === "PASS" ? "✓" : e.result === "FAIL" ? "✕" : "?"}</span><span><b>{LEVEL[e.level][lang]}</b> {e.result} — {e.detail} <small className="muted">{e.method} · {e.by} · {when(e.at)}</small></span></li>)}</ul>
            {canManage && <span>
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => assign(u.id)}>{el ? "Μοντέλο / δωμάτιο" : "Model / room"}</button>{" "}
              <button type="button" className="secondaryButton" disabled={busy || u.level !== "STATUS_READ"} onClick={() => command(u.id)}>{el ? "Καταγραφή δοκιμής εντολής" : "Record command test"}</button>
            </span>}
          </article>
        );
      })}</div>
    </div>
  );
}
