"use client";
import { useState } from "react";
import type { HkServiceRow } from "@/lib/hk-services";
import type { HkService, HkServiceSettings } from "@/lib/hk-services-core";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";

/** Today's linen & towel changes for rooms in stay, with the change schedule (every N nights) and the reminder time. */
export function HousekeepingServices({ lang, initial, canWrite }: { lang: PmsLang; initial: { settings: HkServiceSettings; rows: HkServiceRow[] }; canWrite: boolean }) {
  const t = pmsT(lang);
  const [data, setData] = useState(initial);
  const [form, setForm] = useState(initial.settings);
  const [showSettings, setShowSettings] = useState(false);
  const [onlyDue, setOnlyDue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });

  async function post(body: Record<string, unknown>, ok = "") {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/housekeeping/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setData({ settings: d.settings, rows: d.rows }); setForm(d.settings); setMsg(ok);
    } catch { setMsg(t("hks.error")); } finally { setBusy(false); }
  }

  const dueCount = data.rows.reduce((n, r) => n + r.due.filter((s) => !r.done.includes(s)).length, 0);
  const rows = onlyDue ? data.rows.filter((r) => r.due.length) : data.rows;
  const badge = (r: HkServiceRow, s: HkService) => {
    const done = r.done.includes(s);
    return (
      <span key={s} className={`hksBadge ${s}${done ? " done" : ""}`}>
        {s === "sheets" ? "🛏️" : "🛁"} {t(s === "sheets" ? "hks.sheets" : "hks.towels")}
        {canWrite && <button type="button" disabled={busy} onClick={() => post({ action: "done", bookingId: r.bookingId, service: s, done: !done })}>{done ? t("hks.undo") : t("hks.done")}</button>}
      </span>
    );
  };
  return (
    <section className="card hks">
      <div className="hksHead">
        <div><h2>🛏️ {t("hks.title")} {dueCount > 0 && <span className="hksCount">{dueCount === 1 ? t("hks.dueOne") : t("hks.dueCount").replace("{n}", String(dueCount))}</span>}</h2><small className="muted">{t("hks.subtitle")}</small></div>
        <div className="hksTools">
          <label className="inline"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> {t("hks.onlyDue")}</label>
          {canWrite && <button type="button" className="secondaryButton" onClick={() => setShowSettings((v) => !v)}>⚙️ {t("hks.settings")}</button>}
        </div>
      </div>
      {showSettings && canWrite && (
        <form className="hksSettings" onSubmit={(e) => { e.preventDefault(); void post({ action: "settings", ...form }, t("hks.saved")); }}>
          <label>{t("hks.sheetsEvery")}<input type="number" min={0} max={14} value={form.sheetsEvery} onChange={(e) => setForm({ ...form, sheetsEvery: Number(e.target.value) })} /></label>
          <label>{t("hks.towelsEvery")}<input type="number" min={0} max={14} value={form.towelsEvery} onChange={(e) => setForm({ ...form, towelsEvery: Number(e.target.value) })} /></label>
          <label>{t("hks.reminderHour")}<select value={form.reminderHour} onChange={(e) => setForm({ ...form, reminderHour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
          <button type="submit" className="primaryAction" disabled={busy}>{t("hks.save")}</button>
          <small className="muted">{t("hks.zeroHelp")}</small>
        </form>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
      {rows.length === 0 ? <p className="muted">{t("hks.none")}</p> : (
        <div className="tableWrap">
          <table>
            <thead><tr><th>{t("hks.room")}</th><th>{t("hks.guest")}</th><th>{t("hks.stay")}</th><th>{t("hks.today")}</th><th>{t("hks.next")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bookingId} className={r.due.length ? "due" : ""}>
                  <td><b>{r.roomCode}</b>{r.dnd && <span className="dndBadge">DND</span>}</td>
                  <td>{r.guestName}</td>
                  <td>{date(r.checkIn)} → {date(r.checkOut)}<small>{t("hks.night").replace("{n}", String(r.night + 1)).replace("{total}", String(r.nights))}</small></td>
                  <td>{r.due.length ? <div className="hksBadges">{r.due.map((s) => badge(r, s))}</div> : t("hks.nothing")}</td>
                  <td><small>{t("hks.sheetsShort")}: {r.nextSheets ? date(r.nextSheets) : "—"}<br />{t("hks.towelsShort")}: {r.nextTowels ? date(r.nextTowels) : "—"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
