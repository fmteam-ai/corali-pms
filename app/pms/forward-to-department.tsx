"use client";
// v184: «↪ Προώθηση σε τμήμα» next to a guest message or order, with the forwards already made («→ Spa · το είδαν»).
import { useCallback, useEffect, useState } from "react";
import type { ForwardKind } from "@/lib/department-forward-core";
import type { ForwardView } from "@/lib/department-forward";
import { salesError, salesT } from "@/lib/department-sales-texts";
import type { PmsLang } from "@/lib/pms-i18n";

type Target = { id: number; name: string; icon: string; team: string | null; email: string | null; ready: boolean };
let targetsCache: Promise<Target[]> | null = null;
const loadTargets = () => (targetsCache ??= fetch("/api/pms/department-forwards?targets=1", { cache: "no-store" }).then((r) => r.json()).then((d) => (d.ok ? d.targets as Target[] : [])).catch(() => { targetsCache = null; return []; }));

/** The forwards of a list of messages / orders, reloaded every 30 s (the department marks them seen / done). */
export function useForwards(kind: ForwardKind, ids: number[]) {
  const key = ids.join(",");
  const [map, setMap] = useState<Record<number, ForwardView[]>>({});
  const load = useCallback(async () => {
    if (!key) return;
    const d = await fetch(`/api/pms/department-forwards?kind=${kind}&ids=${key}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) return;
    const next: Record<number, ForwardView[]> = {};
    for (const f of d.forwards as ForwardView[]) (next[f.sourceId] ??= []).push(f);
    setMap(next);
  }, [kind, key]);
  useEffect(() => { queueMicrotask(() => void load()); const id = setInterval(() => void load(), 30_000); return () => clearInterval(id); }, [load]);
  return [map, load] as const;
}

export function ForwardToDepartment({ lang, kind, sourceId, forwards = [], defaultDepartmentId = null, canForward, onDone }: { lang: PmsLang; kind: ForwardKind; sourceId: number; forwards?: ForwardView[]; defaultDepartmentId?: number | null; canForward: boolean; onDone?: () => void }) {
  const t = salesT(lang);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [form, setForm] = useState({ departmentId: defaultDepartmentId ?? 0, note: "", notifyGuest: true });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && !targets) void loadTargets().then((x) => { setTargets(x); setForm((f) => ({ ...f, departmentId: f.departmentId || x.find((d) => d.ready)?.id || 0 })); }); }, [open, targets]);
  async function send() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/department-forwards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, sourceId, ...form }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(salesError(lang, d.error)); return; }
      const name = targets?.find((x) => x.id === form.departmentId)?.name ?? "";
      setMsg(t(form.notifyGuest ? "fwd.doneGuest" : "fwd.done", { dept: name })); setOpen(false); setForm((f) => ({ ...f, note: "" })); onDone?.();
    } finally { setBusy(false); }
  }
  const chosen = targets?.find((x) => x.id === form.departmentId);
  return (
    <span className="fwdBox">
      {forwards.map((f) => <span key={f.id} className={`fwdBadge st-${f.status}`} title={[f.by, f.seenBy && `👀 ${f.seenBy}`, f.doneBy && `✓ ${f.doneBy}`].filter(Boolean).join(" · ")}>→ {f.department} · {t(`fwd.st.${f.status}`)}{f.automatic ? ` · ${t("fwd.auto")}` : ""}</span>)}
      {canForward && !open && <button type="button" className="linkButton" onClick={() => { setOpen(true); setMsg(""); }}>{t("fwd.button")}</button>}
      {open && (
        <span className="fwdForm" role="group" aria-label={t("fwd.button")}>
          <label>{t("fwd.to")}<select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: Number(e.target.value) })}>
            <option value={0}>—</option>
            {(targets ?? []).map((d) => <option key={d.id} value={d.id} disabled={!d.ready}>{d.name}{d.ready ? ` (${[d.team, d.email].filter(Boolean).join(", ")})` : ` — ${t("fwd.noRecipients")}`}</option>)}
          </select></label>
          {targets && !targets.some((d) => d.ready) && <small className="muted">{t("fwd.setup")}</small>}
          <label>{t("fwd.note")}<input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.notifyGuest} onChange={(e) => setForm({ ...form, notifyGuest: e.target.checked })} />{t("fwd.notify")}</label>
          <span className="actions"><button type="button" className="primaryAction" disabled={busy || !chosen?.ready} onClick={() => void send()}>{t("fwd.send")}</button><button type="button" className="secondaryButton" onClick={() => setOpen(false)}>{t("fwd.cancel")}</button></span>
        </span>
      )}
      {msg && <small className="fwdMsg" role="status">{msg}</small>}
    </span>
  );
}
