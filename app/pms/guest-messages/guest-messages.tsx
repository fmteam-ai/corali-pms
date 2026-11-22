"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { listAnnouncements } from "@/lib/guest-portal";
import { announcementKinds, type AnnouncementKind } from "@/lib/guest-portal-core";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";
import { salesError, salesT, type SalesKey } from "@/lib/department-sales-texts";
import { AUDIENCE_SEGMENTS, promoPrice, type AudienceSegment } from "../../../scripts/department-sales-core.mjs";

type Row = Awaited<ReturnType<typeof listAnnouncements>>[number];
type Option = { id: number; label: string };

// datetime-local works in the browser's clock; the hotel's staff use Greek time, so that is what they type.
const local = (ms: number) => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const blank = () => ({ target: "all" as "all" | "guest", bookingId: 0, departmentId: 0, kind: "info" as AnnouncementKind, titleEl: "", titleEn: "", bodyEl: "", bodyEn: "", starts: local(Date.now()), ends: "", tv: false, segment: "all" as AudienceSegment, itemId: 0, discount: 0 });
type Dept = { id: number; name: string; items: { id: number; name: string; priceCents: number }[] };

export function GuestMessages({ lang, initial, guests, departments, canSend }: { lang: PmsLang; initial: Row[]; guests: Option[]; departments: Dept[]; canSend: boolean }) {
  const t = pmsT(lang), st = salesT(lang);
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  // v184: how many bookings in house the chosen group reaches now.
  const [reach, setReach] = useState<{ count: number; all: boolean } | null>(null);
  useEffect(() => {
    if (form.target !== "all") return;
    let live = true;
    const id = setTimeout(() => void fetch("/api/pms/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", departmentId: form.departmentId || null, audience: { segment: form.segment, departmentId: form.departmentId || null } }) }).then((r) => r.json()).then((d) => { if (live && d.ok) setReach({ count: d.count, all: d.all }); }).catch(() => undefined), 250);
    return () => { live = false; clearTimeout(id); };
  }, [form.target, form.segment, form.departmentId]);
  const dept = departments.find((d) => d.id === form.departmentId), item = dept?.items.find((i) => i.id === form.itemId);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
  // Quick end times: happy hour usually lasts a couple of hours, an offer the day or the week.
  const endIn = (hours: number) => setForm((f) => ({ ...f, ends: local(new Date(f.starts).getTime() + hours * 3_600_000) }));

  async function post(body: object, ok: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error === "NO_AUDIENCE" ? salesError(lang, d.error) : t("gm.failed")); return false; }
      setRows(d.announcements); setMsg(ok); return true;
    } finally { setBusy(false); }
  }
  async function send() {
    const startsAt = new Date(form.starts).getTime(), endsAt = form.ends ? new Date(form.ends).getTime() : null;
    if (!Number.isFinite(startsAt) || (endsAt !== null && endsAt <= startsAt)) { setMsg(t("gm.badDates")); return; }
    if (form.target === "guest" && !form.bookingId) { setMsg(t("gm.pickGuest")); return; }
    const done = await post({ action: "create", kind: form.kind, departmentId: form.departmentId || null, bookingId: form.target === "guest" ? form.bookingId : null, titleEl: form.titleEl, titleEn: form.titleEn, bodyEl: form.bodyEl, bodyEn: form.bodyEn, startsAt, endsAt, tv: form.tv, audience: { segment: form.target === "all" ? form.segment : "all", departmentId: form.departmentId || null }, itemId: form.target === "all" && form.itemId ? form.itemId : null, discountPercent: form.target === "all" && form.itemId ? form.discount : 0 }, t("gm.sent"));
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
              : <label>{t("gm.department")}<select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: Number(e.target.value), itemId: 0, discount: 0, segment: !Number(e.target.value) && ["not_used", "used"].includes(form.segment) ? "all" : form.segment })}><option value={0}>{t("gm.noDepartment")}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
            {form.target === "all" && <>
              <label>{st("aud.title")}<select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as AudienceSegment })}>{AUDIENCE_SEGMENTS.filter((s) => form.departmentId || !["not_used", "used"].includes(s)).map((s) => <option key={s} value={s}>{st(`aud.${s}` as SalesKey)}</option>)}</select>
                {reach && <small className={reach.count ? "muted" : "error"}>{reach.count === 0 ? st("aud.noAudience") : reach.all ? st("aud.countAll", { n: reach.count }) : st("aud.count", { n: reach.count })}</small>}</label>
              {dept && dept.items.length > 0 && <label>{st("offer.item")}<select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: Number(e.target.value), discount: Number(e.target.value) ? form.discount || 10 : 0 })}><option value={0}>{st("offer.noItem")}</option>{dept.items.map((i) => <option key={i.id} value={i.id}>{i.name} · {money(i.priceCents)}</option>)}</select></label>}
              {item && <label>{st("offer.discount")}<input type="number" min={0} max={40} step={5} value={form.discount} onChange={(e) => setForm({ ...form, discount: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} /><small className="muted">{st("offer.price")}: <s>{money(item.priceCents)}</s> <b>{money(promoPrice(item.priceCents, form.discount))}</b> · {st("offer.help")}</small></label>}
            </>}
            <label>{t("gm.titleEl")}<input value={form.titleEl} maxLength={120} onChange={(e) => setForm({ ...form, titleEl: e.target.value })} placeholder="Happy hour στο μπαρ" /></label>
            <label>{t("gm.titleEn")}<input value={form.titleEn} maxLength={120} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} placeholder="Happy hour at the bar" /></label>
            <label>{t("gm.bodyEl")}<textarea rows={3} maxLength={1500} value={form.bodyEl} onChange={(e) => setForm({ ...form, bodyEl: e.target.value })} placeholder="{name}, όλα τα κοκτέιλ −30% από 18:00 έως 20:00!" /></label>
            <label>{t("gm.bodyEn")}<textarea rows={3} maxLength={1500} value={form.bodyEn} onChange={(e) => setForm({ ...form, bodyEn: e.target.value })} placeholder="{name}, all cocktails −30% from 18:00 to 20:00!" /></label>
            <label>{t("gm.starts")}<input type="datetime-local" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></label>
            <label>{t("gm.ends")}<input type="datetime-local" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} /><span className="gmTarget"><button type="button" className="linkButton" onClick={() => endIn(2)}>+2h</button><button type="button" className="linkButton" onClick={() => endIn(24)}>+1 {t("gm.day")}</button><button type="button" className="linkButton" onClick={() => endIn(24 * 7)}>+7 {t("gm.days")}</button></span></label>
          </div>
          <small className="muted">{t("gm.help")}</small>
          <label className="check"><input type="checkbox" checked={form.tv} onChange={(e) => setForm({ ...form, tv: e.target.checked })} />{t(form.target === "guest" ? "gm.tvRoom" : "gm.tvAll")}</label>
          <div className="actions"><button type="button" className="primaryAction" disabled={busy || !(form.titleEl || form.bodyEl || form.titleEn || form.bodyEn) || (form.target === "all" && reach?.count === 0)} onClick={() => void send()}>{t("gm.send")}</button></div>
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
              {a.item && <small>🏷️ {a.item}{a.promoCents !== null && a.itemPriceCents !== null ? <> · <s>{money(a.itemPriceCents)}</s> {money(a.promoCents)}</> : null} · {st("offer.results", { n: a.orders, amount: money(a.revenueCents) })}</small>}
              <small className="muted">{a.fromAdvisor ? "💡 " : ""}{a.personal ? `→ ${a.target}` : a.targets !== null ? `→ ${st(`aud.${a.segment}` as SalesKey)} · ${st("offer.target", { n: a.targets })}` : `→ ${t("gm.toAllCount", { n: String(a.inHouse) })}`}{a.department ? ` · ${a.department}` : ""} · {when(a.startsAt)}{a.endsAt ? ` → ${when(a.endsAt)}` : ""}{a.author ? ` · ${a.author}` : ""}{a.startsAt > now ? ` · ${t("gm.scheduled")}` : a.endsAt !== null && a.endsAt < now ? ` · ${t("gm.ended")}` : ""}</small>
            </div>
            {canSend && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("gm.removeConfirm"))) void post({ action: "remove", id: a.id }, t("gm.removed")); }}>{t("gm.remove")}</button>}
          </article>
        ))}
      </div>
    </div>
  );
}
