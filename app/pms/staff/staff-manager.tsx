"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { addDaysIso, shiftMinutes, staffModules, weekDays, type StaffModule } from "@/lib/staff-core";
import type { Shift, Specialty, StaffPerson } from "@/lib/staff";

type State = { monday: string; people: StaffPerson[]; specialties: Specialty[]; shifts: Shift[] };
type Edit = { id?: number; userId: number; date: string; start: string; end: string; specialtyId: number | null; note: string };
type TeamEdit = { id?: number; name: string; color: string; modules: StaffModule[]; members: number[] };
const presets = [["07:00", "15:00"], ["15:00", "23:00"], ["23:00", "07:00"], ["09:00", "17:00"]] as const;
const palette = ["#2a7d8f", "#c47a1c", "#8a4fb3", "#2e7d4f", "#b3261e", "#3d5afe", "#6d4c41", "#00838f"];

export function StaffManager({ lang }: { lang: PmsLang }) {
  const t = useMemo(() => pmsT(lang), [lang]);
  const [view, setView] = useState<"shifts" | "teams">("shifts");
  const [state, setState] = useState<State | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [team, setTeam] = useState<number | "">("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [teamEdit, setTeamEdit] = useState<TeamEdit | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (w: string | null) => {
    const d = await (await fetch(`/api/pms/staff${w ? `?week=${w}` : ""}`, { cache: "no-store" })).json();
    if (d.ok) setState(d);
  }, []);
  useEffect(() => { queueMicrotask(() => void load(week)); }, [load, week]);

  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `staff.err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("users.saveFailed")); return false; }
      setState(d); setMsg(typeof d.copied === "number" ? t("staff.copied", { n: d.copied }) : ok);
      return true;
    } finally { setBusy(false); }
  }

  if (!state) return <p className="muted">…</p>;
  const days = weekDays(state.monday);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
  const spec = (id: number | null) => state.specialties.find((s) => s.id === id);
  const people = team === "" ? state.people : state.people.filter((p) => p.specialties.includes(team));
  const dayHead = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
  const hours = (userId: number) => state.shifts.filter((s) => s.userId === userId).reduce((a, s) => a + shiftMinutes(s.start, s.end), 0) / 60;
  const roleName = (r: string) => t(`role.${r}` as PmsKey);

  return (
    <div className="staffMgr">
      <div className="segmented" role="group">
        <button type="button" aria-pressed={view === "shifts"} onClick={() => setView("shifts")}>📅 {t("staff.shifts")}</button>
        <button type="button" aria-pressed={view === "teams"} onClick={() => setView("teams")}>🏷️ {t("staff.teams")}</button>
      </div>
      <p className="notice" role="status">{msg}</p>

      {view === "shifts" ? (
        <section className="card">
          <div className="staffWeekBar">
            <button type="button" className="secondaryButton" onClick={() => setWeek(addDaysIso(state.monday, -7))}>◀</button>
            <b>{dayHead(days[0])} – {dayHead(days[6])}</b>
            <button type="button" className="secondaryButton" onClick={() => setWeek(addDaysIso(state.monday, 7))}>▶</button>
            <button type="button" className="secondaryButton" onClick={() => setWeek(null)}>{t("staff.thisWeek")}</button>
            <select value={team} onChange={(e) => setTeam(e.target.value ? Number(e.target.value) : "")} aria-label={t("staff.teams")}><option value="">{t("staff.allTeams")}</option>{state.specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => confirm(t("staff.copyConfirm")) && void post({ action: "copyWeek", from: addDaysIso(state.monday, -7), to: state.monday }, "")}>⧉ {t("staff.copyPrev")}</button>
          </div>
          <div className="staffGridWrap">
            <table className="staffGrid">
              <thead><tr><th>{t("staff.person")}</th>{days.map((d) => <th key={d} className={d === today ? "today" : ""}>{dayHead(d)}</th>)}<th>{t("staff.hours")}</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <th><b>{p.name}</b><small>{roleName(p.role)}</small><span className="staffDots">{p.specialties.map((id) => spec(id)).filter(Boolean).map((s) => <i key={s!.id} title={s!.name} style={{ background: s!.color }} />)}</span></th>
                    {days.map((d) => (
                      <td key={d} className={d === today ? "today" : ""}>
                        {state.shifts.filter((s) => s.userId === p.id && s.date === d).map((s) => (
                          <button type="button" key={s.id} className="shiftChip" style={{ background: spec(s.specialtyId)?.color ?? "#5f6b6e" }} title={s.note} onClick={() => setEdit({ id: s.id, userId: s.userId, date: s.date, start: s.start, end: s.end, specialtyId: s.specialtyId, note: s.note })}>{s.start}–{s.end}{s.note ? " ✎" : ""}</button>
                        ))}
                        <button type="button" className="shiftAdd" aria-label={t("staff.addShift")} onClick={() => setEdit({ userId: p.id, date: d, start: "07:00", end: "15:00", specialtyId: p.specialties[0] ?? null, note: "" })}>+</button>
                      </td>
                    ))}
                    <td className="staffHours">{hours(p.id).toLocaleString(lang === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="muted">{t("staff.shiftsHelp")}</small>
        </section>
      ) : (
        <section className="card">
          <p className="muted">{t("staff.teamsHelp")}</p>
          <div className="staffTeams">
            {state.specialties.map((s) => (
              <article key={s.id} className="staffTeam" style={{ borderTopColor: s.color }}>
                <h3><i style={{ background: s.color }} />{s.name}</h3>
                <p className="muted">{s.modules.length ? s.modules.map((m) => t(`staff.module.${m}` as PmsKey)).join(" · ") : t("staff.noModules")}</p>
                <p>{s.members.map((id) => state.people.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || t("staff.noMembers")}</p>
                <button type="button" className="secondaryButton" onClick={() => setTeamEdit({ id: s.id, name: s.name, color: s.color, modules: s.modules, members: s.members })}>{t("staff.edit")}</button>
              </article>
            ))}
            <button type="button" className="staffTeamAdd" onClick={() => setTeamEdit({ name: "", color: palette[state.specialties.length % palette.length], modules: [], members: [] })}>+ {t("staff.newTeam")}</button>
          </div>
        </section>
      )}

      {edit && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard staffModal">
            <h2>{edit.id ? t("staff.editShift") : t("staff.addShift")} · {state.people.find((p) => p.id === edit.userId)?.name}</h2>
            <div className="staffPresets">{presets.map(([a, b]) => <button type="button" key={a} className={edit.start === a && edit.end === b ? "on" : ""} onClick={() => setEdit({ ...edit, start: a, end: b })}>{a}–{b}</button>)}</div>
            <div className="formGrid">
              <label>{t("staff.date")}<input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></label>
              <label>{t("staff.start")}<input type="time" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} /></label>
              <label>{t("staff.end")}<input type="time" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} /></label>
              <label>{t("staff.team")}<select value={edit.specialtyId ?? ""} onChange={(e) => setEdit({ ...edit, specialtyId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{state.specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="staffWide">{t("staff.note")}<input value={edit.note} maxLength={120} placeholder={t("staff.notePh")} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
            </div>
            {edit.end < edit.start && <small className="muted">{t("staff.overnight")}</small>}
            <div className="modalActions">
              {edit.id && <button type="button" className="secondaryButton staffDanger" disabled={busy} onClick={() => confirm(t("staff.deleteShiftConfirm")) && void post({ action: "deleteShift", id: edit.id }, t("staff.deleted")).then((ok) => ok && setEdit(null))}>{t("staff.delete")}</button>}
              <button type="button" className="secondaryButton" onClick={() => setEdit(null)}>{t("hkb.cancel")}</button>
              <button type="button" className="primaryAction" disabled={busy || edit.start === edit.end} onClick={() => void post({ action: "shift", ...edit }, t("staff.saved")).then((ok) => ok && setEdit(null))}>{t("staff.save")}</button>
            </div>
            <small className="muted">{t("staff.pushNote")}</small>
          </div>
        </div>
      )}

      {teamEdit && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard staffModal">
            <h2>{teamEdit.id ? t("staff.edit") : t("staff.newTeam")}</h2>
            <div className="formGrid">
              <label>{t("staff.teamName")}<input value={teamEdit.name} maxLength={40} placeholder={t("staff.teamNamePh")} onChange={(e) => setTeamEdit({ ...teamEdit, name: e.target.value })} /></label>
              <label>{t("staff.color")}<span className="staffColors">{palette.map((c) => <button type="button" key={c} aria-label={c} className={teamEdit.color === c ? "on" : ""} style={{ background: c }} onClick={() => setTeamEdit({ ...teamEdit, color: c })} />)}</span></label>
            </div>
            <fieldset className="staffChecks"><legend>{t("staff.sections")}</legend>
              {staffModules.map((m) => <label key={m} className="inline"><input type="checkbox" checked={teamEdit.modules.includes(m)} onChange={() => setTeamEdit({ ...teamEdit, modules: teamEdit.modules.includes(m) ? teamEdit.modules.filter((x) => x !== m) : [...teamEdit.modules, m] })} /> {t(`staff.module.${m}` as PmsKey)}</label>)}
              <small className="muted">{t("staff.sectionsHelp")}</small>
            </fieldset>
            <fieldset className="staffChecks"><legend>{t("staff.members")}</legend>
              {state.people.map((p) => <label key={p.id} className="inline"><input type="checkbox" checked={teamEdit.members.includes(p.id)} onChange={() => setTeamEdit({ ...teamEdit, members: teamEdit.members.includes(p.id) ? teamEdit.members.filter((x) => x !== p.id) : [...teamEdit.members, p.id] })} /> {p.name} <small className="muted">({roleName(p.role)})</small></label>)}
            </fieldset>
            <div className="modalActions">
              {teamEdit.id && <button type="button" className="secondaryButton staffDanger" disabled={busy} onClick={() => confirm(t("staff.deleteTeamConfirm")) && void post({ action: "deleteSpecialty", id: teamEdit.id }, t("staff.deleted")).then((ok) => ok && setTeamEdit(null))}>{t("staff.delete")}</button>}
              <button type="button" className="secondaryButton" onClick={() => setTeamEdit(null)}>{t("hkb.cancel")}</button>
              <button type="button" className="primaryAction" disabled={busy || teamEdit.name.trim().length < 2} onClick={() => void post({ action: "specialty", ...teamEdit, name: teamEdit.name.trim() }, t("staff.saved")).then((ok) => ok && setTeamEdit(null))}>{t("staff.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
