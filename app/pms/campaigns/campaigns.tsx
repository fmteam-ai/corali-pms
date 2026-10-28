"use client";
import { useCallback, useEffect, useState } from "react";
import type { CampaignView } from "@/lib/campaigns";
import { pmsLocale, type PmsLang } from "@/lib/pms-i18n";

type Lang = "el" | "en" | "fr" | "de" | "it" | "es";
type Preset = { icon: string } & Record<Lang, { subject: string; body: string }>;
type State = { campaigns: CampaignView[]; unsubscribes: { channel: string; address: string; source: string; at: number }[]; presets: Record<string, Preset>; emailReady: boolean; whatsappReady: boolean };
type Draft = { id?: number; name: string; sendEmail: boolean; sendWhatsapp: boolean; audience: { stayFrom: string; stayTo: string; countries: string; languages: Lang[]; minStays: number }; content: Partial<Record<Lang, { subject: string; body: string }>>; whatsappTemplate: string; whatsappLanguages: string; ratePerMinute: number; hasImage: boolean };
type Preview = Record<"email" | "whatsapp", { total: number; byLang: Record<string, number> }>;

const langs: Lang[] = ["el", "en", "fr", "de", "it", "es"];
const langNames: Record<Lang, string> = { el: "Ελληνικά", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", es: "Español" };

const L = {
  el: { newC: "+ Νέο μήνυμα", none: "Δεν υπάρχουν ακόμα μαζικά μηνύματα.", name: "Όνομα (για εσάς)", channels: "Κανάλια", email: "Email", whatsapp: "WhatsApp", audience: "Παραλήπτες", audienceHelp: "Μόνο πελάτες που έχουν ήδη μείνει και έχουν συμφωνήσει να λαμβάνουν νέα / προσφορές (στην κράτηση ή στο online check-in), εκτός όσων έχουν διαγραφεί.", stayFrom: "Διαμονή από", stayTo: "έως", countries: "Χώρες (π.χ. GR, DE, IT — κενό = όλες)", languages: "Γλώσσες (καμία = όλες)", minStays: "Τουλάχιστον διαμονές", count: "Υπολογισμός παραληπτών", recipients: "παραλήπτες", templates: "Έτοιμα πρότυπα", templatesHelp: "Συμπληρώνει θέμα και κείμενο σε όλες τις γλώσσες· μετά αλλάξτε ό,τι θέλετε.", christmas: "Χριστούγεννα", newyear: "Καλή Χρονιά", easter: "Πάσχα", season: "Νέα σεζόν", offer: "Προσφορά", message: "Μήνυμα email", messageHelp: "Το {name} γίνεται το μικρό όνομα του πελάτη. Κάθε πελάτης παίρνει το μήνυμα στη γλώσσα του· αν μια γλώσσα μείνει κενή, στέλνεται η αγγλική.", subject: "Θέμα", body: "Κείμενο", photo: "Φωτογραφία (προαιρετική)", photoSave: "Αποθηκεύστε πρώτα το μήνυμα για να προσθέσετε φωτογραφία.", pick: "Επιλογή εικόνας", removePhoto: "Αφαίρεση", waTitle: "WhatsApp (εγκεκριμένο πρότυπο Meta)", waHelp: "Το WhatsApp επιτρέπει μαζικά μηνύματα μόνο με πρότυπο κατηγορίας Marketing εγκεκριμένο από τη Meta (WhatsApp Manager → Message templates). Το κείμενο είναι αυτό του προτύπου· η παράμετρος {{1}} γίνεται το μικρό όνομα. Η Meta χρεώνει κάθε μήνυμα.", waName: "Όνομα προτύπου", waLangs: "Γλώσσες προτύπου (π.χ. el, en)", rate: "Μηνύματα ανά λεπτό", rateHelp: "Αργή αποστολή ώστε να μη χαρακτηριστεί spam· οι πάροχοι email (cPanel) συνήθως επιτρέπουν 100–500 την ώρα.", save: "Αποθήκευση", close: "Κλείσιμο", test: "Δοκιμαστική αποστολή", testTo: "Email δοκιμής", sendNow: "Αποστολή τώρα", schedule: "Προγραμματισμός", at: "Ημερομηνία & ώρα", confirmSend: "Αποστολή σε {n} παραλήπτες; Δεν μπορεί να αναιρεθεί για όσα έχουν ήδη σταλεί.", edit: "Επεξεργασία", duplicate: "Αντίγραφο", remove: "Διαγραφή", removeQ: "Διαγραφή του μηνύματος;", cancel: "Διακοπή", cancelQ: "Διακοπή της αποστολής;", report: "Αναφορά", status: { draft: "Πρόχειρο", scheduled: "Προγραμματισμένο", sending: "Αποστέλλεται", sent: "Στάλθηκε", cancelled: "Διακόπηκε" } as Record<string, string>, sent: "στάλθηκαν", failed: "απέτυχαν", pending: "σε αναμονή", skipped: "παραλείφθηκαν", unsubscribed: "διαγραφές", unsubTitle: "Λίστα διαγραφής", unsubHelp: "Όσοι πάτησαν «Διαγραφή από τη λίστα» ή προσθέσατε εσείς. Δεν λαμβάνουν μαζικά μηνύματα (τα μηνύματα κρατήσεων συνεχίζουν).", add: "Προσθήκη", noUnsub: "Κανείς.", saved: "Αποθηκεύτηκε ✓", testSent: "Το δοκιμαστικό στάλθηκε ✓", scheduled: "Προγραμματίστηκε ✓ — η αποστολή γίνεται σταδιακά, λίγα μηνύματα το λεπτό.", noSmtp: "Το email δεν έχει ρυθμιστεί (PMS → Ενσωματώσεις → SMTP).", noWa: "Το WhatsApp δεν έχει συνδεθεί (PMS → Ενσωματώσεις).", errors: { NO_CONTENT: "Γράψτε θέμα και κείμενο τουλάχιστον σε μία γλώσσα.", NO_CHANNEL: "Επιλέξτε email ή WhatsApp.", WHATSAPP_NO_TEMPLATE: "Συμπληρώστε το όνομα και τις γλώσσες του προτύπου WhatsApp.", NOT_DRAFT: "Μόνο πρόχειρα αλλάζουν.", INVALID_ADDRESS: "Μη έγκυρο email ή τηλέφωνο.", RATE_LIMITED: "Πολλές δοκιμές — περιμένετε λίγο.", EMAIL_NOT_CONFIGURED: "Το email δεν έχει ρυθμιστεί." } as Record<string, string>, failedSave: "Δεν ολοκληρώθηκε", started: "Ξεκίνησε", finished: "Ολοκληρώθηκε", when: "Αποστολή", failures: "Αποτυχίες / παραλείψεις" },
  en: { newC: "+ New message", none: "No bulk messages yet.", name: "Name (for you)", channels: "Channels", email: "E-mail", whatsapp: "WhatsApp", audience: "Recipients", audienceHelp: "Only guests who already stayed and agreed to receive news / offers (at booking or online check-in), minus those who unsubscribed.", stayFrom: "Stay from", stayTo: "to", countries: "Countries (e.g. GR, DE, IT — empty = all)", languages: "Languages (none = all)", minStays: "At least stays", count: "Count recipients", recipients: "recipients", templates: "Ready templates", templatesHelp: "Fills subject and text in all languages; then change what you like.", christmas: "Christmas", newyear: "New Year", easter: "Easter", season: "New season", offer: "Offer", message: "E-mail message", messageHelp: "{name} becomes the guest's first name. Each guest gets the message in their language; an empty language sends the English one.", subject: "Subject", body: "Text", photo: "Photo (optional)", photoSave: "Save the message first to add a photo.", pick: "Choose image", removePhoto: "Remove", waTitle: "WhatsApp (approved Meta template)", waHelp: "WhatsApp allows bulk messages only with a Marketing template approved by Meta (WhatsApp Manager → Message templates). The text is the template's; parameter {{1}} becomes the first name. Meta charges each message.", waName: "Template name", waLangs: "Template languages (e.g. el, en)", rate: "Messages per minute", rateHelp: "Slow sending so it is not seen as spam; e-mail hosts (cPanel) usually allow 100–500 an hour.", save: "Save", close: "Close", test: "Send test", testTo: "Test e-mail", sendNow: "Send now", schedule: "Schedule", at: "Date & time", confirmSend: "Send to {n} recipients? Messages already sent cannot be undone.", edit: "Edit", duplicate: "Duplicate", remove: "Delete", removeQ: "Delete this message?", cancel: "Stop", cancelQ: "Stop sending?", report: "Report", status: { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", cancelled: "Stopped" } as Record<string, string>, sent: "sent", failed: "failed", pending: "waiting", skipped: "skipped", unsubscribed: "unsubscribed", unsubTitle: "Unsubscribe list", unsubHelp: "Guests who pressed Unsubscribe or that you added. They get no bulk messages (booking messages continue).", add: "Add", noUnsub: "Nobody.", saved: "Saved ✓", testSent: "Test sent ✓", scheduled: "Scheduled ✓ — sending is gradual, a few messages per minute.", noSmtp: "E-mail is not set up (PMS → Integrations → SMTP).", noWa: "WhatsApp is not connected (PMS → Integrations).", errors: { NO_CONTENT: "Write a subject and text in at least one language.", NO_CHANNEL: "Choose e-mail or WhatsApp.", WHATSAPP_NO_TEMPLATE: "Fill in the WhatsApp template name and languages.", NOT_DRAFT: "Only drafts can change.", INVALID_ADDRESS: "Invalid e-mail or phone.", RATE_LIMITED: "Too many tests — wait a little.", EMAIL_NOT_CONFIGURED: "E-mail is not set up." } as Record<string, string>, failedSave: "Not completed", started: "Started", finished: "Finished", when: "Sending", failures: "Failures / skipped" },
};

const emptyDraft = (): Draft => ({ name: "", sendEmail: true, sendWhatsapp: false, audience: { stayFrom: "", stayTo: "", countries: "", languages: [], minStays: 1 }, content: {}, whatsappTemplate: "", whatsappLanguages: "el, en", ratePerMinute: 20, hasImage: false });
const toDraft = (c: CampaignView): Draft => ({ id: c.id, name: c.name, sendEmail: c.sendEmail, sendWhatsapp: c.sendWhatsapp, audience: { ...c.audience, countries: c.audience.countries.join(", "), languages: c.audience.languages as Lang[] }, content: c.content, whatsappTemplate: c.whatsappTemplate, whatsappLanguages: c.whatsappLanguages, ratePerMinute: c.ratePerMinute, hasImage: c.hasImage });
const audienceOf = (d: Draft) => ({ ...d.audience, countries: d.audience.countries.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z]{2}$/.test(x)) });

export function Campaigns({ lang, canEdit, userEmail }: { lang: PmsLang; canEdit: boolean; userEmail: string }) {
  const l = lang === "el" ? L.el : L.en;
  const [data, setData] = useState<State | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Lang>(lang === "el" ? "el" : "en");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState(userEmail);
  const [at, setAt] = useState("");
  const [failures, setFailures] = useState<{ id: number; rows: { channel: string; address: string; name: string; status: string; error: string }[] } | null>(null);
  const [unsub, setUnsub] = useState({ channel: "email", address: "" });
  const [imgV, setImgV] = useState(0);
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

  const load = useCallback(async () => { const r = await fetch("/api/pms/campaigns", { cache: "no-store" }); const d = await r.json().catch(() => null); if (d?.ok) setData(d); }, []);
  useEffect(() => { queueMicrotask(() => void load()); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);

  async function post(body: object, ok = l.saved) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { if (d.campaigns) setData(d); if (ok) setMsg(ok); return d; }
      setMsg(l.errors[d.error] ?? `${l.failedSave}${d.error ? ` (${d.error}${d.hint ? ` · ${d.hint}` : ""})` : ""}`);
      return null;
    } finally { setBusy(false); }
  }
  const saveDraft = async (d: Draft, ok = l.saved) => {
    const res = await post({ action: "save", id: d.id, campaign: { name: d.name || l.newC.replace("+ ", ""), sendEmail: d.sendEmail, sendWhatsapp: d.sendWhatsapp, audience: audienceOf(d), content: d.content, whatsappTemplate: d.whatsappTemplate.trim(), whatsappLanguages: d.whatsappLanguages, ratePerMinute: d.ratePerMinute } }, ok);
    if (res?.id) setDraft({ ...d, id: Number(res.id) });
    return res;
  };
  async function photo(file: File | undefined) {
    if (!file || !draft?.id) return;
    const b64 = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.readAsDataURL(file); });
    if (await post({ action: "image", id: draft.id, image: b64 })) { setDraft({ ...draft, hasImage: true }); setImgV((v) => v + 1); }
  }
  async function send(later: boolean) {
    if (!draft) return;
    const saved = await saveDraft(draft, "");
    if (!saved) return;
    const p = (await post({ action: "preview", audience: audienceOf(draft) }, ""))?.preview as Preview | undefined;
    const n = (draft.sendEmail ? p?.email.total ?? 0 : 0) + (draft.sendWhatsapp ? p?.whatsapp.total ?? 0 : 0);
    if (!confirm(l.confirmSend.replace("{n}", String(n)))) return;
    const ts = later && at ? new Date(at).getTime() : null;
    if (await post({ action: "schedule", id: Number(saved.id), at: ts }, l.scheduled)) setDraft(null);
  }

  if (!data) return <p className="muted">…</p>;
  const c = draft?.content[tab] ?? { subject: "", body: "" };
  return (
    <div className="cmPage">
      {msg && <p className="notice" role="status">{msg}</p>}
      <section className="card cmReady">
        <span className={data.emailReady ? "ok" : "no"}>✉️ {l.email}: {data.emailReady ? "✓" : l.noSmtp}</span>
        <span className={data.whatsappReady ? "ok" : "no"}>💬 {l.whatsapp}: {data.whatsappReady ? "✓" : l.noWa}</span>
      </section>

      {!draft && canEdit && <div><button type="button" className="primaryAction" onClick={() => { setDraft(emptyDraft()); setPreview(null); }}>{l.newC}</button></div>}

      {draft && (
        <section className="card cmEditor">
          <div className="cmGrid">
            <label>{l.name}<input maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="π.χ. Χριστούγεννα 2026" /></label>
            <div className="cmField"><span>{l.channels}</span><div className="cmChecks">
              <label className="inline"><input type="checkbox" checked={draft.sendEmail} onChange={(e) => setDraft({ ...draft, sendEmail: e.target.checked })} /> ✉️ {l.email}</label>
              <label className="inline"><input type="checkbox" checked={draft.sendWhatsapp} onChange={(e) => setDraft({ ...draft, sendWhatsapp: e.target.checked })} /> 💬 {l.whatsapp}</label>
            </div></div>
          </div>

          <h3>👥 {l.audience}</h3>
          <small className="muted">{l.audienceHelp}</small>
          <div className="cmGrid">
            <label>{l.stayFrom}<input type="date" value={draft.audience.stayFrom} onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, stayFrom: e.target.value } })} /></label>
            <label>{l.stayTo}<input type="date" value={draft.audience.stayTo} onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, stayTo: e.target.value } })} /></label>
            <label>{l.countries}<input value={draft.audience.countries} onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, countries: e.target.value } })} /></label>
            <label>{l.minStays}<input type="number" min={1} max={10} value={draft.audience.minStays} onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, minStays: Number(e.target.value) || 1 } })} /></label>
          </div>
          <div className="cmField"><span>{l.languages}</span><div className="cmChecks">{langs.map((x) => <label className="inline" key={x}><input type="checkbox" checked={draft.audience.languages.includes(x)} onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, languages: e.target.checked ? [...draft.audience.languages, x] : draft.audience.languages.filter((y) => y !== x) } })} /> {langNames[x]}</label>)}</div></div>
          <div className="apRow">
            <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { const d = await post({ action: "preview", audience: audienceOf(draft) }, ""); if (d?.preview) setPreview(d.preview); }}>{l.count}</button>
            {preview && <span className="cmCount">✉️ <b>{preview.email.total}</b> · 💬 <b>{preview.whatsapp.total}</b> {l.recipients} <small className="muted">({Object.entries(preview.email.byLang).map(([k, v]) => `${k} ${v}`).join(", ")})</small></span>}
          </div>

          <h3>✉️ {l.message}</h3>
          <div className="cmPresets"><span>{l.templates}:</span>{Object.entries(data.presets).map(([k, p]) => <button type="button" key={k} className="secondaryButton" onClick={() => setDraft({ ...draft, name: draft.name || `${(l as unknown as Record<string, string>)[k] ?? k} ${new Date().getFullYear()}`, content: Object.fromEntries(langs.map((x) => [x, { ...p[x] }])) })}>{p.icon} {(l as unknown as Record<string, string>)[k] ?? k}</button>)}</div>
          <small className="muted">{l.templatesHelp} {l.messageHelp}</small>
          <div className="tvLangTabs" role="tablist">{langs.map((x) => <button type="button" role="tab" key={x} aria-selected={tab === x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>{langNames[x]}{draft.content[x]?.body ? " ✓" : ""}</button>)}</div>
          <label>{l.subject}<input maxLength={150} value={c.subject} placeholder={draft.content.en?.subject ?? ""} onChange={(e) => setDraft({ ...draft, content: { ...draft.content, [tab]: { ...c, subject: e.target.value } } })} /></label>
          <label>{l.body}<textarea rows={9} maxLength={5000} value={c.body} placeholder={draft.content.en?.body ?? ""} onChange={(e) => setDraft({ ...draft, content: { ...draft.content, [tab]: { ...c, body: e.target.value } } })} /></label>
          <div className="apRow"><span>{l.photo}:</span>
            {draft.id ? <>
              <label className="secondaryButton cmFile">{l.pick}<input type="file" accept="image/*" hidden onChange={(e) => void photo(e.target.files?.[0])} /></label>
              {draft.hasImage && <><img className="cmThumb" src={`/api/pms/campaigns/image?id=${draft.id}&v=${imgV}`} alt="" /><button type="button" className="secondaryButton" disabled={busy} onClick={async () => { if (await post({ action: "image", id: draft.id, image: null })) setDraft({ ...draft, hasImage: false }); }}>{l.removePhoto}</button></>}
            </> : <small className="muted">{l.photoSave}</small>}
          </div>

          {draft.sendWhatsapp && <>
            <h3>💬 {l.waTitle}</h3>
            <small className="muted">{l.waHelp}</small>
            <div className="cmGrid">
              <label>{l.waName}<input value={draft.whatsappTemplate} placeholder="christmas_greetings" onChange={(e) => setDraft({ ...draft, whatsappTemplate: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></label>
              <label>{l.waLangs}<input value={draft.whatsappLanguages} onChange={(e) => setDraft({ ...draft, whatsappLanguages: e.target.value })} /></label>
            </div>
          </>}

          <div className="apRow"><label className="inline">{l.rate} <input type="number" min={1} max={120} value={draft.ratePerMinute} onChange={(e) => setDraft({ ...draft, ratePerMinute: Number(e.target.value) || 20 })} style={{ width: 80 }} /></label><small className="muted">{l.rateHelp}</small></div>

          <div className="cmActions">
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => void saveDraft(draft)}>{l.save}</button>
            <span className="cmTest"><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label={l.testTo} placeholder={l.testTo} /><button type="button" className="secondaryButton" disabled={busy || !draft.sendEmail || !testTo} onClick={async () => { const s = await saveDraft(draft, ""); if (s) await post({ action: "test", id: Number(s.id), to: testTo, lang: tab }, l.testSent); }}>{l.test} ({tab})</button></span>
            <span className="cmTest"><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={l.at} /><button type="button" className="secondaryButton" disabled={busy || !at} onClick={() => void send(true)}>{l.schedule}</button></span>
            <button type="button" className="primaryAction" disabled={busy} onClick={() => void send(false)}>{l.sendNow}</button>
            <button type="button" className="secondaryButton" onClick={() => setDraft(null)}>{l.close}</button>
          </div>
        </section>
      )}

      {!data.campaigns.length && !draft && <p className="muted">{l.none}</p>}
      {data.campaigns.map((x) => {
        const s = (ch: "email" | "whatsapp") => x.stats[ch];
        const line = (ch: "email" | "whatsapp") => { const st = s(ch), total = Object.values(st).reduce((a, b) => a + b, 0); return total ? `${ch === "email" ? "✉️" : "💬"} ${st.sent ?? 0}/${total} ${l.sent}${st.failed ? ` · ${st.failed} ${l.failed}` : ""}${(st.pending ?? 0) + (st.sending ?? 0) ? ` · ${(st.pending ?? 0) + (st.sending ?? 0)} ${l.pending}` : ""}${st.skipped ? ` · ${st.skipped} ${l.skipped}` : ""}` : ""; };
        const total = Object.values(s("email")).reduce((a, b) => a + b, 0) + Object.values(s("whatsapp")).reduce((a, b) => a + b, 0);
        const done = (s("email").sent ?? 0) + (s("whatsapp").sent ?? 0) + (s("email").failed ?? 0) + (s("whatsapp").failed ?? 0) + (s("email").skipped ?? 0) + (s("whatsapp").skipped ?? 0);
        return (
          <section key={x.id} className={`card cmItem st-${x.status}`}>
            <div className="cmHead">
              <div><b>{x.name}</b><small className="muted">{x.sendEmail ? "✉️ " : ""}{x.sendWhatsapp ? "💬 " : ""}{x.status === "scheduled" && x.scheduledAt ? `${l.when}: ${when(x.scheduledAt)}` : x.startedAt ? `${l.started}: ${when(x.startedAt)}${x.finishedAt ? ` · ${l.finished}: ${when(x.finishedAt)}` : ""}` : when(x.updatedAt)}</small></div>
              <span className={`cmBadge st-${x.status}`}>{l.status[x.status] ?? x.status}</span>
            </div>
            {total > 0 && <><div className="cmBar"><span style={{ width: `${Math.round((done / total) * 100)}%` }} /></div><small>{[line("email"), line("whatsapp")].filter(Boolean).join(" · ")}{x.stats.unsubscribed ? ` · ${x.stats.unsubscribed} ${l.unsubscribed}` : ""}</small></>}
            {canEdit && <div className="apRow">
              {x.status === "draft" && <button type="button" className="secondaryButton" onClick={() => { setDraft(toDraft(x)); setPreview(null); scrollTo({ top: 0, behavior: "smooth" }); }}>{l.edit}</button>}
              <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { const d = await post({ action: "duplicate", id: x.id }); if (d?.campaigns) { const n = (d.campaigns as CampaignView[]).find((y) => y.id === Number(d.id)); if (n) setDraft(toDraft(n)); } }}>{l.duplicate}</button>
              {["scheduled", "sending"].includes(x.status) && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => confirm(l.cancelQ) && void post({ action: "cancel", id: x.id })}>{l.cancel}</button>}
              {["sending", "sent", "cancelled"].includes(x.status) && <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { const d = await post({ action: "failures", id: x.id }, ""); if (d) setFailures({ id: x.id, rows: d.failures }); }}>{l.report}</button>}
              {["draft", "cancelled"].includes(x.status) && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => confirm(l.removeQ) && void post({ action: "remove", id: x.id })}>{l.remove}</button>}
            </div>}
            {failures?.id === x.id && <div className="cmFailures"><b>{l.failures}: {failures.rows.length}</b>{failures.rows.map((f, i) => <small key={i}>{f.channel === "email" ? "✉️" : "💬"} {f.address} · {f.name} · {f.error}</small>)}</div>}
          </section>
        );
      })}

      <section className="card cmUnsub">
        <h3>🚫 {l.unsubTitle} ({data.unsubscribes.length})</h3>
        <small className="muted">{l.unsubHelp}</small>
        {canEdit && <form className="apRow" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "unsub_add", ...unsub })) setUnsub({ ...unsub, address: "" }); }}>
          <select value={unsub.channel} onChange={(e) => setUnsub({ ...unsub, channel: e.target.value })}><option value="email">✉️ {l.email}</option><option value="whatsapp">💬 {l.whatsapp}</option></select>
          <input required value={unsub.address} onChange={(e) => setUnsub({ ...unsub, address: e.target.value })} placeholder={unsub.channel === "email" ? "guest@example.com" : "+30 69…"} />
          <button className="secondaryButton" disabled={busy}>{l.add}</button>
        </form>}
        {!data.unsubscribes.length ? <small className="muted">{l.noUnsub}</small> : <ul className="cmUnsubList">{data.unsubscribes.map((u) => <li key={`${u.channel}${u.address}`}>{u.channel === "email" ? "✉️" : "💬"} {u.address} <small className="muted">· {when(u.at)} · {u.source}</small>{canEdit && <button type="button" className="linkButton" onClick={() => void post({ action: "unsub_remove", channel: u.channel, address: u.address })}>✕</button>}</li>)}</ul>}
      </section>
    </div>
  );
}
