"use client";
// PMS → Corali TV → «Ήχος & Hotel Mode» (v159): volume / mute per room through the Corali TV app (≥ 1.9), sound
// policy (power-on volume, maximum volume enforced by the app = software), what each TV reports it can do, and the
// factory Hotel Mode settings as read (never written). Every command shows the TV's own report, not just "sent".
import { useCallback, useEffect, useState } from "react";
import type { TvScreenRow } from "@/lib/tv";
import type { CommandRow } from "@/lib/tv-commands";
import { agentState, FINAL_STATUSES, type SoundPolicy } from "../../../scripts/tv-command-core.mjs";

type Policy = SoundPolicy & { rev?: number };
type Data = { screens: TvScreenRow[]; policies: Record<number, Policy>; commands: Record<number, CommandRow>; soundApp: number };

const EL = {
  title: "Ήχος & Hotel Mode",
  help: "Η ένταση αλλάζει από την εφαρμογή Corali TV (1.9 ή νεότερη) μέσω Wi-Fi. Κάθε εντολή δείχνει «✓» μόνο όταν η τηλεόραση διαβάσει μετά την πραγματική ένταση. Το «μέγιστο» είναι όριο λογισμικού της εφαρμογής: αν ο επισκέπτης το ξεπεράσει με το τηλεχειριστήριο, η εφαρμογή το επαναφέρει σε λίγα δευτερόλεπτα — δεν είναι εργοστασιακό κλείδωμα.",
  room: "Δωμάτιο", state: "Τηλεόραση", volume: "Ένταση", policy: "Πολιτική ήχου", caps: "Δυνατότητες (όπως τις αναφέρει η TV)", last: "Τελευταία εντολή",
  set: "Ορισμός", mute: "🔇 Σίγαση", unmute: "🔊 Ήχος", muted: "σίγαση", fixed: "σταθερή ένταση (π.χ. ήχος από HDMI ARC) — δεν αλλάζει από εφαρμογή",
  def: "Ένταση στο άναμμα %", max: "Μέγιστη %", enforce: "Επιβολή μεγίστου από την εφαρμογή (λογισμικό)", save: "Αποθήκευση πολιτικής",
  selected: "Επιλεγμένα", all: "Όλα", none: "Κανένα", applyPolicy: "Εφαρμογή πολιτικής στα επιλεγμένα", setSelected: "Ένταση στα επιλεγμένα",
  muteSelected: "Σίγαση επιλεγμένων", unmuteSelected: "Ήχος επιλεγμένων",
  agent_unknown: "δεν έχει αναφέρει", agent_offline: "εκτός σύνδεσης", agent_online: "συνδεδεμένη", agent_screen_on: "οθόνη αναμμένη", agent_screen_off: "οθόνη σβηστή",
  appOld: "Χρειάζεται Corali TV 1.9 (booking.hotelcorali.gr/tvapp)", APP_TOO_OLD: "χρειάζεται Corali TV 1.9", NO_SCREEN: "χωρίς τηλεόραση",
  queued: "Στάλθηκε σε {n} τηλεοράσεις· τα αποτελέσματα εμφανίζονται ανά δωμάτιο.", notQueued: "Δεν στάλθηκε: ", policySaved: "Η πολιτική αποθηκεύτηκε για {n} δωμάτια· εφαρμόζεται στον επόμενο έλεγχο κάθε τηλεόρασης (~20″).",
  clamped: "επαναφέρθηκε στο μέγιστο", failed: "Η ενέργεια απέτυχε.",
  st_PENDING: "⏳ αναμένει την TV", st_DELIVERED: "📨 αναμένεται επιβεβαίωση", st_EXECUTED: "✓ εκτελέστηκε", st_FAILED: "✗ απέτυχε", st_TIMEOUT: "⌛ δεν παραδόθηκε", st_UNVERIFIED: "? χωρίς επιβεβαίωση", st_CANCELLED: "ακυρώθηκε",
  cmd_SET_VOLUME: "Ένταση", cmd_VOLUME_UP: "Ένταση +", cmd_VOLUME_DOWN: "Ένταση −", cmd_MUTE: "Σίγαση", cmd_UNMUTE: "Ήχος", cmd_SCREEN_ON: "Άναμμα οθόνης", cmd_SCREEN_OFF: "Σβήσιμο οθόνης", cmd_SHOW_WELCOME: "Καλωσόρισμα",
  cap_volume: "Ένταση", cap_mute: "Σίγαση", cap_fixedVolume: "Σταθερή ένταση", cap_factoryApp: "Εργοστασιακή εφαρμογή", cap_factoryHotelMode: "hotel_mode", cap_factoryMaxVolume: "hotel_max_volume", cap_factoryPowerVolume: "hotel_power_volume", cap_factoryMenuLock: "hotel_menu_key_lock",
  unsupported: "Δεν υποστηρίζεται",
  unsupportedHelp: "Κλείδωμα μενού, κλείδωμα πηγής (HDMI) και εργοστασιακό όριο έντασης: η τηλεόραση έχει εργοστασιακές ρυθμίσεις Hotel Mode, αλλά καμία εξουσιοδοτημένη πρόσβαση για εφαρμογές. Οι τιμές τους εμφανίζονται μόνο για ενημέρωση (ανάγνωση) και δεν αλλάζουν από το PMS.",
  menuLock: "Κλείδωμα μενού", sourceLock: "Κλείδωμα πηγής",
  noPerm: "Μόνο ανάγνωση (χρειάζεται δικαίωμα κρατήσεων για την ένταση / διαχειριστή για την πολιτική).",
};
const EN: typeof EL = {
  ...EL,
  title: "Sound & Hotel Mode",
  help: "Volume is changed by the Corali TV app (1.9 or newer) over Wi-Fi. A command shows “✓” only when the TV read the real volume back afterwards. The “maximum” is a software limit of the app: if a guest goes above it with the remote, the app brings it back within seconds — it is not a factory lock.",
  room: "Room", state: "TV", volume: "Volume", policy: "Sound policy", caps: "Capabilities (as reported by the TV)", last: "Last command",
  set: "Set", mute: "🔇 Mute", unmute: "🔊 Unmute", muted: "muted", fixed: "fixed volume (e.g. sound over HDMI ARC) — cannot be changed by an app",
  def: "Power-on volume %", max: "Maximum %", enforce: "Enforce maximum in the app (software)", save: "Save policy",
  selected: "Selected", all: "All", none: "None", applyPolicy: "Apply policy to selected", setSelected: "Volume for selected",
  muteSelected: "Mute selected", unmuteSelected: "Unmute selected",
  agent_unknown: "never reported", agent_offline: "offline", agent_online: "connected", agent_screen_on: "screen on", agent_screen_off: "screen off",
  appOld: "Needs Corali TV 1.9 (booking.hotelcorali.gr/tvapp)", APP_TOO_OLD: "needs Corali TV 1.9", NO_SCREEN: "no TV",
  queued: "Sent to {n} TVs; results appear per room.", notQueued: "Not sent: ", policySaved: "Policy saved for {n} rooms; each TV applies it on its next check (~20″).",
  clamped: "brought back to the maximum", failed: "The action failed.",
  st_PENDING: "⏳ waiting for the TV", st_DELIVERED: "📨 awaiting confirmation", st_EXECUTED: "✓ executed", st_FAILED: "✗ failed", st_TIMEOUT: "⌛ not delivered", st_UNVERIFIED: "? not confirmed", st_CANCELLED: "cancelled",
  cmd_SET_VOLUME: "Volume", cmd_VOLUME_UP: "Volume +", cmd_VOLUME_DOWN: "Volume −", cmd_MUTE: "Mute", cmd_UNMUTE: "Unmute", cmd_SCREEN_ON: "Screen on", cmd_SCREEN_OFF: "Screen off", cmd_SHOW_WELCOME: "Welcome",
  cap_volume: "Volume", cap_mute: "Mute", cap_fixedVolume: "Fixed volume", cap_factoryApp: "Factory app",
  unsupported: "Not supported",
  unsupportedHelp: "Menu lock, source (HDMI) lock and the factory volume limit: the TV has factory Hotel Mode settings, but no authorised access for apps. Their values are shown for information only (read) and are not changed by the PMS.",
  menuLock: "Menu lock", sourceLock: "Source lock",
  noPerm: "Read only (volume needs the reservations permission, the policy needs admin).",
};

export function SoundManager({ lang, canCommand, canPolicy }: { lang: string; canCommand: boolean; canPolicy: boolean }) {
  const T = lang === "en" ? EN : EL;
  const tx = (k: string) => (T as Record<string, string>)[k] ?? k;
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [vol, setVol] = useState<Record<number, number>>({});
  const [bulkVol, setBulkVol] = useState(30);
  const [edit, setEdit] = useState<Record<number, Policy>>({});
  const [bulkPolicy, setBulkPolicy] = useState<Policy>({ defaultVolume: 25, maxVolume: 50, enforceMax: true });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/pms/tv/sound", { cache: "no-store" })).json();
      if (d.ok) { setData(d); setNow(Date.now()); }
    } catch { /* next tick */ }
  }, []);
  const waiting = data ? Object.values(data.commands).some((c) => !FINAL_STATUSES.includes(c.status as never)) : false;
  useEffect(() => {
    queueMicrotask(() => { void load(); });
    const id = window.setInterval(() => void load(), waiting ? 4_000 : 30_000);
    return () => window.clearInterval(id);
  }, [load, waiting]);

  async function post(body: unknown) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/tv/sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setMsg(`${T.failed}${d.error ? ` (${d.error})` : ""}`); return null; }
      return d;
    } finally { setBusy(false); }
  }
  async function command(roomIds: number[], cmd: string, value?: number) {
    const d = await post({ action: "command", roomIds, command: cmd, value });
    if (!d) return;
    const res = Object.entries(d.results as Record<string, { queued: boolean; error?: string }>);
    const ok = res.filter(([, r]) => r.queued).length;
    const bad = res.filter(([, r]) => !r.queued).map(([room, r]) => `${data?.screens.find((s) => s.room_id === Number(room))?.room_code ?? room}: ${tx(r.error ?? "")}`);
    setMsg(`${T.queued.replace("{n}", String(ok))}${bad.length ? ` ${T.notQueued}${bad.join(", ")}` : ""}`);
    setData((x) => (x ? { ...x, commands: d.commands } : x));
  }
  async function savePolicy(roomIds: number[], p: Policy) {
    const d = await post({ action: "policy", roomIds, policy: { defaultVolume: p.defaultVolume, maxVolume: p.maxVolume, enforceMax: p.enforceMax } });
    if (!d) return;
    setMsg(T.policySaved.replace("{n}", String(d.saved.length)));
    setData((x) => (x ? { ...x, policies: d.policies } : x));
    setEdit((e) => { const n = { ...e }; for (const r of roomIds) delete n[r]; return n; });
  }

  if (!data) return null;
  const screens = data.screens.filter((s) => s.active === 1);
  const at = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString(lang === "en" ? "en-GB" : "el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : "");
  const pctInput = (v: number | null, on: (n: number | null) => void, disabled: boolean) => (
    <input type="number" min={0} max={100} style={{ width: "4.5em" }} value={v ?? ""} disabled={disabled} onChange={(e) => on(e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))))} />
  );
  const selected = [...sel];

  return (
    <div className="hubCard">
      <h2>{T.title}</h2>
      <small>{T.help}</small>
      {!canCommand && !canPolicy && <p className="muted">{T.noPerm}</p>}
      <p className="notice"><b>{T.menuLock}: {T.unsupported} · {T.sourceLock}: {T.unsupported}</b><br /><small>{T.unsupportedHelp}</small></p>

      <div className="tvAdminChecks">
        <b>{T.selected}: {selected.length}</b>
        <button type="button" className="secondaryButton" onClick={() => setSel(new Set(screens.map((s) => s.room_id)))}>{T.all}</button>
        <button type="button" className="secondaryButton" onClick={() => setSel(new Set())}>{T.none}</button>
        {canCommand && <>
          <label className="inline">{T.setSelected} {pctInput(bulkVol, (n) => setBulkVol(n ?? 0), busy)}%</label>
          <button type="button" disabled={busy || !selected.length} onClick={() => void command(selected, "SET_VOLUME", bulkVol)}>{T.set}</button>
          <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void command(selected, "MUTE")}>{T.muteSelected}</button>
          <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void command(selected, "UNMUTE")}>{T.unmuteSelected}</button>
        </>}
      </div>
      {canPolicy && (
        <div className="tvAdminChecks">
          <label className="inline">{T.def} {pctInput(bulkPolicy.defaultVolume, (n) => setBulkPolicy({ ...bulkPolicy, defaultVolume: n }), busy)}</label>
          <label className="inline">{T.max} {pctInput(bulkPolicy.maxVolume, (n) => setBulkPolicy({ ...bulkPolicy, maxVolume: n }), busy)}</label>
          <label className="inline"><input type="checkbox" checked={bulkPolicy.enforceMax} onChange={(e) => setBulkPolicy({ ...bulkPolicy, enforceMax: e.target.checked })} /> {T.enforce}</label>
          <button type="button" disabled={busy || !selected.length} onClick={() => void savePolicy(selected, bulkPolicy)}>{T.applyPolicy}</button>
        </div>
      )}

      <div className="tableWrap"><table>
        <thead><tr><th /><th>{T.room}</th><th>{T.state}</th><th>{T.volume}</th><th>{T.policy}</th><th>{T.caps}</th><th>{T.last}</th></tr></thead>
        <tbody>{screens.map((s) => {
          const st = agentState(s.screen_seen_at, s.screen_interactive, now);
          const old = s.app_version === null || s.app_version < data.soundApp;
          const p = edit[s.room_id] ?? data.policies[s.room_id] ?? { defaultVolume: null, maxVolume: null, enforceMax: false };
          const c = data.commands[s.room_id];
          const v = vol[s.room_id] ?? s.volume_percent ?? 30;
          const caps = Object.entries(s.caps ?? {});
          return (
            <tr key={s.room_id}>
              <td><input type="checkbox" aria-label={s.room_code} checked={sel.has(s.room_id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(s.room_id); else n.delete(s.room_id); return n; })} /></td>
              <td><b>{s.room_code}</b></td>
              <td><small className={st === "offline" || st === "unknown" ? "debit" : "credit"}>{tx(`agent_${st}`)}</small>{s.screen_seen_at ? <small className="muted"> · {at(s.screen_seen_at)}</small> : null}{old && <><br /><small className="muted">{T.appOld}</small></>}</td>
              <td>
                {s.volume_percent !== null ? <b>{s.volume_percent}%{s.volume_muted === 1 ? ` · ${T.muted}` : ""}</b> : <span className="muted">—</span>}
                {s.volume_fixed === 1 && <><br /><small className="debit">{T.fixed}</small></>}
                {s.policy_clamped_at && <><br /><small className="muted">{T.clamped} {at(s.policy_clamped_at)}</small></>}
                {canCommand && !old && <div className="apRow">
                  <input type="range" min={0} max={100} value={v} disabled={busy} onChange={(e) => setVol({ ...vol, [s.room_id]: Number(e.target.value) })} aria-label={T.volume} />
                  <span>{v}%</span>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], "SET_VOLUME", v)}>{T.set}</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], "VOLUME_DOWN")}>−</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], "VOLUME_UP")}>+</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], s.volume_muted === 1 ? "UNMUTE" : "MUTE")}>{s.volume_muted === 1 ? T.unmute : T.mute}</button>
                </div>}
              </td>
              <td>
                <label className="inline">{T.def} {pctInput(p.defaultVolume, (n) => setEdit({ ...edit, [s.room_id]: { ...p, defaultVolume: n } }), !canPolicy || busy)}</label>
                <label className="inline">{T.max} {pctInput(p.maxVolume, (n) => setEdit({ ...edit, [s.room_id]: { ...p, maxVolume: n } }), !canPolicy || busy)}</label>
                <label className="inline"><input type="checkbox" checked={p.enforceMax} disabled={!canPolicy || busy} onChange={(e) => setEdit({ ...edit, [s.room_id]: { ...p, enforceMax: e.target.checked } })} /> {T.enforce}</label>
                {canPolicy && edit[s.room_id] && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void savePolicy([s.room_id], p)}>{T.save}</button>}
              </td>
              <td>{caps.length ? <small>{caps.map(([k, val]) => `${tx(`cap_${k}`)}: ${val ?? "—"}`).join(" · ")}</small> : <span className="muted">—</span>}</td>
              <td>{c ? <small className={c.status === "EXECUTED" ? "credit" : ["FAILED", "TIMEOUT", "UNVERIFIED"].includes(c.status) ? "debit" : ""}>{tx(`cmd_${c.command}`)}{c.value !== null ? ` ${c.value}%` : ""}{c.cap !== null ? ` (≤${c.cap}%)` : ""} · {at(c.created_at)} → <b>{tx(`st_${c.status}`)}</b>{c.result_volume !== null ? ` · ${c.result_volume}%` : ""}{c.result_muted === 1 ? ` · ${T.muted}` : ""}{c.error ? ` · ${c.error}` : ""}</small> : <span className="muted">—</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
