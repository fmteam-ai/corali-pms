"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { minStayRuleFor, type MinStayRule } from "@/lib/min-stay";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Rule = MinStayRule & { id: number; min_nights: number; active: number };
type Category = { type: string; label: string; rooms: number };
type Draft = { id?: number; roomType: string; startsOn: string; endsOn: string; minNights: string; active: boolean };
const ALL = "";

export function MinStayManager({ lang, today, types, rules, canCreate, canEdit, canDelete }: { lang: PmsLang; today: string; types: Category[]; rules: Rule[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const yearRule = (type: string | null) => rules.find((r) => !r.starts_on && (r.room_type ?? null) === type);
  const [yearValues, setYearValues] = useState<Record<string, string>>(() => Object.fromEntries([ALL, ...types.map((x) => x.type)].map((k) => [k, yearRule(k || null) ? String(yearRule(k || null)!.min_nights) : ""])));
  const locale = pmsLocale(lang);
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const label = (type: string | null) => (type ? types.find((x) => x.type === type)?.label ?? type : t("ms.allRooms"));
  const error = (status: number, code?: string) => (code && ["INVALID_DATES", "UNKNOWN_TYPE", "INVALID_INPUT"].includes(code) ? t(`ms.err.${code}` as PmsKey) : t("ms.failed", { code: `${code ?? "ERROR"} · ${status}` }));

  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    try {
      const r = await fetch("/api/pms/min-stay", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(error(r.status, d.error)); return false; }
      setMsg(method === "DELETE" ? t("ms.deleted") : t("ms.saved"));
      router.refresh();
      return true;
    } catch { setMsg(t("ms.failed", { code: "network" })); return false; } finally { setBusy(false); }
  }
  // All-year value per category: empty removes the rule.
  async function saveYear(key: string) {
    const existing = yearRule(key || null);
    const value = (yearValues[key] ?? "").trim();
    if (!value) { if (existing) await send("DELETE", { id: existing.id }); return; }
    await send("POST", { id: existing?.id, roomType: key || null, startsOn: null, endsOn: null, minNights: Math.trunc(Number(value)), active: true });
  }
  async function saveDraft() {
    if (!draft) return;
    if (await send("POST", { id: draft.id, roomType: draft.roomType || null, startsOn: draft.startsOn || null, endsOn: draft.endsOn || null, minNights: Math.trunc(Number(draft.minNights)), active: draft.active })) setDraft(null);
  }
  const periods = rules.filter((r) => r.starts_on && r.ends_on);
  const canYear = canCreate || canEdit;

  return (
    <>
      <p className="notice" role="status">{msg}</p>
      <article className="card">
        <h2>{t("ms.byCategory")}</h2>
        <div className="tableWrap">
          <table className="srList msTable">
            <thead><tr><th>{t("ms.category")}</th><th>{t("ms.allYear")}</th><th>{t("ms.today")}</th></tr></thead>
            <tbody>
              {[{ type: ALL, label: t("ms.allRooms"), rooms: 0 }, ...types].map((c) => {
                const now = minStayRuleFor(rules, today, c.type || "\u0000");
                const applies = c.type ? now : rules.find((r) => !r.room_type && !r.starts_on) ?? null;
                return (
                  <tr key={c.type || "all"}>
                    <td><b>{c.label}</b>{c.type && <small> · {c.type} · {c.rooms}</small>}</td>
                    <td>
                      <span className="msYear">
                        <input type="number" min={1} max={60} placeholder="1" aria-label={`${t("ms.allYear")} ${c.label}`} value={yearValues[c.type] ?? ""} disabled={!canYear || busy} onChange={(e) => setYearValues({ ...yearValues, [c.type]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void saveYear(c.type); }} />
                        {canYear && <button type="button" disabled={busy} onClick={() => saveYear(c.type)}>{t("ms.save")}</button>}
                      </span>
                    </td>
                    <td>{applies ? <b>{t("ms.nights", { n: Number(applies.min_nights) })}</b> : "1"}{applies?.starts_on && <small> ({day(applies.starts_on)} – {day(applies.ends_on!)})</small>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card">
        <div className="srHead"><h2>{t("ms.periods")}</h2>{canCreate && <button type="button" className="primaryAction" onClick={() => { setDraft({ roomType: types[0]?.type ?? ALL, startsOn: today, endsOn: today, minNights: "3", active: true }); setMsg(""); }}>+ {t("ms.addPeriod")}</button>}</div>
        {draft && (
          <div className="srEditor msEditor">
            <div className="srFields">
              <label>{t("ms.category")}<select value={draft.roomType} onChange={(e) => setDraft({ ...draft, roomType: e.target.value })}><option value={ALL}>{t("ms.allRooms")}</option>{types.map((x) => <option key={x.type} value={x.type}>{x.label} ({x.type})</option>)}</select></label>
              <label>{t("ms.from")}<input type="date" value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} /></label>
              <label>{t("ms.to")}<input type="date" value={draft.endsOn} min={draft.startsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} /></label>
              <label>{t("ms.minNights")}<input type="number" min={1} max={60} value={draft.minNights} onChange={(e) => setDraft({ ...draft, minNights: e.target.value })} /></label>
            </div>
            <label className="inline"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> {t("ms.active")}</label>
            <div className="actions">
              <button type="button" disabled={busy || !draft.startsOn || !draft.endsOn || draft.endsOn < draft.startsOn || !(Number(draft.minNights) >= 1)} onClick={saveDraft}>{t("ms.save")}</button>
              <button type="button" className="secondaryButton" onClick={() => setDraft(null)}>{t("ms.cancel")}</button>
            </div>
          </div>
        )}
        {periods.length === 0 ? <p>{t("ms.none")}</p> : (
          <div className="tableWrap">
            <table className="srList">
              <thead><tr><th>{t("ms.category")}</th><th>{t("ms.from")}</th><th>{t("ms.to")}</th><th>{t("ms.minNights")}</th><th></th><th></th></tr></thead>
              <tbody>
                {periods.map((r) => (
                  <tr key={r.id} className={Number(r.active) === 1 ? undefined : "inactive"}>
                    <td>{label(r.room_type)}</td>
                    <td>{day(r.starts_on!)}</td>
                    <td>{day(r.ends_on!)}</td>
                    <td><b>{t("ms.nights", { n: Number(r.min_nights) })}</b></td>
                    <td><span className={`noticeStatus ${Number(r.active) === 1 ? "" : "open"}`}>{Number(r.active) === 1 ? t("ms.active") : "—"}</span></td>
                    <td className="srActions">
                      {canEdit && <button type="button" className="secondaryButton" onClick={() => { setDraft({ id: r.id, roomType: r.room_type ?? ALL, startsOn: r.starts_on!, endsOn: r.ends_on!, minNights: String(r.min_nights), active: Number(r.active) === 1 }); setMsg(""); }}>{t("ms.edit")}</button>}
                      {canDelete && <button type="button" className="danger" disabled={busy} onClick={() => confirm(t("ms.confirmDelete")) && void send("DELETE", { id: r.id })}>{t("ms.delete")}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <small>{t("ms.help")}</small>
      </article>
    </>
  );
}
