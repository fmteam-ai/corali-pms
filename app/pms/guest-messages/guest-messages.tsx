"use client";
import Link from "next/link";
import { useState } from "react";
import type { listAnnouncements } from "@/lib/guest-portal";
import { announcementKinds, type AnnouncementKind } from "@/lib/guest-portal-core";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";

type Row = Awaited<ReturnType<typeof listAnnouncements>>[number];
type Option = { id: number; label: string };

// datetime-local works in the browser's clock; the hotel's staff use Greek time, so that is what they type.
const local = (ms: number) => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const blank = () => ({ target: "all" as "all" | "guest", bookingId: 0, departmentId: 0, kind: "info" as AnnouncementKind, titleEl: "", titleEn: "", bodyEl: "", bodyEn: "", starts: local(Date.now()), ends: "", tv: false });

export function GuestMessages({ lang, initial, guests, departments, canSend }: { lang: PmsLang; initial: Row[]; guests: Option[]; departments: { id: number; name: string }[]; canSend: boolean }) {
  const t = pmsT(lang);
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
  // Quick end times: happy hour usually lasts a couple of hours, an offer the day or the week.
  const endIn = (hours: number) => setForm((f) => ({ ...f, ends: local(new Date(f.starts).getTime() + hours * 3_600_000) }));

  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(t("gm.failed")); return false; }
      setRows(d.announcements); setMsg(ok); return true;
    } finally { setBusy(false); }
  }
  async function send() {
    const startsAt = new Date(form.starts).getTime(), endsAt = form.ends ? new Date(form.ends).getTime() : null;
    if (!Number.isFinite(startsAt) || (endsAt !== null && endsAt <= startsAt)) { setMsg(t("gm.badDates")); return; }
    if (form.target === "guest" && !form.bookingId) { setMsg(t("gm.pickGuest")); return; }
    const done = await post({ action: "create", kind: form.kind, departmentId: form.departmentId || null, bookingId: form.target === "guest" ? form.bookingId : null, titleEl: form.titleEl, titleEn: form.titleEn, bodyEl: form.bodyEl, bodyEn: form.bodyEn, startsAt, endsAt, tv: form.tv }, t("gm.sent"));
    if (done) setForm(blank());
  }
  return (
    <div>
      <nav className="prcNav"><Link href="/pms/departments">{t("dep.tab.orders")}</Link><Link href="/pms/departments?tab=catalog">{t("dep.tab.catalog")}</Link><Link href="/pms/guest-messages" className="current" aria-current="page">{t("nav.guestMessages")}</Link></nav>
      {canSend && (
        <div className="card gmForm">
          <h2>{t("gm.new")}</h2>
          <div className="gmKinds" role="radiogroup" aria-label={t("gm.kind")}>{announcementKinds.map((k) => <button type="button" role="radio" aria-checked={form.kind === k} key={k} className={form.kind === k ? "on" : ""} onClick={() => setForm({ ...form, kind: k })}>{t(`gm.kind.${k}`)}</button>)}</div>
          <div className="formGrid">
            <label>{t("gm.to")}<select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value as "all" | "guest" })}><option value="all">{t("gm.toAll")}</option><option value="guest">{t("gm.toGuest")}</option></select></label>
            {form.target === "guest"
              ? <label>{t("gm.guest")}<select value={form.bookingId} onChange={(e) => setForm({ ...form, bookingId: Number(e.target.value) })}><option value={0}>—</option>{guests.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
              : <label>{t("gm.department")}<select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: Number(e.target.value) })}><option value={0}>{t("gm.noDepartment")}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
            <label>{t("gm.titleEl")}<input value={form.titleEl} maxLength={120} onChange={(e) => setForm({ ...form, titleEl: e.target.value })} placeholder="Happy hour στο μπαρ" /></label>
            <label>{t("gm.titleEn")}<input value={form.titleEn} maxLength={120} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} placeholder="Happy hour at the bar" /></label>
            <label>{t("gm.bodyEl")}<textarea rows={3} maxLength={1500} value={form.bodyEl} onChange={(e) => setForm({ ...form, bodyEl: e.target.value })} placeholder="{name}, όλα τα κοκτέιλ −30% από 18:00 έως 20:00!" /></label>
            <label>{t("gm.bodyEn")}<textarea rows={3} maxLength={1500} value={form.bodyEn} onChange={(e) => setForm({ ...form, bodyEn: e.target.value })} placeholder="{name}, all cocktails −30% from 18:00 to 20:00!" /></label>
            <label>{t("gm.starts")}<input type="datetime-local" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></label>
            <label>{t("gm.ends")}<input type="datetime-local" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} /><span className="gmTarget"><button type="button" className="linkButton" onClick={() => endIn(2)}>+2h</button><button type="button" className="linkButton" onClick={() => endIn(24)}>+1 {t("gm.day")}</button><button type="button" className="linkButton" onClick={() => endIn(24 * 7)}>+7 {t("gm.days")}</button></span></label>
          </div>
          <small className="muted">{t("gm.help")}</small>
          <label className="check"><input type="checkbox" checked={form.tv} onChange={(e) => setForm({ ...form, tv: e.target.checked })} />{t(form.target === "guest" ? "gm.tvRoom" : "gm.tvAll")}</label>
          <div className="actions"><button type="button" className="primaryAction" disabled={busy || !(form.titleEl || form.bodyEl || form.titleEn || form.bodyEn)} onClick={() => void send()}>{t("gm.send")}</button></div>
        </div>
      )}
      <p className="notice" role="status">{msg}</p>
      <div className="gmList">
        {rows.length === 0 && <p className="muted">{t("gm.empty")}</p>}
        {rows.map((a) => (
          <article key={a.id} className={`card gmItem${a.startsAt > now ? " future" : ""}`}>
            <span className={`gmBadge ${a.personal ? "personal" : a.kind}`}>{a.personal ? t("gm.personal") : t(`gm.kind.${a.kind}`)}</span>
            <div>
              <b>{a.titleEl || a.titleEn}</b>
              {(a.bodyEl || a.bodyEn) && <p>{a.bodyEl || a.bodyEn}</p>}
              <small className="muted">{a.personal ? `→ ${a.target}` : `→ ${t("gm.toAllCount", { n: String(a.inHouse) })}`}{a.department ? ` · ${a.department}` : ""} · {when(a.startsAt)}{a.endsAt ? ` → ${when(a.endsAt)}` : ""}{a.author ? ` · ${a.author}` : ""}{a.startsAt > now ? ` · ${t("gm.scheduled")}` : a.endsAt !== null && a.endsAt < now ? ` · ${t("gm.ended")}` : ""}</small>
            </div>
            {canSend && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("gm.removeConfirm"))) void post({ action: "remove", id: a.id }, t("gm.removed")); }}>{t("gm.remove")}</button>}
          </article>
        ))}
      </div>
    </div>
  );
}
