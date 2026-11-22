"use client";
import { useState } from "react";
import { DepartmentIcon } from "@/app/manage-booking/department-icon";
import type { advisorState, SuggestionView } from "@/lib/department-sales";
import { salesError, salesT, type SalesKey } from "@/lib/department-sales-texts";
import type { DepartmentIcon as IconKey } from "@/lib/guest-portal-core";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";
import { promoPrice } from "../../../../scripts/department-sales-core.mjs";

type State = Awaited<ReturnType<typeof advisorState>>;
type Draft = { id: number; titleEl: string; titleEn: string; bodyEl: string; bodyEn: string; discountPercent: number; durationHours: number };

/** Open suggestions (AI and rules), one-click offer to the right guests, the salesperson's methods per department. */
export function AdvisorView({ lang, initial, aiConfigured, canSend }: { lang: PmsLang; initial: State; aiConfigured: boolean; canSend: boolean }) {
  const t = salesT(lang);
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"" | "run" | "act">("");
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

  async function post(body: object, kind: "run" | "act") {
    setBusy(kind); setMsg("");
    try {
      const r = await fetch("/api/pms/sales-advisor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error === "TOO_MANY_REQUESTS" ? (lang === "el" ? "Πολλές αναλύσεις AI αυτή την ώρα. Δοκιμάστε αργότερα." : "Too many AI analyses this hour. Try later.") : salesError(lang, d.error)); return null; }
      setState({ playbook: d.playbook, runs: d.runs, suggestions: d.suggestions });
      return d;
    } finally { setBusy(""); }
  }
  async function run(ai: boolean) {
    const d = await post({ action: "run", ai }, "run");
    if (d?.run) setMsg(d.run.error ? t("adv.aiError", { error: d.run.error }) : d.run.added ? t("adv.added", { n: d.run.added }) : t("adv.nothing"));
  }
  const prepare = (s: SuggestionView) => setDraft({ id: s.id, titleEl: s.titleEl || s.title, titleEn: s.titleEn, bodyEl: s.messageEl, bodyEn: s.messageEn, discountPercent: s.discountPercent, durationHours: s.durationHours || 24 });
  async function send() {
    if (!draft) return;
    const { id, ...rest } = draft;
    if (await post({ action: "apply", id, ...rest }, "act")) { setDraft(null); setMsg(t("adv.sent")); }
  }

  const open = state.suggestions.filter((s) => s.status === "open"), past = state.suggestions.filter((s) => s.status !== "open");
  const last = state.runs[0];
  const card = (s: SuggestionView) => (
    <article key={s.id} className={`card advItem kind-${s.kind}`}>
      <header>
        <span className={`advKind kind-${s.kind}`}>{s.kind === "alert" ? "⚠️ " : ""}{t(`adv.kind.${s.kind}` as SalesKey)}</span>
        <span className="advMeta">{s.department}{" · "}{s.ai ? `🤖 ${t("adv.ai")}` : t("adv.rule")}{" · "}{t(`adv.conf.${s.confidence}` as SalesKey)}{" · "}{when(s.createdAt)}</span>
      </header>
      <h3>{s.title}</h3>
      {s.reasoning && <p>{s.reasoning}</p>}
      <p className="muted">
        {s.messageEl || s.messageEn ? <>{t("adv.audience")}: <b>{t(`aud.${s.segment}` as SalesKey)}</b></> : null}
        {s.item ? <> · 🏷️ {s.item}{s.itemPriceCents !== null && s.discountPercent > 0 ? <> <s>{money(s.itemPriceCents)}</s> → <b>{money(promoPrice(s.itemPriceCents, s.discountPercent))}</b> (−{s.discountPercent}%)</> : null}</> : null}
        {s.startsHour !== null ? <> · {t("adv.startsAt")} {String(s.startsHour).padStart(2, "0")}:00</> : null}
        {s.durationHours ? <> · {s.durationHours}h</> : null}
      </p>
      {(s.messageEl || s.messageEn) && <blockquote className="advMsg">{s.messageEl || s.messageEn}</blockquote>}
      {s.status === "open" ? (
        <div className="actions">
          {canSend && (s.messageEl || s.messageEn) && <button type="button" className="primaryAction" disabled={!!busy} onClick={() => prepare(s)}>{t("adv.prepare")}</button>}
          <button type="button" className="secondaryButton" disabled={!!busy} onClick={() => void post({ action: "dismiss", id: s.id }, "act")}>{s.messageEl || s.messageEn ? t("adv.dismiss") : t("adv.done")}</button>
        </div>
      ) : <p className="muted">{t(`adv.${s.status}` as SalesKey)}{s.status === "applied" ? ` · ${t("offer.results", { n: s.orders, amount: money(s.revenueCents) })}` : ""}</p>}
      {draft?.id === s.id && (
        <div className="advDraft">
          <div className="formGrid">
            <label>{lang === "el" ? "Τίτλος (ελληνικά)" : "Title (Greek)"}<input value={draft.titleEl} maxLength={120} onChange={(e) => setDraft({ ...draft, titleEl: e.target.value })} /></label>
            <label>{lang === "el" ? "Τίτλος (αγγλικά)" : "Title (English)"}<input value={draft.titleEn} maxLength={120} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} /></label>
            <label>{lang === "el" ? "Μήνυμα (ελληνικά)" : "Message (Greek)"}<textarea rows={3} maxLength={1500} value={draft.bodyEl} onChange={(e) => setDraft({ ...draft, bodyEl: e.target.value })} /></label>
            <label>{lang === "el" ? "Μήνυμα (αγγλικά)" : "Message (English)"}<textarea rows={3} maxLength={1500} value={draft.bodyEn} onChange={(e) => setDraft({ ...draft, bodyEn: e.target.value })} /></label>
            {s.itemId && <label>{t("offer.discount")}<input type="number" min={0} max={40} step={5} value={draft.discountPercent} onChange={(e) => setDraft({ ...draft, discountPercent: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} /></label>}
            <label>{t("adv.duration")}<input type="number" min={1} max={336} value={draft.durationHours} onChange={(e) => setDraft({ ...draft, durationHours: Math.max(1, Math.min(336, Number(e.target.value) || 1)) })} /></label>
          </div>
          <small className="muted">{t("offer.help")} {"{name}"} → {lang === "el" ? "μικρό όνομα του πελάτη" : "the guest's first name"}.</small>
          <div className="actions"><button type="button" className="primaryAction" disabled={!!busy || !(draft.titleEl || draft.bodyEl || draft.titleEn || draft.bodyEn)} onClick={() => void send()}>{t("adv.send")}</button><button type="button" className="secondaryButton" onClick={() => setDraft(null)}>{t("fwd.cancel")}</button></div>
        </div>
      )}
    </article>
  );

  return (
    <div className="advPage">
      <div className="card advBar">
        <div>
          <b>{t("adv.lastRun")}:</b> {last ? `${when(last.at)} · ${last.kind === "ai" ? `🤖 ${t("adv.ai")}` : t("adv.rule")}` : "—"}
          <br /><small className="muted">{t("adv.daily")}{aiConfigured ? "" : ` ${t("adv.noKey")}`}</small>
        </div>
        <div className="actions">
          {aiConfigured && <button type="button" className="primaryAction" disabled={!!busy} onClick={() => void run(true)}>{busy === "run" ? t("adv.running") : `🤖 ${t("adv.runAi")}`}</button>}
          <button type="button" className={aiConfigured ? "secondaryButton" : "primaryAction"} disabled={!!busy} onClick={() => void run(false)}>{busy === "run" && !aiConfigured ? t("adv.running") : t("adv.run")}</button>
        </div>
      </div>
      {last?.summary && <div className="card advSummary"><p>{last.summary}</p>{last.error && <small className="error">{t("adv.aiError", { error: last.error })}</small>}</div>}
      <p className="notice" role="status">{msg}</p>

      <h2>{t("adv.open")} ({open.length})</h2>
      {open.length === 0 ? <p className="muted">{t("adv.empty")}</p> : <div className="advList">{open.map(card)}</div>}

      {state.playbook.length > 0 && (
        <>
          <h2>{lang === "el" ? "Τακτικές πωλητή ανά τμήμα" : "Sales methods per department"}</h2>
          <div className="advPlaybook">{state.playbook.map((p) => (
            <article key={p.departmentId} className="card">
              <h3><DepartmentIcon icon={p.icon as IconKey} /> {p.name}</h3>
              {p.aiTips.length > 0 && <><small className="muted">🤖 {lang === "el" ? "Για αυτή την εβδομάδα" : "For this week"}{p.aiAt ? ` · ${when(p.aiAt)}` : ""}</small><ul>{p.aiTips.map((x) => <li key={x}>{x}</li>)}</ul></>}
              <details open={!p.aiTips.length}><summary>{lang === "el" ? "Μέθοδοι που δουλεύουν" : "Methods that work"}</summary><ul>{p.methods.map((x) => <li key={x}>{x}</li>)}</ul></details>
            </article>
          ))}</div>
        </>
      )}

      {past.length > 0 && <><h2>{t("adv.history")}</h2><div className="advList past">{past.map(card)}</div></>}
    </div>
  );
}
