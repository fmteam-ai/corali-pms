"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { couponCodeFrom, couponStatus, parseDateRanges } from "@/lib/direct-pricing";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

export type CouponRow = {
  id: number; code: string; name: string; discount_type: string; discount_value: number; valid_from: string; valid_to: string; stay_from: string | null; stay_to: string | null;
  blackout_json: string; max_uses: number | null; usage_count: number; pending_uses: number; revenue_cents: number | null; combinable: number; restricted_email: string | null; active: number; purpose: string;
};
type Draft = {
  id?: number; code: string; name: string; type: "percentage" | "fixed"; value: string; validFrom: string; validTo: string; stayFrom: string; stayTo: string;
  blackout: { from: string; to: string }[]; maxUses: string; combinable: boolean; email: string; active: boolean;
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fullDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export function CouponsManager({ lang, today, coupons, canCreate, canEdit, canDelete }: { lang: PmsLang; today: string; coupons: CouponRow[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const locale = pmsLocale(lang);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"general" | "birthday">("general");
  const [search, setSearch] = useState("");
  const day = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : d ?? "");
  const euro = (c: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  const amount = (c: Pick<CouponRow, "discount_type" | "discount_value">) => (c.discount_type === "fixed" ? euro(c.discount_value) : `${c.discount_value}%`);
  const error = (status: number, code?: string) => (status === 403 ? t("sr.err.FORBIDDEN") : code && ["INVALID_DATES", "INVALID_PERCENT", "INVALID_CODE", "INVALID_INPUT", "DUPLICATE_CODE"].includes(code) ? t(`cp.err.${code}` as PmsKey) : t("cp.failed", { code: `${code ?? "ERROR"} · ${status}` }));

  function generate(prefix: string) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return couponCodeFrom(prefix, bytes);
  }
  function openNew() {
    setMsg("");
    setDraft({ code: generate(""), name: "", type: "percentage", value: "10", validFrom: today, validTo: addDays(today, 90), stayFrom: "", stayTo: "", blackout: [], maxUses: "", combinable: false, email: "", active: true });
  }
  function edit(c: CouponRow) {
    setMsg("");
    setDraft({ id: c.id, code: c.code, name: c.name, type: c.discount_type === "fixed" ? "fixed" : "percentage", value: String(c.discount_type === "fixed" ? c.discount_value / 100 : c.discount_value), validFrom: c.valid_from, validTo: c.valid_to, stayFrom: fullDate(c.stay_from), stayTo: fullDate(c.stay_to), blackout: parseDateRanges(c.blackout_json).filter((r) => r.from.length === 10), maxUses: c.max_uses === null ? "" : String(c.max_uses), combinable: c.combinable === 1, email: c.restricted_email ?? "", active: c.active === 1 });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function send(method: "POST" | "PATCH" | "DELETE", body: object, done: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/pms/coupons", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(error(r.status, d.error)); return false; }
      setMsg(done);
      router.refresh();
      return true;
    } catch { setMsg(t("cp.failed", { code: "network" })); return false; } finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    const body = {
      id: draft.id, code: draft.code, name: draft.name, discountType: draft.type, discountValue: draft.type === "fixed" ? Math.round(Number(draft.value) * 100) : Math.round(Number(draft.value)),
      validFrom: draft.validFrom, validTo: draft.validTo, stayFrom: draft.stayFrom || null, stayTo: draft.stayTo || null, blackout: draft.blackout.filter((b) => b.from && b.to),
      maxUses: Number(draft.maxUses) > 0 ? Math.trunc(Number(draft.maxUses)) : null, combinable: draft.combinable, restrictedEmail: draft.email.trim() || null, active: draft.active,
    };
    if (await send("POST", body, t("cp.saved"))) setDraft(null);
  }
  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setMsg(t("cp.copied", { code })); } catch { setMsg(code); }
  }

  const general = coupons.filter((c) => c.purpose !== "birthday"), birthday = coupons.filter((c) => c.purpose === "birthday");
  const list = (tab === "general" ? general : birthday).filter((c) => !search.trim() || `${c.code} ${c.name} ${c.restricted_email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const valid = draft && draft.code.trim().length >= 3 && Number(draft.value) > 0 && draft.validFrom && draft.validTo && draft.validTo >= draft.validFrom && (!draft.stayFrom || !draft.stayTo || draft.stayTo >= draft.stayFrom);
  const activeCount = general.filter((c) => couponStatus(c, today, c.pending_uses) === "active").length;
  const usedTotal = general.reduce((s, c) => s + c.usage_count, 0);

  return (
    <>
      <p className="notice" role="status">{msg}</p>
      <div className="couponStats">
        <div><small>{t("cp.statActive")}</small><b>{activeCount}</b></div>
        <div><small>{t("cp.statUses")}</small><b>{usedTotal}</b></div>
        {coupons.some((c) => c.revenue_cents !== null) && <div><small>{t("cp.statRevenue")}</small><b>{euro(general.reduce((s, c) => s + (c.revenue_cents ?? 0), 0))}</b></div>}
        <div><small>{t("cp.statBirthday")}</small><b>{birthday.length}</b></div>
      </div>

      {draft && (
        <article className="card srEditor offerEditor">
          <div className="srHead"><h2>{draft.id ? t("cp.editTitle") : t("cp.newTitle")}</h2></div>
          <div className="offerSections">
            <section>
              <h3>1 · {t("cp.sec.code")}</h3>
              <div className="srFields">
                <label>{t("cp.code")}<span className="couponCodeField"><input value={draft.code} maxLength={40} autoComplete="off" onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/\s+/g, "") })} /><button type="button" className="secondaryButton" title={t("cp.generate")} onClick={() => setDraft({ ...draft, code: generate(draft.code.includes("-") ? draft.code.split("-")[0] : "") })}>🎲</button></span><small>{t("cp.codeHint")}</small></label>
                <label>{t("cp.name")}<input value={draft.name} maxLength={120} placeholder={t("cp.namePh")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label>{t("cp.type")}<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}><option value="percentage">{t("of.percent")}</option><option value="fixed">{t("cp.fixedTotal")}</option></select></label>
                <label>{t("of.value")}<input type="number" min={draft.type === "fixed" ? 0.01 : 1} max={draft.type === "percentage" ? 100 : undefined} step={draft.type === "fixed" ? "0.01" : "1"} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></label>
              </div>
            </section>
            <section>
              <h3>2 · {t("cp.sec.validity")}</h3>
              <div className="srFields">
                <label>{t("cp.validFrom")}<input type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} /></label>
                <label>{t("cp.validTo")}<input type="date" value={draft.validTo} min={draft.validFrom} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} /></label>
                <label>{t("cp.stayFrom")}<input type="date" value={draft.stayFrom} onChange={(e) => setDraft({ ...draft, stayFrom: e.target.value })} /></label>
                <label>{t("cp.stayTo")}<input type="date" value={draft.stayTo} min={draft.stayFrom || undefined} onChange={(e) => setDraft({ ...draft, stayTo: e.target.value })} /></label>
              </div>
              <p className="srHelp">{t("cp.validityHint")}</p>
              <div className="offerOverrides">
                <b>{t("cp.blackout")}</b><small>{t("cp.blackoutHint")}</small>
                {draft.blackout.map((b, i) => (
                  <div key={i} className="offerOverride">
                    <label>{t("of.from")}<input type="date" value={b.from} onChange={(e) => setDraft({ ...draft, blackout: draft.blackout.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} /></label>
                    <label>{t("of.to")}<input type="date" value={b.to} min={b.from} onChange={(e) => setDraft({ ...draft, blackout: draft.blackout.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} /></label>
                    <button type="button" className="danger" aria-label={t("of.remove")} onClick={() => setDraft({ ...draft, blackout: draft.blackout.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                {draft.blackout.length < 20 && <button type="button" className="secondaryButton" onClick={() => setDraft({ ...draft, blackout: [...draft.blackout, { from: draft.validFrom, to: draft.validFrom }] })}>+ {t("cp.addBlackout")}</button>}
              </div>
            </section>
            <section>
              <h3>3 · {t("cp.sec.limits")}</h3>
              <div className="srFields">
                <label>{t("cp.maxUses")}<input type="number" min={1} placeholder="∞" value={draft.maxUses} onChange={(e) => setDraft({ ...draft, maxUses: e.target.value })} /><small>{t("cp.maxUsesHint")}</small></label>
                <label>{t("cp.email")}<input type="email" value={draft.email} placeholder="—" onChange={(e) => setDraft({ ...draft, email: e.target.value })} /><small>{t("cp.emailHint")}</small></label>
              </div>
              <label className="inline offerCheck"><input type="checkbox" checked={draft.combinable} onChange={(e) => setDraft({ ...draft, combinable: e.target.checked })} /> <span>{t("cp.combinable")}<small>{t("cp.combinableHint")}</small></span></label>
            </section>
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
          <div className="couponTabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "general"} className={tab === "general" ? "active" : undefined} onClick={() => setTab("general")}>{t("cp.tabGeneral")} <small>{general.length}</small></button>
            <button type="button" role="tab" aria-selected={tab === "birthday"} className={tab === "birthday" ? "active" : undefined} onClick={() => setTab("birthday")}>🎂 {t("cp.tabBirthday")} <small>{birthday.length}</small></button>
          </div>
          <div className="srNav">
            <input type="search" placeholder={t("cp.search")} aria-label={t("cp.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            {canCreate && tab === "general" && !draft && <button type="button" className="primaryAction" onClick={openNew}>+ {t("cp.new")}</button>}
          </div>
        </div>
        {tab === "birthday" && <p className="srHelp">{t("cp.birthdayHelp")} <a href="/pms/pricing">{t("cp.birthdaySettings")}</a></p>}
        {list.length === 0 ? <p>{tab === "general" ? t("cp.none") : t("cp.noneBirthday")}</p> : (
          <div className="tableWrap">
            <table className="srList offerList">
              <thead><tr><th>{t("cp.code")}</th><th>{t("of.value")}</th><th>{t("cp.validity")}</th><th>{t("cp.uses")}</th><th>{t("of.status")}</th><th></th></tr></thead>
              <tbody>
                {list.map((c) => {
                  const status = couponStatus(c, today, c.pending_uses);
                  const blackout = parseDateRanges(c.blackout_json);
                  return (
                    <tr key={c.id} className={status === "active" || status === "upcoming" ? undefined : "inactive"}>
                      <td><button type="button" className="couponCode" title={t("cp.copy")} onClick={() => copy(c.code)}>{c.code}</button>{c.name && <small>{c.name}</small>}{c.restricted_email && <small>✉️ {c.restricted_email}</small>}</td>
                      <td><b className="offerMinus">−{amount(c)}</b><small>{c.combinable === 1 ? t("cp.stacks") : t("cp.noStack")}</small></td>
                      <td><small>{t("cp.bookBetween")}</small> {day(c.valid_from)} – {day(c.valid_to)}{(c.stay_from || c.stay_to) && <small>{t("cp.stays")}: {day(c.stay_from) || "…"} – {day(c.stay_to) || "…"}</small>}{blackout.length > 0 && <small>{t("cp.blackoutCount", { n: blackout.length })}</small>}</td>
                      <td><b>{c.usage_count}{c.max_uses !== null ? ` / ${c.max_uses}` : ""}</b>{c.pending_uses > 0 && <small>{t("cp.pending", { n: c.pending_uses })}</small>}{c.revenue_cents ? <small>{euro(c.revenue_cents)}</small> : null}</td>
                      <td><span className={`offerStatus ${status === "active" ? "running" : status === "upcoming" ? "upcoming" : status === "inactive" ? "inactive" : "ended"}`}>{t(`cp.st.${status}` as PmsKey)}</span></td>
                      <td className="srActions">
                        {canEdit && c.purpose !== "birthday" && <button type="button" className="secondaryButton" onClick={() => edit(c)}>{t("of.edit")}</button>}
                        {canEdit && <button type="button" className="secondaryButton" disabled={busy} onClick={() => send("PATCH", { id: c.id, active: c.active !== 1 }, c.active === 1 ? t("cp.disabled") : t("cp.enabled"))}>{c.active === 1 ? t("cp.disable") : t("cp.enable")}</button>}
                        {canDelete && <button type="button" className="danger" disabled={busy} onClick={() => confirm(t("cp.confirmDelete", { code: c.code })) && void send("DELETE", { id: c.id }, t("of.deleted"))}>{t("of.delete")}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <small>{t("cp.help")}</small>
      </article>
    </>
  );
}
