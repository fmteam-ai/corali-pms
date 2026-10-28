"use client";
import { useCallback, useEffect, useState } from "react";
import type { OfferView, OrderView, PartnerView } from "@/lib/partners";
import { categoryLabels, partnerCategories, type PartnerInput } from "@/lib/partners-core";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

type Report = { partnerId: number; name: string; percent: number; orders: number; ordersTotalCents: number; uses: number; usesTotalCents: number; commissionCents: number }[];
type State = { enabled: boolean; partners: PartnerView[]; offers: OfferView[]; orders: OrderView[]; report: Report; month: string };
type Tab = "list" | "offers" | "orders" | "report";

const L = {
  el: { onOff: "Ενεργοποίηση: συνεργαζόμενες επιχειρήσεις στην εφαρμογή των πελατών και εφαρμογή επιχειρήσεων", offHint: "Απενεργοποιημένο: οι πελάτες δεν βλέπουν επιχειρήσεις και οι επιχειρήσεις δεν μπορούν να συνδεθούν. Μπορείτε να τις ετοιμάσετε πρώτα και να το ενεργοποιήσετε μετά.", list: "Επιχειρήσεις", offers: "Προσφορές", orders: "Παραγγελίες", report: "Προμήθειες", add: "+ Νέα επιχείρηση", none: "Δεν υπάρχουν ακόμα επιχειρήσεις.", name: "Επωνυμία", category: "Είδος", descEl: "Περιγραφή (ελληνικά)", descEn: "Description (English)", phone: "Τηλέφωνο", email: "Email", address: "Διεύθυνση", website: "Ιστοσελίδα", menuUrl: "Online κατάλογος (σύνδεσμος)", hours: "Ωράριο", delivery: "Παράδοση στο ξενοδοχείο", pickup: "Παραλαβή από το κατάστημα", cash: "Μετρητά", pos: "Κάρτα (POS) στην παραλαβή", link: "Σύνδεσμος πληρωμής από την επιχείρηση", commission: "Προμήθεια ξενοδοχείου %", active: "Ενεργή (εμφανίζεται στους πελάτες)", sort: "Σειρά", save: "Αποθήκευση", cancel: "Άκυρο", edit: "Επεξεργασία", remove: "Διαγραφή", removeQ: "Διαγραφή της επιχείρησης;", logo: "Λογότυπο", logoPick: "Επιλογή εικόνας", logoDel: "Αφαίρεση", catalogue: "Κατάλογος", section: "Κατηγορία", nameEl: "Όνομα", nameEn: "Name (EN)", price: "Τιμή €", addItem: "Προσθήκη", users: "Λογαριασμοί εφαρμογής", userName: "Όνομα", create: "Δημιουργία", reset: "Νέος κωδικός", disable: "Απενεργοποίηση", enable: "Ενεργοποίηση", pwd: "Κωδικός (φαίνεται μόνο τώρα — δώστε τον στην επιχείρηση):", appLink: "Εφαρμογή επιχειρήσεων:", lastLogin: "τελ. σύνδεση", never: "ποτέ", pay: "Πληρωμή", fulfil: "Εξυπηρέτηση", saved: "Αποθηκεύτηκε ✓", failed: "Δεν αποθηκεύτηκε", approve: "Έγκριση", reject: "Απόρριψη", reason: "Αιτία απόρριψης (θα τη δει η επιχείρηση):", pending: "Περιμένουν έγκριση", status: { pending: "Περιμένει", approved: "Εγκρίθηκε", rejected: "Απορρίφθηκε", withdrawn: "Αποσύρθηκε" } as Record<string, string>, guestsOnly: "Μόνο για πελάτες του ξενοδοχείου", uses: "χρήσεις/κράτηση", unlimited: "απεριόριστες", code: "κωδικός", noOffers: "Δεν υπάρχουν προσφορές.", noOrders: "Δεν υπάρχουν παραγγελίες.", ostatus: { placed: "Νέα", accepted: "Αποδεκτή", ready: "Έτοιμη", completed: "Ολοκληρώθηκε", declined: "Απορρίφθηκε", cancelled: "Ακυρώθηκε" } as Record<string, string>, month: "Μήνας", repOrders: "Παραγγελίες (ολοκλ.)", repUses: "Χρήσεις κάρτας πελάτη", repCommission: "Προμήθεια", total: "Σύνολο", openOrders: "ανοιχτές παραγγελίες", items: "προϊόντα", paid: "πληρώθηκε", emailTaken: "Το email χρησιμοποιείται ήδη.", passHelp: "Η επιχείρηση επαληθεύει ότι κάποιος είναι πελάτης σας σκανάροντας την «Κάρτα πελάτη» (QR) από την εφαρμογή του ή γράφοντας τον 6ψήφιο κωδικό της, που αλλάζει κάθε λεπτό." },
  en: { onOff: "Enable: partner businesses in the guest app and the partner app", offHint: "Off: guests see no businesses and businesses cannot sign in. You can prepare them first and turn this on later.", list: "Businesses", offers: "Offers", orders: "Orders", report: "Commission", add: "+ New business", none: "No businesses yet.", name: "Name", category: "Type", descEl: "Περιγραφή (Greek)", descEn: "Description (English)", phone: "Phone", email: "Email", address: "Address", website: "Website", menuUrl: "Online catalogue (link)", hours: "Opening hours", delivery: "Delivery to the hotel", pickup: "Pick-up at the business", cash: "Cash", pos: "Card (POS) on collection", link: "Payment link from the business", commission: "Hotel commission %", active: "Active (shown to guests)", sort: "Order", save: "Save", cancel: "Cancel", edit: "Edit", remove: "Delete", removeQ: "Delete this business?", logo: "Logo", logoPick: "Choose image", logoDel: "Remove", catalogue: "Catalogue", section: "Section", nameEl: "Όνομα (GR)", nameEn: "Name", price: "Price €", addItem: "Add", users: "App logins", userName: "Name", create: "Create", reset: "New password", disable: "Disable", enable: "Enable", pwd: "Password (shown only now — give it to the business):", appLink: "Partner app:", lastLogin: "last login", never: "never", pay: "Payment", fulfil: "Service", saved: "Saved ✓", failed: "Not saved", approve: "Approve", reject: "Reject", reason: "Reason (the business will see it):", pending: "Awaiting approval", status: { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" } as Record<string, string>, guestsOnly: "Hotel guests only", uses: "uses/booking", unlimited: "unlimited", code: "code", noOffers: "No offers.", noOrders: "No orders.", ostatus: { placed: "New", accepted: "Accepted", ready: "Ready", completed: "Completed", declined: "Declined", cancelled: "Cancelled" } as Record<string, string>, month: "Month", repOrders: "Orders (completed)", repUses: "Guest pass uses", repCommission: "Commission", total: "Total", openOrders: "open orders", items: "items", paid: "paid", emailTaken: "This email is already in use.", passHelp: "The business checks that someone is your guest by scanning the guest pass (QR) in the guest's app or typing its 6-digit code, which changes every minute." },
};

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const blank: PartnerInput = { name: "", category: "restaurant", descriptionEl: "", descriptionEn: "", phone: "", email: "", address: "", website: "", menuUrl: "", hours: "", delivery: false, pickup: true, acceptsCash: true, acceptsPos: true, acceptsLink: false, commissionPercent: 0, active: true, sortOrder: 0 };

export function Partners({ lang, canEdit }: { lang: PmsLang; canEdit: boolean }) {
  const l = lang === "el" ? L.el : L.en;
  const [data, setData] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [month, setMonth] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id?: number; f: PartnerInput } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [password, setPassword] = useState<{ email: string; password: string } | null>(null);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  const dmy = (d: string) => d.split("-").reverse().join("/");

  const load = useCallback(async (m?: string) => {
    const r = await fetch(`/api/pms/partners${m ? `?month=${m}` : ""}`, { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (d?.ok) { setData(d); setMonth(d.month); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); const t = new URLSearchParams(location.search).get("tab"); if (t && ["list", "offers", "orders", "report"].includes(t)) setTab(t as Tab); }); }, [load]);

  async function post(body: object) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setData({ ...d, month: data?.month ?? d.month, report: data && data.month !== d.month ? data.report : d.report }); setMsg(l.saved); return d; }
      setMsg(d.error === "EMAIL_TAKEN" ? l.emailTaken : `${l.failed}${d.error ? ` (${d.error})` : ""}`);
      return null;
    } finally { setBusy(false); }
  }

  if (!data) return <p className="muted">…</p>;
  const pending = data.offers.filter((o) => o.status === "pending").length;
  const origin = typeof window === "undefined" ? "" : location.origin.replace("//pms.", "//booking.");
  return (
    <div className="ptPage">
      <section className={`card ptSwitch${data.enabled ? " on" : ""}`}>
        <label className="apSwitch"><input type="checkbox" disabled={!canEdit || busy} checked={data.enabled} onChange={(e) => void post({ action: "enabled", enabled: e.target.checked })} /> <b>{l.onOff}</b></label>
        {!data.enabled && <small className="muted">{l.offHint}</small>}
      </section>
      <nav className="ptTabs">
        {(["list", "offers", "orders", "report"] as Tab[]).map((k) => <button type="button" key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l[k]}{k === "offers" && pending > 0 ? <span className="ptCount">{pending}</span> : null}</button>)}
      </nav>
      {msg && <p className="notice" role="status">{msg}</p>}
      {password && <p className="notice ptPwd">{l.pwd} <b>{password.email}</b> · <code>{password.password}</code> <button type="button" className="secondaryButton" onClick={() => setPassword(null)}>OK</button></p>}

      {tab === "list" && (
        <>
          <section className="card ptHelp"><small className="muted">{l.appLink} <a href={`${origin}/partner`} target="_blank" rel="noreferrer">{origin}/partner</a> · {l.passHelp}</small></section>
          {canEdit && !edit && <div><button type="button" className="primaryAction" onClick={() => setEdit({ f: { ...blank } })}>{l.add}</button></div>}
          {edit && (
            <form className="card ptForm" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "save", id: edit.id, partner: edit.f })) setEdit(null); }}>
              <div className="ptGrid">
                <label>{l.name}<input required minLength={2} maxLength={120} value={edit.f.name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} /></label>
                <label>{l.category}<select value={edit.f.category} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, category: e.target.value as PartnerInput["category"] } })}>{partnerCategories.map((c) => <option key={c} value={c}>{categoryLabels[c].icon} {categoryLabels[c][lang === "el" ? "el" : "en"]}</option>)}</select></label>
                <label>{l.phone}<input maxLength={40} value={edit.f.phone} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, phone: e.target.value } })} /></label>
                <label>{l.email}<input type="email" maxLength={200} value={edit.f.email} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, email: e.target.value } })} /></label>
                <label>{l.address}<input maxLength={200} value={edit.f.address} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, address: e.target.value } })} /></label>
                <label>{l.hours}<input maxLength={200} value={edit.f.hours} placeholder="12:00–23:30" onChange={(e) => setEdit({ ...edit, f: { ...edit.f, hours: e.target.value } })} /></label>
                <label>{l.website}<input type="url" pattern="https://.*" maxLength={500} value={edit.f.website} placeholder="https://" onChange={(e) => setEdit({ ...edit, f: { ...edit.f, website: e.target.value } })} /></label>
                <label>{l.menuUrl}<input type="url" pattern="https://.*" maxLength={500} value={edit.f.menuUrl} placeholder="https://" onChange={(e) => setEdit({ ...edit, f: { ...edit.f, menuUrl: e.target.value } })} /></label>
              </div>
              <label>{l.descEl}<textarea rows={3} maxLength={1500} value={edit.f.descriptionEl} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, descriptionEl: e.target.value } })} /></label>
              <label>{l.descEn}<textarea rows={3} maxLength={1500} value={edit.f.descriptionEn} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, descriptionEn: e.target.value } })} /></label>
              <div className="ptChecks">
                {([["delivery", l.delivery], ["pickup", l.pickup], ["acceptsCash", l.cash], ["acceptsPos", l.pos], ["acceptsLink", l.link], ["active", l.active]] as [keyof PartnerInput, string][]).map(([k, t]) => <label className="inline" key={k}><input type="checkbox" checked={Boolean(edit.f[k])} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, [k]: e.target.checked } })} /> {t}</label>)}
              </div>
              <div className="apRow">
                <label className="inline">{l.commission} <input type="number" min={0} max={50} step={0.5} value={edit.f.commissionPercent} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, commissionPercent: Number(e.target.value) || 0 } })} /></label>
                <label className="inline">{l.sort} <input type="number" min={0} max={999} value={edit.f.sortOrder} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, sortOrder: Number(e.target.value) || 0 } })} /></label>
              </div>
              <div className="apRow"><button className="primaryAction" disabled={busy}>{l.save}</button><button type="button" className="secondaryButton" onClick={() => setEdit(null)}>{l.cancel}</button></div>
            </form>
          )}
          {!data.partners.length && !edit && <p className="muted">{l.none}</p>}
          {data.partners.map((p) => (
            <section key={p.id} className={`card ptPartner${p.active ? "" : " off"}`}>
              <div className="ptHead">
                {p.logo ? <img src={p.logo} alt="" className="ptLogo" /> : <span className="ptLogo ptIcon">{categoryLabels[p.category].icon}</span>}
                <div className="ptMeta">
                  <b>{p.name}</b>
                  <small className="muted">{categoryLabels[p.category][lang === "el" ? "el" : "en"]} · {p.items.length} {l.items} · {l.commission.replace(" %", "")}: {p.commissionPercent}%{p.openOrders ? ` · ${p.openOrders} ${l.openOrders}` : ""}</small>
                  <small className="muted">{[p.phone, p.address, p.hours].filter(Boolean).join(" · ")}</small>
                </div>
                <div className="apRow">
                  <button type="button" className="secondaryButton" onClick={() => setOpen(open === p.id ? null : p.id)}>{l.catalogue} / {l.users}</button>
                  {canEdit && <button type="button" className="secondaryButton" onClick={() => { const { id, ...rest } = p; setEdit({ id, f: { name: rest.name, category: rest.category, descriptionEl: rest.descriptionEl, descriptionEn: rest.descriptionEn, phone: rest.phone, email: rest.email, address: rest.address, website: rest.website, menuUrl: rest.menuUrl, hours: rest.hours, delivery: rest.delivery, pickup: rest.pickup, acceptsCash: rest.acceptsCash, acceptsPos: rest.acceptsPos, acceptsLink: rest.acceptsLink, commissionPercent: rest.commissionPercent, active: rest.active, sortOrder: rest.sortOrder } }); scrollTo({ top: 0, behavior: "smooth" }); }}>{l.edit}</button>}
                  {canEdit && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => confirm(l.removeQ) && void post({ action: "remove", id: p.id })}>{l.remove}</button>}
                </div>
              </div>
              {open === p.id && <PartnerDetail p={p} l={l} canEdit={canEdit} busy={busy} post={post} onPassword={setPassword} when={when} />}
            </section>
          ))}
        </>
      )}

      {tab === "offers" && (
        <section className="card">
          {!data.offers.length && <p className="muted">{l.noOffers}</p>}
          {[...data.offers].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt - a.createdAt).map((o) => (
            <article key={o.id} className={`ptOffer st-${o.status}`}>
              <div className="ptOfferMain">
                <b>{o.partner}: {lang === "el" ? o.titleEl || o.titleEn : o.titleEn || o.titleEl}</b>
                {(o.bodyEl || o.bodyEn) && <small>{lang === "el" ? o.bodyEl || o.bodyEn : o.bodyEn || o.bodyEl}</small>}
                <small className="muted">{dmy(o.startsOn)} → {dmy(o.endsOn)}{o.timeFrom ? ` · ${o.timeFrom}–${o.timeTo}` : ""}{o.discountPercent ? ` · −${o.discountPercent}%` : ""}{o.code ? ` · ${l.code} ${o.code}` : ""} · {o.maxUses ? `${o.maxUses} ${l.uses}` : `${l.uses}: ${l.unlimited}`}{o.guestsOnly ? ` · ${l.guestsOnly}` : ""}</small>
                {o.status === "rejected" && o.rejectReason && <small className="muted">✕ {o.rejectReason}</small>}
              </div>
              <span className={`ptBadge st-${o.status}`}>{l.status[o.status] ?? o.status}</span>
              {canEdit && o.status === "pending" && <div className="apRow"><button type="button" className="primaryAction" disabled={busy} onClick={() => void post({ action: "offer_decide", id: o.id, approve: true })}>{l.approve}</button><button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { const reason = prompt(l.reason); if (reason !== null) void post({ action: "offer_decide", id: o.id, approve: false, reason }); }}>{l.reject}</button></div>}
              {canEdit && o.status === "approved" && <button type="button" className="secondaryButton" disabled={busy} onClick={() => { const reason = prompt(l.reason); if (reason !== null) void post({ action: "offer_decide", id: o.id, approve: false, reason }); }}>{l.reject}</button>}
            </article>
          ))}
        </section>
      )}

      {tab === "orders" && (
        <section className="card">
          {!data.orders.length ? <p className="muted">{l.noOrders}</p> : (
            <table className="apTable ptTable">
              <thead><tr><th>#</th><th>{l.list}</th><th>Guest</th><th>{l.fulfil}</th><th>{l.total}</th><th>{l.pay}</th><th>{l.repCommission}</th><th></th></tr></thead>
              <tbody>{data.orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.id}<br /><small className="muted">{when(o.createdAt)}</small></td>
                  <td>{o.partner}</td>
                  <td>{o.guest}{o.room ? ` · ${o.room}` : ""}<br /><small className="muted">{o.reference}</small></td>
                  <td>{o.fulfilment === "delivery" ? `🚚 ${l.delivery}` : `🏃 ${l.pickup}`}{o.wantedAt ? <><br /><small className="muted">{o.wantedAt}</small></> : null}<br /><small className="muted">{o.lines.map((x) => `${x.qty}× ${x.name}`).join(", ")}</small></td>
                  <td>{euro(o.totalCents)}{o.discountCents > 0 && <><br /><small className="muted">−{euro(o.discountCents)}{o.code ? ` (${o.code})` : ""}</small></>}</td>
                  <td>{o.payMethod === "cash" ? l.cash : o.payMethod === "pos" ? "POS" : "Link"}{o.paid ? ` · ${l.paid} ✓` : ""}</td>
                  <td>{euro(o.commissionCents)}</td>
                  <td><span className={`ptBadge st-${o.status}`}>{l.ostatus[o.status] ?? o.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}

      {tab === "report" && (
        <section className="card">
          <div className="apRow"><label className="inline">{l.month} <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); if (e.target.value) void load(e.target.value); }} /></label></div>
          <table className="apTable ptTable">
            <thead><tr><th>{l.list}</th><th>%</th><th>{l.repOrders}</th><th>{l.repUses}</th><th>{l.repCommission}</th></tr></thead>
            <tbody>
              {data.report.map((r) => <tr key={r.partnerId}><td>{r.name}</td><td>{r.percent}%</td><td>{r.orders} · {euro(r.ordersTotalCents)}</td><td>{r.uses} · {euro(r.usesTotalCents)}</td><td><b>{euro(r.commissionCents)}</b></td></tr>)}
              <tr className="ptTotal"><td>{l.total}</td><td></td><td>{euro(data.report.reduce((s, r) => s + r.ordersTotalCents, 0))}</td><td>{euro(data.report.reduce((s, r) => s + r.usesTotalCents, 0))}</td><td><b>{euro(data.report.reduce((s, r) => s + r.commissionCents, 0))}</b></td></tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

type Labels = typeof L.el;
function PartnerDetail({ p, l, canEdit, busy, post, onPassword, when }: { p: PartnerView; l: Labels; canEdit: boolean; busy: boolean; post: (b: object) => Promise<Record<string, unknown> | null>; onPassword: (x: { email: string; password: string }) => void; when: (ms: number) => string }) {
  const empty = { section: "", nameEl: "", nameEn: "", description: "", priceEur: "", active: true };
  const [item, setItem] = useState<{ id?: number } & typeof empty>(empty);
  const [user, setUser] = useState({ email: "", name: "" });
  async function logo(file: File | undefined) {
    if (!file) return;
    const b64 = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.readAsDataURL(file); });
    await post({ action: "logo", id: p.id, image: b64 });
  }
  return (
    <div className="ptDetail">
      {canEdit && <div className="apRow"><span>{l.logo}:</span><label className="secondaryButton ptFile">{l.logoPick}<input type="file" accept="image/*" hidden onChange={(e) => void logo(e.target.files?.[0])} /></label>{p.logo && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "logo", id: p.id, image: null })}>{l.logoDel}</button>}</div>}
      <h3>{l.catalogue}</h3>
      {p.menuUrl && <small><a href={p.menuUrl} target="_blank" rel="noreferrer">{p.menuUrl}</a></small>}
      <table className="apTable ptTable">
        <tbody>
          {p.items.map((i) => (
            <tr key={i.id} className={i.active ? "" : "off"}><td>{i.section}</td><td>{i.nameEl}{i.nameEn && i.nameEn !== i.nameEl ? ` / ${i.nameEn}` : ""}<br /><small className="muted">{i.description}</small></td><td>{euro(i.priceCents)}</td>
              <td>{canEdit && <><button type="button" className="secondaryButton" onClick={() => setItem({ id: i.id, section: i.section, nameEl: i.nameEl, nameEn: i.nameEn, description: i.description, priceEur: String(i.priceCents / 100), active: i.active })}>{l.edit}</button> <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => void post({ action: "item_remove", partnerId: p.id, id: i.id })}>✕</button></>}</td></tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <form className="ptItemForm" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "item_save", partnerId: p.id, id: item.id, item: { section: item.section, nameEl: item.nameEl, nameEn: item.nameEn, description: item.description, priceEur: Number(item.priceEur) || 0, active: item.active } })) setItem(empty); }}>
          <input placeholder={l.section} maxLength={60} value={item.section} onChange={(e) => setItem({ ...item, section: e.target.value })} />
          <input placeholder={l.nameEl} maxLength={120} value={item.nameEl} onChange={(e) => setItem({ ...item, nameEl: e.target.value })} />
          <input placeholder={l.nameEn} maxLength={120} value={item.nameEn} onChange={(e) => setItem({ ...item, nameEn: e.target.value })} />
          <input placeholder={l.descEn.split(" ")[0]} maxLength={400} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
          <input placeholder={l.price} inputMode="decimal" required value={item.priceEur} onChange={(e) => setItem({ ...item, priceEur: e.target.value.replace(",", ".") })} />
          <label className="inline"><input type="checkbox" checked={item.active} onChange={(e) => setItem({ ...item, active: e.target.checked })} /> ✓</label>
          <button className="primaryAction" disabled={busy || (!item.nameEl && !item.nameEn)}>{item.id ? l.save : l.addItem}</button>
          {item.id && <button type="button" className="secondaryButton" onClick={() => setItem(empty)}>{l.cancel}</button>}
        </form>
      )}
      <h3>{l.users}</h3>
      {p.users.map((u) => (
        <div key={u.id} className={`apRow ptUser${u.active ? "" : " off"}`}>
          <span><b>{u.email}</b> {u.name} · <small className="muted">{l.lastLogin}: {u.lastLoginAt ? when(u.lastLoginAt) : l.never}</small></span>
          {canEdit && <><button type="button" className="secondaryButton" disabled={busy} onClick={async () => { const d = await post({ action: "user_reset", id: u.id }); if (d?.password) onPassword({ email: u.email, password: String(d.password) }); }}>{l.reset}</button>
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "user_active", id: u.id, active: !u.active })}>{u.active ? l.disable : l.enable}</button></>}
        </div>
      ))}
      {canEdit && (
        <form className="apRow" onSubmit={async (e) => { e.preventDefault(); const d = await post({ action: "user_create", partnerId: p.id, ...user }); if (d?.password) { onPassword({ email: user.email, password: String(d.password) }); setUser({ email: "", name: "" }); } }}>
          <input type="email" required placeholder={l.email} value={user.email} onChange={(e) => setUser({ ...user, email: e.target.value })} />
          <input placeholder={l.userName} maxLength={80} value={user.name} onChange={(e) => setUser({ ...user, name: e.target.value })} />
          <button className="primaryAction" disabled={busy}>{l.create}</button>
        </form>
      )}
    </div>
  );
}
