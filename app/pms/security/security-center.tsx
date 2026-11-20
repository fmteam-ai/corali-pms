"use client";
// v180: PMS → Security center (client part): the Cloudflare origin lock set-up, the account check, the event list.
import { useCallback, useEffect, useState } from "react";
import type { SecurityOverview } from "@/lib/security-center";

type L = "el" | "en";
const ADMIN_ROLES = ["owner", "admin", "manager"];
const when = (ms: number | null, l: L) => (ms ? new Date(ms).toLocaleString(l === "el" ? "el-GR" : "en-GB", { timeZone: "Europe/Athens", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function SecurityCenter({ lang: l, initial, canManage }: { lang: L; initial: SecurityOverview; canManage: boolean }) {
  const t = (el: string, en: string) => (l === "el" ? el : en);
  const [d, setD] = useState(initial);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await fetch("/api/pms/security", { cache: "no-store" }).then((x) => x.json()).catch(() => null); if (r?.ok) setD(r); }, []);
  // While waiting for Cloudflare to send the key, check often; otherwise every minute.
  useEffect(() => { const id = setInterval(() => void load(), d.edge.status === "waiting" ? 10_000 : 60_000); return () => clearInterval(id); }, [load, d.edge.status]);

  async function post(body: object) {
    setBusy(true); setMsg("");
    const r = await fetch("/api/pms/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    return r;
  }
  async function newKey() {
    if (d.edge.configured && !window.confirm(t("Νέο κλειδί: το κλείδωμα απενεργοποιείται μέχρι να βάλετε το νέο κλειδί στο Cloudflare. Συνέχεια;", "New key: the lock switches off until you put the new key in Cloudflare. Continue?"))) return;
    const r = await post({ action: "newKey" });
    if (r?.ok) { setKey(r.key); void load(); } else setMsg(t("Δεν δημιουργήθηκε κλειδί.", "No key was created."));
  }
  async function enforce(on: boolean) {
    if (!on && !window.confirm(t("Απενεργοποίηση κλειδώματος: το PMS θα δέχεται ξανά αιτήματα που δεν περνούν από το Cloudflare. Συνέχεια;", "Switch the lock off: the PMS accepts requests that bypass Cloudflare again. Continue?"))) return;
    const r = await post({ action: "enforce", on });
    if (r?.ok) { setMsg(on ? t("✓ Το κλείδωμα είναι ενεργό.", "✓ The lock is on.") : t("Το κλείδωμα απενεργοποιήθηκε.", "The lock is off.")); void load(); }
    else setMsg(r?.error === "KEY_NOT_SEEN" ? t("Το Cloudflare δεν έχει στείλει ακόμα το κλειδί τα τελευταία 10 λεπτά — ελέγξτε τον κανόνα (βήμα 2).", "Cloudflare has not sent the key in the last 10 minutes — check the rule (step 2).") : t("Δεν έγινε η αλλαγή.", "The change failed."));
  }

  const e = d.edge;
  const admins = d.users.filter((u) => u.active && ADMIN_ROLES.includes(u.role));
  const no2fa = admins.filter((u) => !u.totp);
  const suspicious = Object.values(d.totals24h).reduce((a, b) => a + b, 0);
  const edgeText = {
    off: t("Δεν έχει στηθεί", "Not set up"),
    waiting: t("Περιμένει το κλειδί από το Cloudflare", "Waiting for the key from Cloudflare"),
    seen: t("Το Cloudflare στέλνει το κλειδί ✓ — μπορείτε να ενεργοποιήσετε το κλείδωμα", "Cloudflare sends the key ✓ — you can switch the lock on"),
    locked: t("Ενεργό — δεκτά μόνο αιτήματα μέσω Cloudflare", "On — only requests through Cloudflare are accepted"),
    open: t("Ενεργό αλλά το κλειδί δεν έρχεται εδώ και 30′ — το PMS έμεινε ανοιχτό, ελέγξτε τον κανόνα στο Cloudflare", "On, but the key has not arrived for 30′ — the PMS was left open, check the Cloudflare rule"),
  }[e.status];
  const ok = (good: boolean) => <b className={good ? "credit" : "debit"}>{good ? "✓" : "⚠"}</b>;

  return (
    <>
      <section className="card">
        <h3>{t("Σύνοψη", "Summary")}</h3>
        <ul className="plainList">
          <li>{ok(e.status === "locked")} {t("Κλείδωμα πίσω από το Cloudflare", "Lock behind Cloudflare")}: {edgeText}</li>
          <li>{ok(no2fa.length === 0)} {t("Κωδικός δύο βημάτων (2FA) σε χρήστες διαχείρισης", "Two-step sign-in (2FA) for admin users")}: {no2fa.length === 0 ? t("όλοι έχουν", "all have it") : t(`λείπει από ${no2fa.map((u) => u.name).join(", ")}`, `missing for ${no2fa.map((u) => u.name).join(", ")}`)}</li>
          <li>{ok(d.failed24h < 15)} {t("Αποτυχημένες συνδέσεις στο PMS (24 ώρες)", "Failed PMS sign-ins (24 hours)")}: {d.failed24h} · <a href="/pms/logins">{t("ιστορικό", "history")}</a></li>
          <li>{ok(suspicious < 200)} {t("Ύποπτα αιτήματα που κόπηκαν (24 ώρες)", "Suspicious requests stopped (24 hours)")}: {suspicious}</li>
        </ul>
      </section>

      <section className="card">
        <h3>🛡️ {t("Κλείδωμα πίσω από το Cloudflare", "Lock behind Cloudflare")}</h3>
        <small className="muted">{t("Η διεύθυνση του server είναι δημόσια (μέσω του email), οπότε κάποιος μπορεί να τον χτυπήσει απευθείας και να παρακάμψει το Cloudflare. Με το κλείδωμα, το Cloudflare προσθέτει ένα μυστικό κλειδί σε κάθε αίτημα και το PMS απορρίπτει όσα δεν το έχουν.", "The server's address is public (through the mail record), so someone can reach it directly and bypass Cloudflare. With the lock, Cloudflare adds a secret key to every request and the PMS refuses those without it.")}</small>
        <p>{t("Κατάσταση", "Status")}: <b className={e.status === "locked" || e.status === "seen" ? "credit" : e.status === "off" ? "" : "debit"}>{edgeText}</b>{e.lastSeenAt ? <> · {t("τελευταίο κλειδί", "last key")}: {when(e.lastSeenAt, l)}</> : null}</p>
        {canManage && <ol>
          <li>
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => void newKey()}>{e.configured ? t("Νέο κλειδί", "New key") : t("Δημιουργία κλειδιού", "Create key")}</button>
            {key && <div className="notice" role="status">
              <p>{t("Το κλειδί εμφανίζεται μόνο τώρα — αντιγράψτε το:", "The key is shown only now — copy it:")}</p>
              <p><code style={{ userSelect: "all", wordBreak: "break-all" }}>{key}</code> <button type="button" className="secondaryButton" onClick={() => void navigator.clipboard?.writeText(key)}>{t("Αντιγραφή", "Copy")}</button></p>
            </div>}
          </li>
          <li>{t("Στο Cloudflare: hotelcorali.gr → Rules → Overview → Create rule → «Request Header Transform Rule». Όνομα «Corali origin key», «All incoming requests», Set static: header ", "In Cloudflare: hotelcorali.gr → Rules → Overview → Create rule → «Request Header Transform Rule». Name «Corali origin key», «All incoming requests», Set static: header ")}<code>x-corali-edge</code>{t(", τιμή το κλειδί → Deploy.", ", value the key → Deploy.")}</li>
          <li>{t("Περιμένετε έως 1 λεπτό: η κατάσταση γίνεται «Το Cloudflare στέλνει το κλειδί ✓».", "Wait up to a minute: the status becomes «Cloudflare sends the key ✓».")}</li>
          <li>
            {e.enforce
              ? <button type="button" className="secondaryButton" disabled={busy} onClick={() => void enforce(false)}>{t("Απενεργοποίηση κλειδώματος", "Switch the lock off")}</button>
              : <button type="button" disabled={busy || e.status !== "seen"} onClick={() => void enforce(true)}>{t("Ενεργοποίηση κλειδώματος", "Switch the lock on")}</button>}
          </li>
        </ol>}
        <small className="muted">{t("Ασφάλεια: αν ο κανόνας του Cloudflare σβηστεί, μετά από 30 λεπτά το PMS ανοίγει μόνο του και έρχεται ειδοποίηση — δεν κλειδώνεστε ποτέ έξω.", "Safety: if the Cloudflare rule is removed, after 30 minutes the PMS opens by itself and a notification comes — you are never locked out.")}</small>
        {msg && <p className="notice" role="status">{msg}</p>}
      </section>

      <section className="card">
        <h3>🔐 {t("Χρήστες και κωδικός δύο βημάτων", "Users and two-step sign-in")}</h3>
        <table className="table"><thead><tr><th>{t("Χρήστης", "User")}</th><th>{t("Ρόλος", "Role")}</th><th>2FA</th></tr></thead>
          <tbody>{d.users.filter((u) => u.active).map((u) => <tr key={u.id}><td>{u.name} <small className="muted">{u.username}</small></td><td>{u.role}</td><td>{u.totp ? <b className="credit">✓</b> : <b className={ADMIN_ROLES.includes(u.role) ? "debit" : ""}>{ADMIN_ROLES.includes(u.role) ? t("✗ χρειάζεται", "✗ needed") : "—"}</b>}</td></tr>)}</tbody>
        </table>
        <small className="muted">{t("Κάθε χρήστης ενεργοποιεί το 2FA από το δικό του «Προφίλ».", "Each user switches 2FA on from their own «Profile».")}</small>
      </section>

      <section className="card">
        <h3>🚫 {t("Ύποπτα αιτήματα (7 ημέρες)", "Suspicious requests (7 days)")}</h3>
        {d.events.length === 0 ? <p className="muted">{t("Κανένα.", "None.")}</p> :
          <table className="table"><thead><tr><th>{t("Τι", "What")}</th><th>{t("Διεύθυνση", "Address")}</th><th>{t("Φορές", "Times")}</th><th>{t("Τελευταία", "Last")}</th></tr></thead>
            <tbody>{d.events.map((x, i) => <tr key={i}><td>{x.label}{x.detail ? <small className="muted"> · {x.detail}</small> : null}</td><td>{x.ip || "—"}</td><td>{x.count}</td><td>{when(x.lastAt, l)}</td></tr>)}</tbody>
          </table>}
      </section>
    </>
  );
}
