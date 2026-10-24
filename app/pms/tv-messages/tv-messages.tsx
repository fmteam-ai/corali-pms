"use client";
import { useState } from "react";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";
import type { TvMessageRow } from "@/lib/tv-messages";
import type { TvMessageDuration } from "@/lib/tv-messages-core";

type Room = { id: number; code: string; guest: string | null };

// Ready-made texts (Greek / English); the hotel can edit them before sending.
const presets: { key: string; el: string; en: string }[] = [
  { key: "tvm.pBreakfast", el: "Καλημέρα! Το πρωινό σερβίρεται σήμερα έως τις 10:30.", en: "Good morning! Breakfast is served today until 10:30." },
  { key: "tvm.pParcel", el: "Υπάρχει ένα δέμα για εσάς στη ρεσεψιόν.", en: "There is a parcel for you at reception." },
  { key: "tvm.pCleaning", el: "Η καθαρίστρια θα περάσει από το δωμάτιό σας σύντομα. Αν δεν θέλετε καθαρισμό σήμερα, ενημερώστε τη ρεσεψιόν.", en: "Housekeeping will visit your room shortly. If you prefer no cleaning today, please let reception know." },
  { key: "tvm.pWater", el: "Ενημέρωση: σήμερα θα υπάρξει σύντομη διακοπή νερού από τις 11:00 έως τις 12:00. Ζητούμε συγγνώμη για την ταλαιπωρία.", en: "Please note: there will be a short water interruption today from 11:00 to 12:00. We apologise for the inconvenience." },
];

export function TvMessages({ lang, rooms, initialMessages, canSend }: { lang: PmsLang; rooms: Room[]; initialMessages: TvMessageRow[]; canSend: boolean }) {
  const t = pmsT(lang);
  const [messages, setMessages] = useState(initialMessages);
  const [el, setEl] = useState("");
  const [en, setEn] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const [duration, setDuration] = useState<TvMessageDuration>("tonight");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  const toggle = (id: number) => { setAll(false); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/tv-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setMsg(t(d.error === "NO_ROOMS" ? "tvm.noRooms" : "tvm.failed")); return false; }
      setMessages(d.messages); setMsg(done); return true;
    } finally { setBusy(false); }
  }
  async function send() {
    if (!el.trim() && !en.trim()) { setMsg(t("tvm.needText")); return; }
    if (!all && !picked.length) { setMsg(t("tvm.needRooms")); return; }
    if (await post({ action: "send", el, en, rooms: all ? "all" : picked, duration, urgent }, t("tvm.sent"))) { setEl(""); setEn(""); setPicked([]); setAll(false); setUrgent(false); }
  }

  return (
    <div className="tvAdmin">
      {canSend && (
        <div className="hubCard">
          <h2>{t("tvm.new")}</h2>
          <div className="tvmPresets">{presets.map((p) => <button type="button" className="secondaryButton" key={p.key} onClick={() => { setEl(p.el); setEn(p.en); }}>{t(p.key as Parameters<typeof t>[0])}</button>)}</div>
          <div className="tvAdminGrid">
            <label>{t("tvm.textEl")}<textarea rows={3} maxLength={500} value={el} onChange={(e) => setEl(e.target.value)} /></label>
            <label>{t("tvm.textEn")}<textarea rows={3} maxLength={500} value={en} onChange={(e) => setEn(e.target.value)} /></label>
          </div>
          <small>{t("tvm.langHelp")}</small>
          <h3>{t("tvm.rooms")}</h3>
          <div className="tvmRooms">
            <button type="button" className={all ? "active" : ""} onClick={() => { setAll(!all); setPicked([]); }}>{t("tvm.allRooms")}</button>
            <button type="button" onClick={() => { setAll(false); setPicked(rooms.filter((r) => r.guest).map((r) => r.id)); }}>{t("tvm.occupied")}</button>
            {rooms.map((r) => (
              <button type="button" key={r.id} className={all || picked.includes(r.id) ? "active" : ""} onClick={() => toggle(r.id)} title={r.guest ?? ""}>
                <b>{r.code}</b>{r.guest && <small>{r.guest}</small>}
              </button>
            ))}
          </div>
          <div className="tvAdminGrid">
            <label>{t("tvm.duration")}
              <select value={duration} onChange={(e) => setDuration(e.target.value as TvMessageDuration)}>
                <option value="1h">{t("tvm.d1h")}</option><option value="3h">{t("tvm.d3h")}</option><option value="tonight">{t("tvm.dTonight")}</option><option value="checkout">{t("tvm.dCheckout")}</option>
              </select>
            </label>
          </div>
          <div className="tvAdminChecks"><label className="inline"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> <b>{t("tvm.urgent")}</b></label></div>
          <small>{t("tvm.urgentHelp")}</small>
          <button type="button" disabled={busy} onClick={() => void send()}>{t("tvm.send")}</button>
        </div>
      )}
      <p className="notice" role="status">{msg}</p>

      <h2>{t("tvm.history")}</h2>
      {messages.length === 0 ? <p className="muted">{t("tvm.none")}</p> : (
        <div className="tableWrap"><table><thead><tr><th>{t("tvm.sentAt")}</th><th>{t("tvm.message")}</th><th>{t("tvm.roomsSeen")}</th><th /></tr></thead>
          <tbody>{messages.map((m) => {
            const live = !m.cancelledAt && m.rooms.some((r) => r.expiresAt > Date.now() && !r.seenAt);
            return (
              <tr key={m.id}>
                <td className="tvmWhen">{when(m.createdAt)}{m.createdBy && <small>{m.createdBy}</small>}</td>
                <td className="tvmText">{m.urgent && <b className="debit">{t("tvm.urgentTag")} </b>}{m.body.el ?? m.body.en}{m.body.el && m.body.en && <small>{m.body.en}</small>}</td>
                <td><div className="tvmSeen">{m.rooms.map((r) => (
                  <span key={r.roomId} className={r.seenAt ? "credit" : ""} title={r.seenAt ? `${t("tvm.seen")} ${when(r.seenAt)}` : `${t("tvm.until")} ${when(r.expiresAt)}`}>
                    {r.roomCode} {r.seenAt ? `✓ ${when(r.seenAt)}` : m.cancelledAt ? "✕" : r.expiresAt > Date.now() ? "…" : "—"}
                  </span>
                ))}</div></td>
                <td>{m.cancelledAt ? <small>{t("tvm.cancelled")}</small> : canSend && live && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "cancel", id: m.id }, t("tvm.cancelledDone"))}>{t("tvm.cancel")}</button>}</td>
              </tr>
            );
          })}</tbody></table></div>
      )}
    </div>
  );
}
