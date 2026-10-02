"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { nightOverrides, offerStatus } from "@/lib/offers";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

export type OfferRow = {
  id: number; name: string; starts_on: string; ends_on: string; adjustment_type: string; adjustment_value: number; operation: string;
  weekdays: string; room_codes: string; rate_plan_keys: string; minimum_stay: number; promotion: number; promotion_text_json: string;
  last_minute_days: number | null; min_advance_days: number | null; checkin_in_season: number; round_integer: number; nights_overrides_json: string; combine_offers: number; combine_plan: number; combine_direct: number; combine_coupons: number; active: number;
};
type Room = { code: string; type: string; label: string };
type Plan = { key: string; name: string };
type Draft = {
  id?: number; name: string; startsOn: string; endsOn: string; weekdays: number[]; checkinInSeason: boolean;
  promotion: boolean; text: Record<string, string>; lastMinuteDays: string; minAdvanceDays: string;
  operation: "discount" | "charge"; type: "percentage" | "fixed"; value: string; roundInteger: boolean; minimumStay: string;
  overrides: { nights: string; value: string }[]; roomCodes: string[]; planKeys: string[]; combine: Record<Combo, boolean>; active: boolean;
};
type Combo = "offers" | "plan" | "direct" | "coupons";
const combos: Combo[] = ["offers", "plan", "direct", "coupons"];
const allCombine: Record<Combo, boolean> = { offers: true, plan: true, direct: true, coupons: true };

const textLangs = ["el", "en", "fr", "de", "it", "es"] as const;
const parse = <T,>(v: string): T[] => { try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
const parseObj = (v: string): Record<string, string> => { try { const x = JSON.parse(v || "{}"); return x && typeof x === "object" && !Array.isArray(x) ? x : {}; } catch { return {}; } };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const toMoney = (type: string, v: number) => String(type === "fixed" ? v / 100 : v);
const fromMoney = (type: string, v: string) => (type === "fixed" ? Math.round(Number(v) * 100) : Math.round(Number(v)));

export function OffersManager({ lang, today, preset, rooms, plans, offers, canCreate, canEdit, canDelete }: { lang: PmsLang; today: string; preset: { from: string | null; to: string | null } | null; rooms: Room[]; plans: Plan[]; offers: OfferRow[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const locale = pmsLocale(lang);
  const blank = (partial: Partial<Draft> = {}): Draft => ({ name: "", startsOn: today, endsOn: addDays(today, 30), weekdays: [], checkinInSeason: false, promotion: false, text: {}, lastMinuteDays: "", minAdvanceDays: "", operation: "discount", type: "percentage", value: "10", roundInteger: false, minimumStay: "1", overrides: [], roomCodes: [], planKeys: [], combine: allCombine, active: true, ...partial });
  const [draft, setDraft] = useState<Draft | null>(() => (preset && canCreate ? blank({ name: t("of.preset.lowName"), promotion: true, startsOn: preset.from ?? today, endsOn: preset.to ?? addDays(today, 14), value: "15" }) : null));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"current" | "all">("current");
  const types = [...new Map(rooms.map((r) => [r.type, r.label])).entries()];
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const euro = (c: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  const amount = (type: string, value: number) => (type === "fixed" ? `${euro(value)} ${t("of.perNight")}` : `${value}%`);
  const error = (status: number, code?: string) => (status === 403 ? t("sr.err.FORBIDDEN") : code && ["INVALID_DATES", "INVALID_PERCENT", "INVALID_WINDOW", "INVALID_INPUT"].includes(code) ? t(`of.err.${code}` as PmsKey) : t("of.failed", { code: `${code ?? "ERROR"} · ${status}` }));

  function presetDraft(kind: "lastMinute" | "early" | "long") {
    setMsg("");
    if (kind === "lastMinute") setDraft(blank({ name: t("of.preset.lastMinuteName"), promotion: true, lastMinuteDays: "7", value: "15" }));
    if (kind === "early") setDraft(blank({ name: t("of.preset.earlyName"), promotion: true, minAdvanceDays: "60", value: "10", endsOn: addDays(today, 365) }));
    if (kind === "long") setDraft(blank({ name: t("of.preset.longName"), promotion: true, minimumStay: "7", value: "10", overrides: [{ nights: "14", value: "15" }], endsOn: addDays(today, 365) }));
  }
  function edit(o: OfferRow, copy = false) {
    setMsg("");
    setDraft({
      id: copy ? undefined : o.id, name: copy ? `${o.name} (2)` : o.name, startsOn: o.starts_on, endsOn: o.ends_on, weekdays: parse<number>(o.weekdays).map(Number), checkinInSeason: o.checkin_in_season === 1,
      promotion: o.promotion === 1, text: parseObj(o.promotion_text_json), lastMinuteDays: o.last_minute_days ? String(o.last_minute_days) : "", minAdvanceDays: o.min_advance_days ? String(o.min_advance_days) : "",
      operation: o.operation === "charge" ? "charge" : "discount", type: o.adjustment_type === "fixed" ? "fixed" : "percentage", value: toMoney(o.adjustment_type, o.adjustment_value), roundInteger: o.round_integer === 1, minimumStay: String(o.minimum_stay || 1),
      overrides: nightOverrides(o.nights_overrides_json).map((x) => ({ nights: String(x.nights), value: toMoney(o.adjustment_type, x.value) })), roomCodes: parse<string>(o.room_codes).map(String), planKeys: parse<string>(o.rate_plan_keys).map(String), combine: { offers: o.combine_offers !== 0, plan: o.combine_plan !== 0, direct: o.combine_direct !== 0, coupons: o.combine_coupons !== 0 }, active: o.active === 1,
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    try {
      const r = await fetch("/api/pms/offers", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(error(r.status, d.error)); return false; }
      setMsg(method === "DELETE" ? t("of.deleted") : t("of.saved"));
      router.refresh();
      return true;
    } catch { setMsg(t("of.failed", { code: "network" })); return false; } finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    const body = {
      id: draft.id, name: draft.name, startsOn: draft.startsOn, endsOn: draft.endsOn, operation: draft.operation, adjustmentType: draft.type, adjustmentValue: fromMoney(draft.type, draft.value),
      weekdays: draft.weekdays, roomCodes: draft.roomCodes, ratePlanKeys: draft.planKeys, minimumStay: Math.max(1, Math.trunc(Number(draft.minimumStay) || 1)),
      promotion: draft.promotion, promotionText: draft.promotion ? draft.text : {}, lastMinuteDays: draft.promotion && Number(draft.lastMinuteDays) > 0 ? Math.trunc(Number(draft.lastMinuteDays)) : null,
      minAdvanceDays: draft.promotion && Number(draft.minAdvanceDays) > 0 ? Math.trunc(Number(draft.minAdvanceDays)) : null, checkinInSeason: draft.checkinInSeason, roundInteger: draft.roundInteger,
      nightsOverrides: draft.overrides.filter((o) => Number(o.nights) >= 2 && o.value !== "").map((o) => ({ nights: Math.trunc(Number(o.nights)), value: fromMoney(draft.type, o.value) })), combineOffers: draft.combine.offers, combinePlan: draft.combine.plan, combineDirect: draft.combine.direct, combineCoupons: draft.combine.coupons, active: draft.active,
    };
    if (await send("POST", body)) setDraft(null);
  }
  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((x) => x !== value));
  const typeRooms = (type: string) => rooms.filter((r) => r.type === type).map((r) => r.code);

  function summary(o: OfferRow) {
    const parts: string[] = [];
    if (o.minimum_stay > 1) parts.push(t("of.sum.minStay", { n: o.minimum_stay }));
    if (o.last_minute_days) parts.push(t("of.sum.lastMinute", { n: o.last_minute_days }));
    if (o.min_advance_days) parts.push(t("of.sum.early", { n: o.min_advance_days }));
    if (o.checkin_in_season === 1) parts.push(t("of.sum.checkin"));
    const wd = parse<number>(o.weekdays);
    if (wd.length) parts.push(wd.map((d) => t(`sr.wd.${d}` as PmsKey)).join(" "));
    const excluded = combos.filter((c) => Number(o[`combine_${c}` as keyof OfferRow]) === 0);
    if (o.operation === "discount" && excluded.length) parts.push(t("of.sum.noCombine", { list: excluded.map((c) => t(`of.cmb.short.${c}` as PmsKey)).join(", ") }));
    for (const x of nightOverrides(o.nights_overrides_json)) parts.push(t("of.sum.override", { n: x.nights, value: amount(o.adjustment_type, x.value) }));
    return parts.join(" · ");
  }
  const target = (o: OfferRow) => {
    const codes = parse<string>(o.room_codes), keys = parse<string>(o.rate_plan_keys);
    const roomPart = codes.length ? codes.join(", ") : t("of.allRooms");
    const planPart = keys.length ? keys.map((k) => plans.find((p) => p.key === k)?.name ?? k).join(", ") : t("of.allPlans");
    return `${roomPart} · ${planPart}`;
  };
  const shown = offers.filter((o) => filter === "all" || offerStatus(o, today) === "running" || offerStatus(o, today) === "upcoming");
  const valid = draft && draft.name.trim().length >= 2 && draft.startsOn && draft.endsOn && draft.endsOn >= draft.startsOn && Number(draft.value) >= 0 && draft.value !== "";

  return (
    <>
      <p className="notice" role="status">{msg}</p>
      {canCreate && !draft && (
        <article className="card offerStart">
          <div className="srHead"><h2>{t("of.create")}</h2><button type="button" className="primaryAction" onClick={() => { setDraft(blank()); setMsg(""); }}>+ {t("of.new")}</button></div>
          <p className="srHelp">{t("of.presetsHelp")}</p>
          <div className="offerPresets">
            <button type="button" onClick={() => presetDraft("lastMinute")}><b>⏱️ {t("of.preset.lastMinute")}</b><small>{t("of.preset.lastMinuteHint")}</small></button>
            <button type="button" onClick={() => presetDraft("early")}><b>📅 {t("of.preset.early")}</b><small>{t("of.preset.earlyHint")}</small></button>
            <button type="button" onClick={() => presetDraft("long")}><b>🌙 {t("of.preset.long")}</b><small>{t("of.preset.longHint")}</small></button>
          </div>
        </article>
      )}

      {draft && (
        <article className="card srEditor offerEditor">
          <div className="srHead"><h2>{draft.id ? t("of.editTitle") : t("of.newTitle")}</h2></div>
          <div className="offerSections">
            <section>
              <h3>1 · {t("of.sec.period")}</h3>
              <div className="srFields">
                <label>{t("of.name")}<input value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("of.namePh")} /></label>
                <label>{t("of.from")}<input type="date" value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} /></label>
                <label>{t("of.to")}<input type="date" value={draft.endsOn} min={draft.startsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} /></label>
              </div>
              <fieldset className="srChoices"><legend>{t("sr.weekdays")} <small>({draft.weekdays.length ? "" : t("sr.everyDay")})</small></legend>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <label key={d} className="inline"><input type="checkbox" checked={draft.weekdays.includes(d)} onChange={(e) => setDraft({ ...draft, weekdays: toggle(draft.weekdays, d, e.target.checked) })} /> {t(`sr.wd.${d}` as PmsKey)}</label>)}
              </fieldset>
              <label className="inline offerCheck"><input type="checkbox" checked={draft.checkinInSeason} onChange={(e) => setDraft({ ...draft, checkinInSeason: e.target.checked })} /> <span>{t("of.checkinInSeason")}<small>{t("of.checkinInSeasonHint")}</small></span></label>
            </section>

            <section>
              <h3>2 · {t("of.sec.price")}</h3>
              <div className="srFields">
                <label>{t("of.operation")}<select value={draft.operation} onChange={(e) => setDraft({ ...draft, operation: e.target.value as Draft["operation"], promotion: e.target.value === "charge" ? false : draft.promotion })}><option value="discount">{t("of.discount")}</option><option value="charge">{t("of.charge")}</option></select></label>
                <label>{t("of.type")}<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}><option value="percentage">{t("of.percent")}</option><option value="fixed">{t("of.fixed")}</option></select></label>
                <label>{t("of.value")}<input type="number" min={0} max={draft.type === "percentage" && draft.operation === "discount" ? 100 : undefined} step={draft.type === "fixed" ? "0.01" : "1"} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></label>
                <label>{t("of.minStay")}<input type="number" min={1} max={365} value={draft.minimumStay} onChange={(e) => setDraft({ ...draft, minimumStay: e.target.value })} /></label>
              </div>
              <label className="inline offerCheck"><input type="checkbox" checked={draft.roundInteger} onChange={(e) => setDraft({ ...draft, roundInteger: e.target.checked })} /> <span>{t("of.round")}<small>{t("of.roundHint")}</small></span></label>
              <div className="offerOverrides">
                <b>{t("of.overrides")}</b><small>{t("of.overridesHint")}</small>
                {draft.overrides.map((o, i) => (
                  <div key={i} className="offerOverride">
                    <label>{t("of.fromNights")}<input type="number" min={2} max={365} value={o.nights} onChange={(e) => setDraft({ ...draft, overrides: draft.overrides.map((x, j) => (j === i ? { ...x, nights: e.target.value } : x)) })} /></label>
                    <label>{t("of.value")} ({draft.type === "fixed" ? "€" : "%"})<input type="number" min={0} step={draft.type === "fixed" ? "0.01" : "1"} value={o.value} onChange={(e) => setDraft({ ...draft, overrides: draft.overrides.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} /></label>
                    <button type="button" className="danger" aria-label={t("of.remove")} onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                {draft.overrides.length < 10 && <button type="button" className="secondaryButton" onClick={() => setDraft({ ...draft, overrides: [...draft.overrides, { nights: String(Math.max(2, Number(draft.minimumStay) + 3)), value: draft.value }] })}>+ {t("of.addOverride")}</button>}
              </div>
            </section>

            <section>
              <h3>3 · {t("of.sec.promotion")}</h3>
              <label className="inline offerCheck offerToggle"><input type="checkbox" disabled={draft.operation === "charge"} checked={draft.promotion} onChange={(e) => setDraft({ ...draft, promotion: e.target.checked })} /> <span><b>{t("of.promotion")}</b><small>{t("of.promotionHint")}</small></span></label>
              {draft.promotion && (
                <>
                  <div className="srFields">
                    <label>{t("of.lastMinuteDays")}<input type="number" min={1} max={730} placeholder="—" value={draft.lastMinuteDays} onChange={(e) => setDraft({ ...draft, lastMinuteDays: e.target.value })} /><small>{t("of.lastMinuteHint")}</small></label>
                    <label>{t("of.minAdvanceDays")}<input type="number" min={1} max={730} placeholder="—" value={draft.minAdvanceDays} onChange={(e) => setDraft({ ...draft, minAdvanceDays: e.target.value })} /><small>{t("of.minAdvanceHint")}</small></label>
                  </div>
                  <div className="offerTexts">
                    <b>{t("of.promoText")}</b><small>{t("of.promoTextHint")}</small>
                    {textLangs.map((l) => (
                      <label key={l}><span className="offerLang">{l.toUpperCase()}</span><textarea rows={2} maxLength={600} value={draft.text[l] ?? ""} placeholder={l === "el" ? "π.χ. Κλείστε τώρα και κερδίστε 15%!" : l === "en" ? "e.g. Book now and save 15%!" : ""} onChange={(e) => setDraft({ ...draft, text: { ...draft.text, [l]: e.target.value } })} /></label>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section>
              <h3>4 · {t("of.sec.rooms")}</h3>
              <p className="srHelp">{t("of.roomsHint")}</p>
              <div className="offerRooms">
                {types.map(([type, label]) => {
                  const codes = typeRooms(type), all = codes.every((c) => draft.roomCodes.includes(c));
                  return (
                    <fieldset key={type} className="srChoices">
                      <legend><label className="inline"><input type="checkbox" checked={all} onChange={(e) => setDraft({ ...draft, roomCodes: e.target.checked ? [...new Set([...draft.roomCodes, ...codes])] : draft.roomCodes.filter((c) => !codes.includes(c)) })} /> <b>{label}</b></label></legend>
                      {codes.map((c) => <label key={c} className="inline"><input type="checkbox" checked={draft.roomCodes.includes(c)} onChange={(e) => setDraft({ ...draft, roomCodes: toggle(draft.roomCodes, c, e.target.checked) })} /> {c}</label>)}
                    </fieldset>
                  );
                })}
              </div>
              <fieldset className="srChoices"><legend>{t("of.plans")} <small>({draft.planKeys.length ? "" : t("of.allPlans")})</small></legend>
                {plans.map((p) => <label key={p.key} className="inline"><input type="checkbox" checked={draft.planKeys.includes(p.key)} onChange={(e) => setDraft({ ...draft, planKeys: toggle(draft.planKeys, p.key, e.target.checked) })} /> {p.name}</label>)}
              </fieldset>
            </section>
            {draft.operation === "discount" && (
              <section>
                <h3>5 · {t("of.sec.combine")}</h3>
                <p className="srHelp">{t("of.combineHelp")}</p>
                {combos.map((c) => (
                  <label key={c} className="inline offerCheck"><input type="checkbox" checked={draft.combine[c]} onChange={(e) => setDraft({ ...draft, combine: { ...draft.combine, [c]: e.target.checked } })} /> <span>{t(`of.cmb.${c}` as PmsKey)}<small>{t(`of.cmb.${c}Hint` as PmsKey)}</small></span></label>
                ))}
              </section>
            )}
          </div>
          <label className="inline offerCheck"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> <b>{t("of.active")}</b></label>
          <div className="actions">
            <button type="button" disabled={busy || !valid || (draft.id ? !canEdit : !canCreate)} onClick={save}>{t("of.save")}</button>
            <button type="button" className="secondaryButton" onClick={() => setDraft(null)}>{t("of.cancel")}</button>
          </div>
        </article>
      )}

      <article className="card">
        <div className="srHead">
          <h2>{t("of.list")}</h2>
          <div className="srNav" role="group">
            <label className="inline"><input type="radio" name="offerFilter" checked={filter === "current"} onChange={() => setFilter("current")} /> {t("of.filterCurrent")}</label>
            <label className="inline"><input type="radio" name="offerFilter" checked={filter === "all"} onChange={() => setFilter("all")} /> {t("of.filterAll")}</label>
          </div>
        </div>
        {shown.length === 0 ? <p>{t("of.none")}</p> : (
          <div className="tableWrap">
            <table className="srList offerList">
              <thead><tr><th>{t("of.name")}</th><th>{t("of.period")}</th><th>{t("of.value")}</th><th>{t("of.appliesTo")}</th><th>{t("of.status")}</th><th></th></tr></thead>
              <tbody>
                {shown.map((o) => {
                  const status = offerStatus(o, today);
                  const text = parseObj(o.promotion_text_json)[lang] || parseObj(o.promotion_text_json).en || "";
                  return (
                    <tr key={o.id} className={status === "inactive" || status === "ended" ? "inactive" : undefined}>
                      <td><b>{o.name}</b>{o.promotion === 1 && <span className="promoTag">🏷️ {t("of.promotionTag")}</span>}{text && <small className="offerText">“{text}”</small>}{summary(o) && <small>{summary(o)}</small>}</td>
                      <td>{day(o.starts_on)} – {day(o.ends_on)}</td>
                      <td><b className={o.operation === "discount" ? "offerMinus" : "offerPlus"}>{o.operation === "discount" ? "−" : "+"}{amount(o.adjustment_type, o.adjustment_value)}</b>{o.round_integer === 1 && <small>{t("of.rounded")}</small>}</td>
                      <td><small>{target(o)}</small></td>
                      <td><span className={`offerStatus ${status}`}>{t(`of.st.${status}` as PmsKey)}</span></td>
                      <td className="srActions">
                        {canEdit && <button type="button" className="secondaryButton" onClick={() => edit(o)}>{t("of.edit")}</button>}
                        {canCreate && <button type="button" className="secondaryButton" onClick={() => edit(o, true)}>{t("of.copy")}</button>}
                        {canDelete && <button type="button" className="danger" disabled={busy} onClick={() => confirm(t("of.confirmDelete", { name: o.name })) && void send("DELETE", { id: o.id })}>{t("of.delete")}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <small>{t("of.help")}</small>
      </article>
    </>
  );
}
