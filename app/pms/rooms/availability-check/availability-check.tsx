"use client";
import { useState } from "react";
import type { Reason, RoomExplanation } from "@/lib/availability-explain";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function AvailabilityCheck({ lang, today }: { lang: PmsLang; today: string }) {
  const t = pmsT(lang);
  const [form, setForm] = useState({ checkIn: today, checkOut: addDays(today, 3), adults: 2, children: 0, rooms: 1 });
  const [rows, setRows] = useState<RoomExplanation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(pmsLocale(lang), { day: "numeric", month: "short", timeZone: "UTC" });
  const reasonText = (r: Reason) => {
    switch (r.code) {
      case "capacity": return t("ax.r.capacity", { c: r.capacity, n: r.needed });
      case "booked": return t("ax.r.booked", { ref: r.reference, from: day(r.checkIn), to: day(r.checkOut) });
      case "min_stay": return t("ax.r.min_stay", { n: r.nights });
      case "closed": return t("ax.r.closed", { detail: r.detail });
      case "restriction": return t("ax.r.restriction", { name: r.name });
      case "not_enough": return t("ax.r.not_enough", { f: r.free, r: r.requested });
      default: return t(`ax.r.${r.code}`);
    }
  };
  async function check() {
    setBusy(true); setMsg("");
    try {
      const q = new URLSearchParams({ checkIn: form.checkIn, checkOut: form.checkOut, adults: String(form.adults), children: String(form.children), rooms: String(form.rooms), lang });
      const r = await fetch(`/api/pms/availability-explain?${q}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? String(r.status)); return; }
      setRows(d.rooms);
    } finally { setBusy(false); }
  }
  // Rooms of different categories grouped into one booking-engine card (same room type).
  const merged = rows ? [...new Set(rows.filter((r) => r.category && r.category !== r.card).map((r) => `${r.code} (${r.category} → ${r.card})`))] : [];
  const n = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(Number(v)) || min));
  return (
    <>
      <article className="card">
        <div className="srFields">
          <label>Check-in / Άφιξη<input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value, checkOut: form.checkOut <= e.target.value ? addDays(e.target.value, 1) : form.checkOut })} /></label>
          <label>Check-out / Αναχώρηση<input type="date" value={form.checkOut} min={addDays(form.checkIn, 1)} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></label>
          <label>Adults / Ενήλικες<input type="number" min={1} max={20} value={form.adults} onChange={(e) => setForm({ ...form, adults: n(e.target.value, 1, 20) })} /></label>
          <label>Children / Παιδιά<input type="number" min={0} max={10} value={form.children} onChange={(e) => setForm({ ...form, children: n(e.target.value, 0, 10) })} /></label>
          <label>Rooms / Δωμάτια<input type="number" min={1} max={10} value={form.rooms} onChange={(e) => setForm({ ...form, rooms: n(e.target.value, 1, 10) })} /></label>
        </div>
        <div className="actions"><button type="button" disabled={busy || form.checkOut <= form.checkIn} onClick={check}>🔎 {t("ax.check")}</button></div>
        {msg && <p className="error">{msg}</p>}
      </article>
      {rows && (
        <article className="card">
          <p><b>{t("ax.summary", { a: rows.filter((r) => r.offered).length, t: rows.length })}</b></p>
          {merged.length > 0 && <p className="notice warn">⚠️ {t("ax.merged", { list: merged.join(", ") })}</p>}
          <div className="tableWrap">
            <table className="srList axTable">
              <thead><tr><th>#</th><th>{t("sr.roomType")}</th><th>{t("ax.category")}</th><th>{t("ax.card")}</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.offered ? "axOk" : "axNo"}>
                    <td><b>{r.code}</b></td>
                    <td>{r.roomType}</td>
                    <td className={r.category !== r.card ? "axDiff" : undefined}>{r.category || <i>{t("ax.noCategory")}</i>}</td>
                    <td>{r.card}</td>
                    <td>{r.offered ? <span className="axBadge ok">✅ {t("ax.offered")}</span> : <><span className="axBadge no">⛔ {t("ax.notOffered")}</span><ul>{r.reasons.map((x, i) => <li key={i}>{reasonText(x)}</li>)}</ul></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t("ax.cards")}</h3>
          <p className="srHelp">{t("ax.cardsHelp")}</p>
          <ul className="axCards">
            {[...new Set(rows.map((r) => r.roomType))].map((type) => {
              const group = rows.filter((r) => r.roomType === type);
              return <li key={type}><b>{group[0].card}</b> <small>({t("sr.roomType")}: {type})</small> — {group.map((r) => <span key={r.id} className={r.offered ? "ok" : "no"}>{r.code}</span>)}</li>;
            })}
          </ul>
        </article>
      )}
    </>
  );
}
