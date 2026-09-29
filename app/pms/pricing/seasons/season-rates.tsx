"use client";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { datesBetween, nightlyPrice, seasonRuleFor, weekdayOf, type SeasonRule } from "@/lib/season-rates";

type Room = { code: string; roomType: string; baseCents: number };
type Rule = SeasonRule & { id: number; name: string; room_codes: string; weekdays: string; price_cents: number; active: number };
type Target = "all" | "type" | "rooms";
type Draft = { id?: number; name: string; startsOn: string; endsOn: string; target: Target; roomType: string; roomCodes: string[]; weekdays: number[]; price: string; active: boolean };

const parse = <T,>(v: string): T[] => { try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const palette = ["#dbeef0", "#f6e3cf", "#e3e8f7", "#e7f3dc", "#f4dde6", "#efe9d2"];

export function SeasonRates({ lang, today, rooms, rules, canCreate, canEdit, canDelete }: { lang: PmsLang; today: string; rooms: Room[]; rules: Rule[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState(14);
  const [perRoom, setPerRoom] = useState(false);
  const [pick, setPick] = useState<{ row: string; start: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const locale = pmsLocale(lang);
  const euro = (c: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const types = useMemo(() => [...new Set(rooms.map((r) => r.roomType))], [rooms]);
  const dates = useMemo(() => datesBetween(from, days), [from, days]);
  const colour = (id: number) => palette[rules.findIndex((r) => r.id === id) % palette.length];
  const typeBase = (type: string) => Math.min(...rooms.filter((r) => r.roomType === type).map((r) => r.baseCents));
  const rows = types.flatMap((type) => [{ key: `t:${type}`, type, code: null as string | null, label: type, base: typeBase(type) }, ...(perRoom ? rooms.filter((r) => r.roomType === type).map((r) => ({ key: `r:${r.code}`, type, code: r.code as string | null, label: `  ${r.code}`, base: r.baseCents })) : [])]);

  const targetLabel = (r: Rule) => {
    const codes = parse<string>(r.room_codes);
    return codes.length ? t("sr.rooms", { rooms: codes.join(", ") }) : r.room_type ? t("sr.type", { type: r.room_type }) : t("sr.all");
  };
  const weekdayLabel = (v: string) => { const d = parse<number>(v); return d.length ? d.map((x) => t(`sr.wd.${x}` as PmsKey)).join(" ") : t("sr.everyDay"); };
  const error = (status: number, code?: string) => (status === 403 ? t("sr.err.FORBIDDEN") : code && [`INVALID_DATES`, `UNKNOWN_ROOM`, `INVALID_INPUT`].includes(code) ? t(`sr.err.${code}` as PmsKey) : t("sr.failed", { code: `${code ?? "ERROR"} · ${status}` }));

  function openNew(partial: Partial<Draft> = {}) {
    setDraft({ name: "", startsOn: from, endsOn: addDays(from, 6), target: "all", roomType: types[0] ?? "", roomCodes: [], weekdays: [], price: "", active: true, ...partial });
    setMsg("");
  }
  function openEdit(r: Rule) {
    const codes = parse<string>(r.room_codes);
    setDraft({ id: r.id, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on, target: codes.length ? "rooms" : r.room_type ? "type" : "all", roomType: r.room_type ?? types[0] ?? "", roomCodes: codes, weekdays: parse<number>(r.weekdays), price: String(Number(r.price_cents) / 100), active: Number(r.active) === 1 });
    setMsg("");
  }
  function cellClick(row: (typeof rows)[number], date: string) {
    if (!canCreate) return;
    if (!pick || pick.row !== row.key) { setPick({ row: row.key, start: date }); return; }
    const [a, b] = pick.start <= date ? [pick.start, date] : [date, pick.start];
    setPick(null);
    const current = nightlyPrice(rules, a, row.type, row.code, row.base);
    openNew({ startsOn: a, endsOn: b, target: row.code ? "rooms" : "type", roomType: row.type, roomCodes: row.code ? [row.code] : [], price: String(current / 100) });
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { id: draft.id, name: draft.name, startsOn: draft.startsOn, endsOn: draft.endsOn, roomType: draft.target === "type" ? draft.roomType : null, roomCodes: draft.target === "rooms" ? draft.roomCodes : [], weekdays: draft.weekdays, priceCents: Math.round(Number(draft.price) * 100), active: draft.active };
      const r = await fetch("/api/pms/season-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(error(r.status, d.error)); return; }
      setDraft(null);
      setMsg(t("sr.saved"));
      router.refresh();
    } catch { setMsg(t("sr.failed", { code: "network" })); } finally { setBusy(false); }
  }
  async function remove(r: Rule) {
    if (!confirm(t("sr.confirmDelete", { name: r.name || `${r.starts_on} – ${r.ends_on}` }))) return;
    const res = await fetch("/api/pms/season-rates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(error(res.status, d.error)); return; }
    if (draft?.id === r.id) setDraft(null);
    setMsg(t("sr.deleted"));
    router.refresh();
  }
  const priceOk = draft && draft.price.trim() !== "" && Number(draft.price) >= 0 && draft.startsOn && draft.endsOn >= draft.startsOn && (draft.target !== "rooms" || draft.roomCodes.length > 0);

  return (
    <>
      <p className="notice" role="status">{msg}</p>
      <article className="card">
        <div className="srHead">
          <h2>{t("sr.overview")}</h2>
          <div className="srNav">
            <button type="button" className="secondaryButton" onClick={() => setFrom(addDays(from, -days))}>{t("sr.prev")}</button>
            <button type="button" className="secondaryButton" onClick={() => setFrom(today)}>{t("sr.today")}</button>
            <label>{t("sr.from")} <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
            <label>{t("sr.days")} <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 14, 21, 31].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button type="button" className="secondaryButton" onClick={() => setFrom(addDays(from, days))}>{t("sr.next")}</button>
            <label className="inline"><input type="checkbox" checked={perRoom} onChange={(e) => setPerRoom(e.target.checked)} /> {t("sr.showRooms")}</label>
          </div>
        </div>
        <p className="srHelp">{t("sr.overviewHelp")}</p>
        <div className="tableWrap srGridWrap">
          <table className="srGrid">
            <thead>
              <tr><th>{t("sr.roomType")}</th>{dates.map((d) => <th key={d} className={[0, 6].includes(weekdayOf(d)) ? "weekend" : undefined}><small>{t(`sr.wd.${weekdayOf(d)}` as PmsKey)}</small>{dayLabel(d)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={row.code ? "srRoomRow" : undefined}>
                  <th scope="row">{row.code ? <span className="srRoom">{row.code}</span> : <b>{row.label}</b>}<small>{t("sr.base")} {euro(row.base)}</small></th>
                  {dates.map((d) => {
                    const rule = seasonRuleFor(rules, d, row.type, row.code) as Rule | null;
                    const price = rule ? Number(rule.price_cents) : row.base;
                    const inPick = pick?.row === row.key && pick.start === d;
                    return (
                      <td key={d} className={`${rule ? "season" : ""}${inPick ? " picked" : ""}`} style={rule ? { background: colour(rule.id) } : undefined}>
                        <button type="button" disabled={!canCreate} title={rule ? `${rule.name || targetLabel(rule)} · ${rule.starts_on} – ${rule.ends_on}` : t("sr.base")} onClick={() => cellClick(row, d)}>{euro(price)}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {draft && (
        <article className="card srEditor">
          <h2>{draft.id ? t("sr.edit") : draft.target !== "all" && draft.startsOn ? t("sr.selection", { target: draft.target === "rooms" ? draft.roomCodes.join(", ") : draft.roomType, from: dayLabel(draft.startsOn), to: dayLabel(draft.endsOn) }) : t("sr.add")}</h2>
          <div className="srFields">
            <label>{t("sr.name")}<input value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>{t("sr.from")}<input type="date" value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} /></label>
            <label>{t("sr.period")} ›<input type="date" value={draft.endsOn} min={draft.startsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} /></label>
            <label>{t("sr.price")}<input type="number" min={0} step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} autoFocus /></label>
            <label>{t("sr.appliesTo")}<select value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value as Target })}>{(["all", "type", "rooms"] as Target[]).map((x) => <option key={x} value={x}>{t(`sr.target.${x}` as PmsKey)}</option>)}</select></label>
            {draft.target === "type" && <label>{t("sr.roomType")}<select value={draft.roomType} onChange={(e) => setDraft({ ...draft, roomType: e.target.value })}>{types.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>}
          </div>
          {draft.target === "rooms" && (
            <fieldset className="srChoices"><legend>{t("sr.target.rooms")}</legend>
              {types.map((type) => (
                <Fragment key={type}>
                  <b>{type}</b>
                  {rooms.filter((r) => r.roomType === type).map((r) => (
                    <label key={r.code} className="inline"><input type="checkbox" checked={draft.roomCodes.includes(r.code)} onChange={(e) => setDraft({ ...draft, roomCodes: e.target.checked ? [...draft.roomCodes, r.code] : draft.roomCodes.filter((c) => c !== r.code) })} /> {r.code}</label>
                  ))}
                </Fragment>
              ))}
            </fieldset>
          )}
          <fieldset className="srChoices"><legend>{t("sr.weekdays")} <small>({draft.weekdays.length ? "" : t("sr.everyDay")})</small></legend>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <label key={d} className="inline"><input type="checkbox" checked={draft.weekdays.includes(d)} onChange={(e) => setDraft({ ...draft, weekdays: e.target.checked ? [...draft.weekdays, d] : draft.weekdays.filter((x) => x !== d) })} /> {t(`sr.wd.${d}` as PmsKey)}</label>)}
          </fieldset>
          <label className="inline"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> {t("sr.active")}</label>
          <div className="actions">
            <button type="button" disabled={busy || !priceOk || (draft.id ? !canEdit : !canCreate)} onClick={save}>{t("sr.save")}</button>
            <button type="button" className="secondaryButton" onClick={() => setDraft(null)}>{t("sr.cancel")}</button>
          </div>
          <small>{t("sr.priority")}</small>
        </article>
      )}

      <article className="card">
        <div className="srHead"><h2>{t("sr.list")}</h2>{canCreate && <button type="button" className="primaryAction" onClick={() => openNew()}>+ {t("sr.add")}</button>}</div>
        {rules.length === 0 ? <p>{t("sr.none")}</p> : (
          <div className="tableWrap">
            <table className="srList">
              <thead><tr><th>{t("sr.nameCol")}</th><th>{t("sr.period")}</th><th>{t("sr.appliesTo")}</th><th>{t("sr.weekdays")}</th><th>{t("sr.price")}</th><th></th><th></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={Number(r.active) === 1 ? undefined : "inactive"}>
                    <td><span className="srSwatch" style={{ background: colour(r.id) }} /> {r.name || "—"}</td>
                    <td>{dayLabel(r.starts_on)} – {dayLabel(r.ends_on)} {r.ends_on.slice(0, 4)}</td>
                    <td>{targetLabel(r)}</td>
                    <td>{weekdayLabel(r.weekdays)}</td>
                    <td><b>{euro(Number(r.price_cents))}</b></td>
                    <td><span className={`noticeStatus ${Number(r.active) === 1 ? "" : "open"}`}>{Number(r.active) === 1 ? t("sr.active") : t("sr.inactive")}</span></td>
                    <td className="srActions">
                      {canEdit && <button type="button" className="secondaryButton" onClick={() => openEdit(r)}>{t("sr.edit")}</button>}
                      {canDelete && <button type="button" className="danger" onClick={() => remove(r)}>{t("sr.delete")}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </>
  );
}
