"use client";
import Link from "next/link";
import { useState } from "react";
import { DepartmentIcon } from "@/app/manage-booking/department-icon";
import type { Department, DepartmentItem, listDeptOrders } from "@/lib/guest-portal";
import { departmentIcons, type DepartmentIcon as IconKey, type DepartmentMode } from "@/lib/guest-portal-core";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Order = Awaited<ReturnType<typeof listDeptOrders>>[number];
type DeptForm = { id?: number; nameEl: string; nameEn: string; descriptionEl: string; descriptionEn: string; icon: IconKey; mode: DepartmentMode; openFrom: string; openTo: string; capacity: number; active: boolean; sortOrder: number };
type ItemForm = { id?: number; departmentId: number; nameEl: string; nameEn: string; descriptionEl: string; descriptionEn: string; price: string; durationMin: number; active: boolean; sortOrder: number };

const newDept = (): DeptForm => ({ nameEl: "", nameEn: "", descriptionEl: "", descriptionEn: "", icon: "bar", mode: "order", openFrom: "10:00", openTo: "23:00", capacity: 1, active: true, sortOrder: 0 });
const newItem = (d: Department): ItemForm => ({ departmentId: d.id, nameEl: "", nameEn: "", descriptionEl: "", descriptionEn: "", price: "", durationMin: d.mode === "appointment" ? 60 : 0, active: true, sortOrder: 0 });

export function DepartmentsManager({ lang, initialDepartments, initialOrders, initialTab, canEdit, canHandle }: { lang: PmsLang; initialDepartments: Department[]; initialOrders: Order[]; initialTab: "orders" | "catalog"; canEdit: boolean; canHandle: boolean }) {
  const t = pmsT(lang);
  const [tab, setTab] = useState(initialTab);
  const [departments, setDepartments] = useState(initialDepartments);
  const [orders, setOrders] = useState(initialOrders);
  const [dept, setDept] = useState<DeptForm | null>(null);
  const [item, setItem] = useState<ItemForm | null>(null);
  const [filter, setFilter] = useState<number | "all">("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

  async function post(body: object, done?: () => void) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `dep.err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("dep.failed")); return; }
      setDepartments(d.departments); setOrders(d.orders); setMsg(t("dep.saved")); done?.();
    } finally { setBusy(false); }
  }
  const saveDept = () => dept && void post({ action: "save_department", department: dept }, () => setDept(null));
  const saveItem = () => {
    if (!item) return;
    const { price, ...rest } = item;
    const priceCents = Math.round(Number(price.replace(",", ".")) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) { setMsg(t("dep.badPrice")); return; }
    void post({ action: "save_item", item: { ...rest, priceCents } }, () => setItem(null));
  };

  const open = orders.filter((o) => o.status === "placed" && (filter === "all" || o.departmentId === filter));
  const past = orders.filter((o) => o.status !== "placed" && (filter === "all" || o.departmentId === filter));

  return (
    <div className="depPage">
      <nav className="prcNav" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "current" : ""} onClick={() => setTab("orders")}>{t("dep.tab.orders")}{orders.some((o) => o.status === "placed") ? ` (${orders.filter((o) => o.status === "placed").length})` : ""}</button>
        <button type="button" role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? "current" : ""} onClick={() => setTab("catalog")}>{t("dep.tab.catalog")}</button>
        <Link href="/pms/guest-messages">{t("nav.guestMessages")}</Link>
      </nav>
      <p className="notice" role="status">{msg}</p>

      {tab === "orders" ? (
        <>
          {departments.length > 1 && <div className="depFilter"><button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>{t("dep.all")}</button>{departments.map((d) => <button type="button" key={d.id} className={filter === d.id ? "on" : ""} onClick={() => setFilter(d.id)}><DepartmentIcon icon={d.icon} />{d.nameEl}</button>)}</div>}
          {open.length === 0 && <p className="muted">{t("dep.noOpen")}</p>}
          <div className="goList">
            {open.map((o) => (
              <article key={o.id} className="card goItem st-pending">
                <div className="goMain">
                  <b><DepartmentIcon icon={o.icon} /> {o.title}</b>
                  <span>{o.room ? t("hkb.room", { code: o.room }) : ""} · {o.guest} · <Link href={`/pms/reservations?q=${encodeURIComponent(o.reference)}`}>{o.reference}</Link></span>
                  {o.mode === "appointment" && o.date && <span>📅 {o.date.split("-").reverse().join("/")} {o.time}–{o.endTime}</span>}
                  {o.note && <span>📝 {o.note}</span>}
                  <small className="muted">{when(o.createdAt)} · {t("dep.charged")}</small>
                </div>
                <strong className="goAmount">{money(o.amountCents)}</strong>
                {canHandle && <div className="goActions">
                  <button type="button" className="primaryAction" disabled={busy} onClick={() => void post({ action: "order_done", id: o.id })}>✓ {t(o.mode === "appointment" ? "dep.doneAppt" : "dep.delivered")}</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => { const reason = prompt(t("dep.cancelReason")); if (reason !== null) void post({ action: "order_cancel", id: o.id, reason }); }}>{t("dep.cancelRefund")}</button>
                </div>}
              </article>
            ))}
          </div>
          {past.length > 0 && <div className="card"><h2>{t("dep.history")}</h2><div className="tableWrap"><table><tbody>{past.map((o) => (
            <tr key={o.id}><td>{when(o.createdAt)}</td><td><b>{o.room ?? ""}</b></td><td>{o.title}{o.note ? <small> · {o.note}</small> : null}</td><td>{o.guest}</td><td>{money(o.amountCents)}</td><td className="muted">{t(o.status === "done" ? "dep.st.done" : "dep.st.cancelled")}{o.handledBy ? ` · ${o.handledBy}` : ""}{o.cancelReason ? ` · ${o.cancelReason}` : ""}</td></tr>
          ))}</tbody></table></div></div>}
        </>
      ) : (
        <>
          {canEdit && !dept && <button type="button" className="primaryAction" onClick={() => setDept(newDept())}>+ {t("dep.addDept")}</button>}
          {dept && (
            <div className="card depForm">
              <h2>{dept.id ? t("dep.editDept") : t("dep.addDept")}</h2>
              <div className="formGrid">
                <label>{t("dep.nameEl")}<input value={dept.nameEl} maxLength={80} onChange={(e) => setDept({ ...dept, nameEl: e.target.value })} placeholder="Μπαρ πισίνας" /></label>
                <label>{t("dep.nameEn")}<input value={dept.nameEn} maxLength={80} onChange={(e) => setDept({ ...dept, nameEn: e.target.value })} placeholder="Pool bar" /></label>
                <label>{t("dep.descEl")}<textarea value={dept.descriptionEl} maxLength={400} rows={2} onChange={(e) => setDept({ ...dept, descriptionEl: e.target.value })} /></label>
                <label>{t("dep.descEn")}<textarea value={dept.descriptionEn} maxLength={400} rows={2} onChange={(e) => setDept({ ...dept, descriptionEn: e.target.value })} /></label>
                <label>{t("dep.mode")}<select value={dept.mode} onChange={(e) => setDept({ ...dept, mode: e.target.value as DepartmentMode })}><option value="order">{t("dep.mode.order")}</option><option value="appointment">{t("dep.mode.appointment")}</option></select></label>
                <div className="depHours"><label>{t("dep.openFrom")}<input type="time" value={dept.openFrom} onChange={(e) => setDept({ ...dept, openFrom: e.target.value })} /></label><label>{t("dep.openTo")}<input type="time" value={dept.openTo} onChange={(e) => setDept({ ...dept, openTo: e.target.value })} /></label></div>
                {dept.mode === "appointment" && <label>{t("dep.capacity")}<input type="number" min={1} max={50} value={dept.capacity} onChange={(e) => setDept({ ...dept, capacity: Math.max(1, Number(e.target.value) || 1) })} /><small className="muted">{t("dep.capacityHint")}</small></label>}
                <label>{t("dep.order")}<input type="number" min={0} max={999} value={dept.sortOrder} onChange={(e) => setDept({ ...dept, sortOrder: Number(e.target.value) || 0 })} /></label>
              </div>
              <div className="depIcons" role="radiogroup" aria-label={t("dep.icon")}>{departmentIcons.map((i) => <button type="button" role="radio" aria-checked={dept.icon === i} key={i} className={dept.icon === i ? "on" : ""} onClick={() => setDept({ ...dept, icon: i })}><DepartmentIcon icon={i} /></button>)}</div>
              <label className="check"><input type="checkbox" checked={dept.active} onChange={(e) => setDept({ ...dept, active: e.target.checked })} />{t("dep.active")}</label>
              <div className="actions"><button type="button" className="primaryAction" disabled={busy || !dept.nameEl.trim()} onClick={saveDept}>{t("dep.save")}</button><button type="button" className="secondaryButton" onClick={() => setDept(null)}>{t("dep.cancel")}</button></div>
            </div>
          )}
          {departments.length === 0 && !dept && <div className="card"><p className="muted">{t("dep.empty")}</p></div>}
          {departments.map((d) => (
            <div key={d.id} className={`card depCard${d.active ? "" : " inactive"}`}>
              <div className="depHead">
                <span className="depIcon"><DepartmentIcon icon={d.icon} /></span>
                <div><h2>{d.nameEl}{d.nameEn ? <small> · {d.nameEn}</small> : null}</h2><small className="muted">{t(d.mode === "appointment" ? "dep.mode.appointment" : "dep.mode.order")} · {d.openFrom}–{d.openTo}{d.mode === "appointment" ? ` · ${t("dep.capacityShort", { n: String(d.capacity) })}` : ""}{d.active ? "" : ` · ${t("dep.inactive")}`}</small></div>
                {canEdit && <div className="depHeadActions"><button type="button" className="secondaryButton" onClick={() => { setDept(d); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("dep.edit")}</button><button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("dep.removeDeptConfirm", { name: d.nameEl }))) void post({ action: "remove_department", id: d.id }); }}>{t("dep.remove")}</button></div>}
              </div>
              {d.items.length === 0 && <p className="muted">{t("dep.noItems")}</p>}
              {d.items.length > 0 && <div className="tableWrap"><table className="depItems"><thead><tr><th>{t("dep.item")}</th><th>{t("dep.price")}</th>{d.mode === "appointment" && <th>{t("dep.duration")}</th>}<th /></tr></thead><tbody>
                {d.items.map((i: DepartmentItem) => (
                  <tr key={i.id} className={i.active ? "" : "inactive"}>
                    <td><b>{i.nameEl}</b>{i.nameEn && <small className="muted"> · {i.nameEn}</small>}{i.descriptionEl && <><br /><small className="muted">{i.descriptionEl}</small></>}{!i.active && <small className="muted"> · {t("dep.inactive")}</small>}</td>
                    <td>{money(i.priceCents)}</td>
                    {d.mode === "appointment" && <td>{i.durationMin}′</td>}
                    <td className="depRowActions">{canEdit && <><button type="button" className="secondaryButton" onClick={() => setItem({ ...i, price: (i.priceCents / 100).toFixed(2) })}>{t("dep.edit")}</button> <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("dep.removeItemConfirm", { name: i.nameEl }))) void post({ action: "remove_item", id: i.id }); }}>{t("dep.remove")}</button></>}</td>
                  </tr>
                ))}
              </tbody></table></div>}
              {item && item.departmentId === d.id && (
                <div className="depItemForm">
                  <div className="formGrid">
                    <label>{t("dep.itemEl")}<input value={item.nameEl} maxLength={120} onChange={(e) => setItem({ ...item, nameEl: e.target.value })} /></label>
                    <label>{t("dep.itemEn")}<input value={item.nameEn} maxLength={120} onChange={(e) => setItem({ ...item, nameEn: e.target.value })} /></label>
                    <label>{t("dep.descEl")}<input value={item.descriptionEl} maxLength={400} onChange={(e) => setItem({ ...item, descriptionEl: e.target.value })} /></label>
                    <label>{t("dep.descEn")}<input value={item.descriptionEn} maxLength={400} onChange={(e) => setItem({ ...item, descriptionEn: e.target.value })} /></label>
                    <label>{t("dep.price")} (€)<input inputMode="decimal" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} placeholder="8.50" /></label>
                    {d.mode === "appointment" && <label>{t("dep.duration")}<input type="number" min={15} max={600} step={15} value={item.durationMin} onChange={(e) => setItem({ ...item, durationMin: Number(e.target.value) || 0 })} /></label>}
                    <label>{t("dep.order")}<input type="number" min={0} max={999} value={item.sortOrder} onChange={(e) => setItem({ ...item, sortOrder: Number(e.target.value) || 0 })} /></label>
                  </div>
                  <label className="check"><input type="checkbox" checked={item.active} onChange={(e) => setItem({ ...item, active: e.target.checked })} />{t("dep.available")}</label>
                  <div className="actions"><button type="button" className="primaryAction" disabled={busy || !item.nameEl.trim() || !item.price.trim()} onClick={saveItem}>{t("dep.save")}</button><button type="button" className="secondaryButton" onClick={() => setItem(null)}>{t("dep.cancel")}</button></div>
                </div>
              )}
              {canEdit && (!item || item.departmentId !== d.id) && <button type="button" className="secondaryButton" onClick={() => setItem(newItem(d))}>+ {t(d.mode === "appointment" ? "dep.addService" : "dep.addProduct")}</button>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
