"use client";
import { useCallback, useEffect, useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { DefectForm } from "./defect-form";

export type Notice = {
  id: number; room_id: number; room_code: string; room_type: string; severity: string; description: string; reporter_name: string | null; reported_at: number;
  status: string; resolver_name: string | null; resolved_at: number | null; resolution_notes: string | null; labor_hours: number | null; cost_cents: number | null;
  vendor_reference: string | null; post_repair_state: string | null; photo_ids: number[];
};

function Lightbox({ lang, ids, index, onClose }: { lang: PmsLang; ids: number[]; index: number; onClose: () => void }) {
  const t = pmsT(lang);
  const [i, setI] = useState(index);
  const go = useCallback((d: number) => setI((v) => (v + d + ids.length) % ids.length), [ids.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t("mnt.photoOf", { n: i + 1, total: ids.length })} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/pms/maintenance/photos/${ids[i]}`} alt={t("mnt.photoOf", { n: i + 1, total: ids.length })} onClick={(e) => e.stopPropagation()} />
      {ids.length > 1 && <>
        <button type="button" className="lbPrev" aria-label={t("mnt.prev")} onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
        <button type="button" className="lbNext" aria-label={t("mnt.next")} onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
      </>}
      <span className="lbCount">{i + 1} / {ids.length}</span>
      <button type="button" className="lbClose" aria-label={t("mnt.close")} onClick={onClose}>×</button>
    </div>
  );
}

function ResolveForm({ lang, notice, onResolved }: { lang: PmsLang; notice: Notice; onResolved: (message: string) => void }) {
  const t = pmsT(lang);
  const [notes, setNotes] = useState("");
  const [hours, setHours] = useState("");
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [after, setAfter] = useState<"clean" | "dirty">("dirty");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const body = { resolutionNotes: notes.trim(), laborHours: hours ? Number(hours) : null, costCents: cost ? Math.round(Number(cost.replace(",", ".")) * 100) : null, vendorReference: vendor.trim() || null, postRepairState: after };
      const r = await fetch(`/api/pms/maintenance/${notice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("mnt.failed")); return; }
      onResolved(d.roomStatus === "out_of_order" ? t("mnt.stillOoo") : t("mnt.resolvedOk"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="resolveForm" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h4>{t("mnt.resolution")}</h4>
      {(notice.severity === "major" || notice.severity === "out_of_order") && <small>{t("mnt.secondPerson")}</small>}
      <label>{t("mnt.notes")}<textarea required minLength={5} maxLength={4000} placeholder={t("mnt.notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <fieldset>
        <legend>{t("mnt.optional")}</legend>
        <div className="three">
          <label>{t("mnt.hours")}<input type="number" min={0} max={999} step={0.25} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
          <label>{t("mnt.cost")}<input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
          <label>{t("mnt.vendor")}<input maxLength={200} value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
        </div>
      </fieldset>
      <fieldset className="afterRepair">
        <legend>{t("mnt.after")}</legend>
        <label className={after === "clean" ? "on" : undefined}><input type="radio" name={`after-${notice.id}`} checked={after === "clean"} onChange={() => setAfter("clean")} /><b>{t("mnt.clean")}</b><small>{t("mnt.cleanHint")}</small></label>
        <label className={after === "dirty" ? "on" : undefined}><input type="radio" name={`after-${notice.id}`} checked={after === "dirty"} onChange={() => setAfter("dirty")} /><b>{t("mnt.dirty")}</b><small>{t("mnt.dirtyHint")}</small></label>
      </fieldset>
      <p className="error" role="status">{msg}</p>
      <button disabled={busy || notes.trim().length < 5}>{t("mnt.resolve")}</button>
    </form>
  );
}

export function NoticeCard({ lang, notice, canResolve, onResolved }: { lang: PmsLang; notice: Notice; canResolve: boolean; onResolved: (message: string) => void }) {
  const t = pmsT(lang);
  const [photo, setPhoto] = useState<number | null>(null);
  const time = (ms: number | null) => (ms ? new Date(Number(ms)).toLocaleString(pmsLocale(lang), { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }) : "—");
  const money = (cents: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(cents / 100);
  return (
    <article className={`noticeCard sev-${notice.severity} ${notice.status}`}>
      <header>
        <span className={`sevTag sev-${notice.severity}`}>{notice.severity === "minor" ? "🛠️" : "⚠️"} {t(`mnt.sev.${notice.severity}` as PmsKey)}</span>
        <span className={`noticeStatus ${notice.status}`}>{t(`mnt.st.${notice.status}` as PmsKey)}</span>
      </header>
      <small>{t("mnt.reportedBy", { name: notice.reporter_name ?? "—", time: time(notice.reported_at) })}</small>
      <p className="noticeText">{notice.description}</p>
      {notice.photo_ids.length > 0 && (
        <div className="photoCarousel" aria-label={t("mnt.photos", { n: notice.photo_ids.length })}>
          {notice.photo_ids.map((id, i) => (
            <button type="button" key={id} className="photoThumb" onClick={() => setPhoto(i)} aria-label={t("mnt.photoOf", { n: i + 1, total: notice.photo_ids.length })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/pms/maintenance/photos/${id}`} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {notice.status === "resolved" && (
        <div className="resolutionInfo">
          <small>{t("mnt.resolvedBy", { name: notice.resolver_name ?? "—", time: time(notice.resolved_at) })}</small>
          <p>{notice.resolution_notes}</p>
          <small>
            {[notice.labor_hours !== null && notice.labor_hours !== undefined ? t("mnt.labor", { h: notice.labor_hours }) : "", notice.cost_cents !== null && notice.cost_cents !== undefined ? t("mnt.costLine", { amount: money(Number(notice.cost_cents)) }) : "", notice.vendor_reference ? t("mnt.vendorRef", { v: notice.vendor_reference }) : "", notice.post_repair_state ? t(`mnt.after${notice.post_repair_state}` as PmsKey) : ""].filter(Boolean).join(" · ")}
          </small>
        </div>
      )}
      {notice.status === "open" && canResolve && <ResolveForm lang={lang} notice={notice} onResolved={onResolved} />}
      {photo !== null && <Lightbox lang={lang} ids={notice.photo_ids} index={photo} onClose={() => setPhoto(null)} />}
    </article>
  );
}

/** Resolution workspace for a room (tape chart) or a single notice (maintenance queue). */
export function NoticeModal({ lang, roomId, roomCode, noticeId, canResolve, canReport, onClose, onChanged }: { lang: PmsLang; roomId?: number; roomCode?: string; noticeId?: number; canResolve: boolean; canReport: boolean; onClose: () => void; onChanged?: () => void }) {
  const t = pmsT(lang);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [msg, setMsg] = useState("");
  const [reporting, setReporting] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(noticeId ? `/api/pms/maintenance/${noticeId}` : `/api/pms/maintenance?roomId=${roomId}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { if (live) setNotices(ok ? (noticeId ? [d.notice] : d.notices) : []); })
      .catch(() => { if (live) setNotices([]); });
    return () => { live = false; };
  }, [noticeId, roomId, version]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".lightbox")) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const open = notices?.filter((n) => n.status === "open") ?? [];
  const resolved = notices?.filter((n) => n.status !== "open") ?? [];
  const code = roomCode ?? notices?.[0]?.room_code ?? "";
  const changed = (message: string) => { setMsg(message); setReporting(false); setVersion((v) => v + 1); onChanged?.(); };
  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="noticeModal" role="dialog" aria-modal="true" aria-label={t("mnt.room", { code })} onClick={(e) => e.stopPropagation()}>
        <header><h3>{t("mnt.room", { code })}</h3><button type="button" className="close" aria-label={t("mnt.close")} onClick={onClose}>×</button></header>
        <p className="notice" role="status">{msg}</p>
        {notices === null && <p>{t("mnt.loading")}</p>}
        {notices && notices.length === 0 && !reporting && <p>{t("mnt.none")}</p>}
        {open.map((n) => <NoticeCard key={n.id} lang={lang} notice={n} canResolve={canResolve} onResolved={changed} />)}
        {noticeId && resolved.map((n) => <NoticeCard key={n.id} lang={lang} notice={n} canResolve={false} onResolved={changed} />)}
        {roomId && canReport && (reporting
          ? <DefectForm lang={lang} roomId={roomId} onCancel={() => setReporting(false)} onDone={() => changed(t("mnt.reported"))} />
          : <button type="button" className="danger" onClick={() => setReporting(true)}>{t("mnt.report")}</button>)}
        {!noticeId && resolved.length > 0 && (
          <details className="noticeHistory">
            <summary>{t("mnt.history")} ({resolved.length})</summary>
            {resolved.map((n) => <NoticeCard key={n.id} lang={lang} notice={n} canResolve={false} onResolved={changed} />)}
          </details>
        )}
      </div>
    </div>
  );
}
