"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { urlBase64ToUint8Array } from "@/lib/guest-app-core";
import type { ItemView, OfferView, OrderView } from "@/lib/partners";

type Home = { me: { name: string; partner: string }; partner: { name: string; delivery: boolean; pickup: boolean; commissionPercent: number }; items: ItemView[]; offers: OfferView[]; orders: OrderView[]; uses: { at: number; amountCents: number | null; offer: string }[]; vapidPublicKey: string };
type Guest = { bookingId: number; firstName: string; checkOut: string; offers: { id: number; title: string; discountPercent: number | null; maxUses: number | null; used: number; available: boolean }[] };
type Tab = "orders" | "pass" | "offers" | "menu";

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const when = (ms: number) => new Date(ms).toLocaleString("el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
const dmy = (d: string) => d.split("-").reverse().join("/");
const statusEl: Record<string, string> = { placed: "Νέα", accepted: "Αποδεκτή", ready: "Έτοιμη", completed: "Ολοκληρώθηκε", declined: "Απορρίφθηκε", cancelled: "Ακυρώθηκε" };
const offerStatusEl: Record<string, string> = { pending: "⏳ Περιμένει έγκριση", approved: "✅ Εγκρίθηκε", rejected: "❌ Απορρίφθηκε", withdrawn: "Αποσύρθηκε" };
const payEl: Record<string, string> = { cash: "💶 Μετρητά", pos: "💳 Κάρτα (POS)", link: "🔗 Σύνδεσμος πληρωμής" };
const nextEl: Record<string, string> = { accepted: "✓ Αποδοχή", declined: "✕ Απόρριψη", ready: "Έτοιμη", completed: "Ολοκλήρωση", cancelled: "Ακύρωση" };
const next = (s: string) => (s === "placed" ? ["accepted", "declined"] : s === "accepted" ? ["ready", "completed", "cancelled"] : s === "ready" ? ["completed", "cancelled"] : []);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());

async function api(body?: object) {
  const r = await fetch("/api/public/partner", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

export function PartnerApp() {
  const [home, setHome] = useState<Home | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [tab, setTab] = useState<Tab>("orders");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });

  const load = useCallback(async () => {
    const r = await api();
    if (r.status === 401) { setSignedOut(true); return; }
    if (r.data.ok) { setHome(r.data); setSignedOut(false); }
  }, []);
  useEffect(() => {
    queueMicrotask(() => { void load(); const t = new URLSearchParams(location.search).get("tab"); if (t && ["orders", "pass", "offers", "menu"].includes(t)) setTab(t as Tab); });
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "corali-refresh") void load(); };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/partner-sw.js").catch(() => {});
    return () => { clearInterval(poll); navigator.serviceWorker?.removeEventListener("message", onMsg); };
  }, [load]);

  async function act(body: object, ok = "Αποθηκεύτηκε ✓") {
    setBusy(true); setMsg("");
    try {
      const r = await api(body);
      if (r.data.ok) { if (r.data.me) setHome(r.data); setMsg(ok); return r.data; }
      setMsg({ STEP: "Δεν επιτρέπεται αυτό το βήμα.", LINK: "Ο σύνδεσμος πρέπει να ξεκινά με https://", CODE_TAKEN: "Ο κωδικός χρησιμοποιείται ήδη.", USED: "Η προσφορά έχει ήδη χρησιμοποιηθεί από αυτόν τον πελάτη.", PASS: "Η κάρτα πελάτη δεν ισχύει.", TOO_MANY: "Πολλές προσπάθειες — δοκιμάστε σε λίγο.", INVALID_INPUT: "Ελέγξτε τα στοιχεία." }[String(r.data.error)] ?? "Δεν ολοκληρώθηκε.");
      if (r.status === 401) setSignedOut(true);
      return null;
    } finally { setBusy(false); }
  }

  async function notifications() {
    try {
      if ((await Notification.requestPermission()) !== "granted" || !home) return setMsg("Οι ειδοποιήσεις δεν επιτράπηκαν.");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(home.vapidPublicKey) as BufferSource }));
      await act({ action: "subscribe", subscription: sub.toJSON() }, "🔔 Οι ειδοποιήσεις ενεργοποιήθηκαν");
    } catch { setMsg("Οι ειδοποιήσεις δεν υποστηρίζονται εδώ (στο iPhone: πρώτα «Προσθήκη στην οθόνη αφετηρίας»)."); }
  }

  if (signedOut) return (
    <main className="pa paLogin">
      <img src="/hotel-corali-logo.png" alt="Hotel Corali" />
      <h1>Corali Partners</h1>
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMsg(""); const r = await api({ action: "login", ...login }); setBusy(false); if (r.data.ok) { setLogin({ email: "", password: "" }); void load(); } else setMsg(r.status === 429 ? "Πολλές προσπάθειες — δοκιμάστε σε λίγο." : r.data.error === "DISABLED" ? "Η εφαρμογή δεν είναι ενεργή ακόμα — επικοινωνήστε με το ξενοδοχείο." : "Λάθος email ή κωδικός."); }}>
        <label>Email<input type="email" required autoComplete="username" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></label>
        <label>Κωδικός<input type="password" required autoComplete="current-password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>
        <button className="paPrimary" disabled={busy}>Σύνδεση</button>
      </form>
      {msg && <p className="paMsg">{msg}</p>}
      <p className="paHint">Τα στοιχεία σύνδεσης σας τα δίνει το Hotel Corali.</p>
    </main>
  );
  if (!home) return <main className="pa"><p className="paHint">Φόρτωση…</p></main>;
  const open = home.orders.filter((o) => ["placed", "accepted", "ready"].includes(o.status));
  return (
    <main className="pa">
      <header className="paTop">
        <div className="paBrand"><img src="/partner-icon-192.png" alt="" /><div><b>{home.me.partner}</b><small>{home.me.name} · Corali Partners</small></div></div>
        <div className="paTopActions"><button type="button" onClick={notifications} title="Ειδοποιήσεις">🔔</button><button type="button" onClick={async () => { await api({ action: "logout" }); setHome(null); setSignedOut(true); }}>Έξοδος</button></div>
      </header>
      <nav className="paTabs">
        {([["orders", `🛎️ Παραγγελίες${open.length ? ` (${open.length})` : ""}`], ["pass", "🎟️ Πελάτης"], ["offers", "🏷️ Προσφορές"], ["menu", "📋 Κατάλογος"]] as [Tab, string][]).map(([k, l]) => <button type="button" key={k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setMsg(""); }}>{l}</button>)}
      </nav>
      {msg && <p className="paMsg" role="status">{msg}</p>}
      {tab === "orders" && <Orders orders={home.orders} busy={busy} act={act} />}
      {tab === "pass" && <PassCheck busy={busy} act={act} uses={home.uses} />}
      {tab === "offers" && <Offers offers={home.offers} busy={busy} act={act} />}
      {tab === "menu" && <Menu items={home.items} busy={busy} act={act} />}
    </main>
  );
}

type Act = (body: object, ok?: string) => Promise<Record<string, unknown> | null>;

function Orders({ orders, busy, act }: { orders: OrderView[]; busy: boolean; act: Act }) {
  const [links, setLinks] = useState<Record<number, string>>({});
  if (!orders.length) return <p className="paHint">Δεν υπάρχουν παραγγελίες ακόμα. Οι νέες εμφανίζονται εδώ (και ως ειδοποίηση, αν την ενεργοποιήσετε 🔔).</p>;
  return (
    <section className="paList">
      {orders.map((o) => (
        <article key={o.id} className={`paCard st-${o.status}`}>
          <div className="paRow"><b>#{o.id} · {o.guest}{o.room ? ` · δωμ. ${o.room}` : ""}</b><span className={`paBadge st-${o.status}`}>{statusEl[o.status] ?? o.status}</span></div>
          <small>{when(o.createdAt)} · {o.fulfilment === "delivery" ? "🚚 Παράδοση στο ξενοδοχείο" : "🏃 Παραλαβή"}{o.wantedAt ? ` · ${o.wantedAt}` : ""}</small>
          <ul>{o.lines.map((l, i) => <li key={i}>{l.qty} × {l.name} <span>{euro(l.priceCents * l.qty)}</span></li>)}</ul>
          {o.discountCents > 0 && <small>Έκπτωση {o.code ? `(κωδικός ${o.code})` : ""}: −{euro(o.discountCents)}</small>}
          <div className="paRow"><b>Σύνολο {euro(o.totalCents)}</b><span>{payEl[o.payMethod] ?? o.payMethod}{o.paid ? " · πληρώθηκε ✓" : ""}</span></div>
          {o.note && <p className="paNote">📝 {o.note}</p>}
          {next(o.status).length > 0 && <div className="paActions">{next(o.status).map((s) => <button type="button" key={s} disabled={busy} className={s === "declined" || s === "cancelled" ? "paDanger" : "paPrimary"} onClick={() => { const note = s === "declined" || s === "cancelled" ? prompt("Αιτία (θα τη δει ο πελάτης):") ?? "" : ""; void act({ action: "order", id: o.id, status: s, note: note || undefined }); }}>{nextEl[s]}</button>)}</div>}
          {o.payMethod === "link" && !["declined", "cancelled"].includes(o.status) && (
            <div className="paActions">
              <input placeholder="https://… σύνδεσμος πληρωμής" value={links[o.id] ?? o.paymentLink} onChange={(e) => setLinks({ ...links, [o.id]: e.target.value })} />
              <button type="button" disabled={busy || !(links[o.id] ?? "").startsWith("https://")} onClick={() => void act({ action: "order", id: o.id, paymentLink: links[o.id] }, "Ο σύνδεσμος στάλθηκε στον πελάτη ✓")}>Αποστολή</button>
            </div>
          )}
          {!o.paid && ["accepted", "ready", "completed"].includes(o.status) && <button type="button" className="paLink" disabled={busy} onClick={() => void act({ action: "order", id: o.id, paid: true })}>Σήμανση ως πληρωμένη</button>}
        </article>
      ))}
    </section>
  );
}

/** Guest pass: camera scan of the QR (where the phone supports it) or the 6 digits under it. */
function PassCheck({ busy, act, uses }: { busy: boolean; act: Act; uses: Home["uses"] }) {
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [guest, setGuest] = useState<Guest | null | "none">(null);
  const [offerId, setOfferId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setScanning(false); };
  useEffect(() => () => stop(), []);

  async function check(value: string) {
    setGuest(null); setPass(value);
    const r = await act({ action: "pass", pass: value }, "");
    const g = (r?.guest as Guest | null | undefined) ?? null;
    setGuest(g ?? "none");
    setOfferId(g?.offers.find((o) => o.available)?.id ?? null);
  }
  async function scan() {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices) { alert("Η σάρωση δεν υποστηρίζεται σε αυτό το κινητό — πληκτρολογήστε τον 6ψήφιο κωδικό."); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setScanning(true);
      requestAnimationFrame(async () => {
        if (!video.current || !stream.current) return;
        video.current.srcObject = stream.current; await video.current.play();
        const d = new Detector({ formats: ["qr_code"] });
        const loop = async () => {
          if (!stream.current || !video.current) return;
          const found = (await d.detect(video.current).catch(() => []))[0]?.rawValue;
          if (found?.startsWith("CORALI-GP:")) { stop(); void check(found); } else setTimeout(loop, 250);
        };
        void loop();
      });
    } catch { stop(); alert("Δεν δόθηκε άδεια για την κάμερα."); }
  }

  return (
    <section className="paList">
      <article className="paCard">
        <h2>🎟️ Επαλήθευση πελάτη του ξενοδοχείου</h2>
        <p className="paHint">Ο πελάτης δείχνει την «Κάρτα πελάτη» από την εφαρμογή του ξενοδοχείου. Σκανάρετε το QR ή γράψτε τον 6ψήφιο κωδικό (αλλάζει κάθε λεπτό).</p>
        <div className="paActions"><button type="button" className="paPrimary" onClick={scan} disabled={scanning}>📷 Σάρωση QR</button></div>
        {scanning && <div className="paScan"><video ref={video} playsInline muted /><button type="button" onClick={stop}>Κλείσιμο</button></div>}
        <form className="paActions" onSubmit={(e) => { e.preventDefault(); void check(code); }}>
          <input inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="6ψήφιος κωδικός" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button type="submit" disabled={busy || code.length !== 6}>Έλεγχος</button>
        </form>
        {guest === "none" && <p className="paBad">✕ Δεν ισχύει — ζητήστε από τον πελάτη να ανοίξει ξανά την κάρτα (ο κωδικός αλλάζει κάθε λεπτό).</p>}
        {guest && guest !== "none" && (
          <div className="paGood">
            <b>✓ Πελάτης του Hotel Corali: {guest.firstName}</b>
            <small>Διαμονή έως {dmy(guest.checkOut)}</small>
            {guest.offers.length ? (
              <>
                <label>Προσφορά που εφαρμόστηκε
                  <select value={offerId ?? ""} onChange={(e) => setOfferId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— καμία —</option>
                    {guest.offers.map((o) => <option key={o.id} value={o.id} disabled={!o.available}>{o.title}{o.discountPercent ? ` (−${o.discountPercent}%)` : ""}{o.maxUses ? ` · ${o.used}/${o.maxUses} χρήσεις` : ""}{!o.available ? " — έχει χρησιμοποιηθεί" : ""}</option>)}
                  </select>
                </label>
                <label>Ποσό λογαριασμού € (προαιρετικό)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} /></label>
                <button type="button" className="paPrimary" disabled={busy} onClick={async () => { if (await act({ action: "redeem", pass, offerId, amountEur: amount ? Number(amount) : null }, "Καταχωρήθηκε ✓")) { setGuest(null); setCode(""); setAmount(""); } }}>Καταχώριση χρήσης</button>
              </>
            ) : <small>Δεν έχετε ενεργή προσφορά «μόνο για πελάτες του ξενοδοχείου» αυτή την ώρα.</small>}
          </div>
        )}
      </article>
      {uses.length > 0 && <article className="paCard"><h3>Πρόσφατες χρήσεις</h3><ul>{uses.map((u, i) => <li key={i}>{when(u.at)} · {u.offer || "—"}{u.amountCents !== null ? <span>{euro(u.amountCents)}</span> : null}</li>)}</ul></article>}
    </section>
  );
}

function Offers({ offers, busy, act }: { offers: OfferView[]; busy: boolean; act: Act }) {
  const blank = { titleEl: "", titleEn: "", bodyEl: "", bodyEn: "", discountPercent: "", code: "", startsOn: today(), endsOn: today(), timeFrom: "", timeTo: "", guestsOnly: true, maxUses: "1" };
  const [f, setF] = useState(blank);
  return (
    <section className="paList">
      <article className="paCard">
        <h2>Νέα προσφορά / έκπτωση</h2>
        <p className="paHint">Το ξενοδοχείο την ελέγχει πριν τη δουν οι πελάτες. Οι προσφορές «μόνο για πελάτες του ξενοδοχείου» εμφανίζονται πρώτες στην εφαρμογή των πελατών.</p>
        <form className="paForm" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "offer", offer: { ...f, discountPercent: f.discountPercent ? Number(f.discountPercent) : null, maxUses: f.maxUses === "" ? null : Number(f.maxUses) } }, "Στάλθηκε για έγκριση ✓")) setF(blank); }}>
          <label>Τίτλος (ελληνικά)<input required={!f.titleEn} maxLength={120} value={f.titleEl} onChange={(e) => setF({ ...f, titleEl: e.target.value })} placeholder="π.χ. −15% σε όλο τον κατάλογο" /></label>
          <label>Title (English)<input maxLength={120} value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} /></label>
          <label>Περιγραφή<textarea rows={2} maxLength={800} value={f.bodyEl} onChange={(e) => setF({ ...f, bodyEl: e.target.value })} /></label>
          <label>Description<textarea rows={2} maxLength={800} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></label>
          <div className="paTwo">
            <label>Έκπτωση %<input type="number" min={1} max={90} value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: e.target.value })} /></label>
            <label>Κωδικός κουπονιού<input maxLength={30} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} placeholder="π.χ. CORALI15" /></label>
          </div>
          <div className="paTwo">
            <label>Από<input type="date" required value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></label>
            <label>Έως<input type="date" required min={f.startsOn} value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></label>
          </div>
          <div className="paTwo">
            <label>Ώρες από (προαιρετικό)<input type="time" value={f.timeFrom} onChange={(e) => setF({ ...f, timeFrom: e.target.value })} /></label>
            <label>έως<input type="time" value={f.timeTo} onChange={(e) => setF({ ...f, timeTo: e.target.value })} /></label>
          </div>
          <label>Χρήσεις ανά κράτηση
            <select value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })}>
              <option value="1">1 φορά</option><option value="2">2 φορές</option><option value="3">3 φορές</option><option value="5">5 φορές</option><option value="">Απεριόριστα όσο ισχύει η κράτηση</option>
            </select>
          </label>
          <label className="paCheck"><input type="checkbox" checked={f.guestsOnly} onChange={(e) => setF({ ...f, guestsOnly: e.target.checked })} /> Μόνο για τους πελάτες του ξενοδοχείου</label>
          <button className="paPrimary" disabled={busy}>Αποστολή για έγκριση</button>
        </form>
      </article>
      {offers.map((o) => (
        <article key={o.id} className={`paCard of-${o.status}`}>
          <div className="paRow"><b>{o.titleEl || o.titleEn}</b><span className="paBadge">{offerStatusEl[o.status] ?? o.status}</span></div>
          <small>{dmy(o.startsOn)} → {dmy(o.endsOn)}{o.timeFrom ? ` · ${o.timeFrom}–${o.timeTo}` : ""}{o.discountPercent ? ` · −${o.discountPercent}%` : ""}{o.code ? ` · κωδικός ${o.code}` : ""} · {o.maxUses ? `${o.maxUses}× ανά κράτηση` : "απεριόριστα"}{o.guestsOnly ? " · μόνο πελάτες ξενοδοχείου" : ""}</small>
          {o.status === "rejected" && o.rejectReason && <p className="paBad">{o.rejectReason}</p>}
          {["pending", "approved"].includes(o.status) && <button type="button" className="paLink" disabled={busy} onClick={() => confirm("Απόσυρση της προσφοράς;") && void act({ action: "offer_withdraw", id: o.id })}>Απόσυρση</button>}
        </article>
      ))}
    </section>
  );
}

function Menu({ items, busy, act }: { items: ItemView[]; busy: boolean; act: Act }) {
  const blank = { section: "", nameEl: "", nameEn: "", description: "", priceEur: "", active: true };
  const [f, setF] = useState(blank);
  const [edit, setEdit] = useState<number | null>(null);
  return (
    <section className="paList">
      <article className="paCard">
        <h2>{edit ? "Επεξεργασία" : "Νέο προϊόν / υπηρεσία"}</h2>
        <form className="paForm" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "item_save", id: edit ?? undefined, item: { ...f, priceEur: Number(f.priceEur) || 0 } })) { setF(blank); setEdit(null); } }}>
          <label>Κατηγορία καταλόγου<input maxLength={60} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="π.χ. Κοκτέιλ, Burgers, Αυτοκίνητα" /></label>
          <div className="paTwo"><label>Όνομα<input maxLength={120} value={f.nameEl} onChange={(e) => setF({ ...f, nameEl: e.target.value })} /></label><label>Name (EN)<input maxLength={120} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></label></div>
          <label>Περιγραφή<input maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <div className="paTwo"><label>Τιμή €<input inputMode="decimal" required value={f.priceEur} onChange={(e) => setF({ ...f, priceEur: e.target.value.replace(",", ".") })} /></label><label className="paCheck"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Διαθέσιμο</label></div>
          <div className="paActions"><button className="paPrimary" disabled={busy || (!f.nameEl && !f.nameEn)}>Αποθήκευση</button>{edit && <button type="button" onClick={() => { setEdit(null); setF(blank); }}>Άκυρο</button>}</div>
        </form>
      </article>
      {items.map((i) => (
        <article key={i.id} className={`paCard${i.active ? "" : " off"}`}>
          <div className="paRow"><b>{i.section ? `${i.section} · ` : ""}{i.nameEl || i.nameEn}</b><span>{euro(i.priceCents)}</span></div>
          {i.description && <small>{i.description}</small>}
          <div className="paActions"><button type="button" onClick={() => { setEdit(i.id); setF({ section: i.section, nameEl: i.nameEl, nameEn: i.nameEn, description: i.description, priceEur: String(i.priceCents / 100), active: i.active }); scrollTo({ top: 0, behavior: "smooth" }); }}>Επεξεργασία</button><button type="button" className="paDanger" disabled={busy} onClick={() => confirm("Διαγραφή;") && void act({ action: "item_remove", id: i.id })}>✕</button></div>
        </article>
      ))}
    </section>
  );
}
