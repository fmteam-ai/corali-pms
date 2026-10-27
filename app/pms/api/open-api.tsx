"use client";
import { useCallback, useEffect, useState } from "react";
import type { ApiKeyView, WebhookView } from "@/lib/open-api";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

const SCOPES = ["rooms.read", "availability.read", "bookings.read", "folio.write", "accounting.read"] as const;
const EVENTS = ["booking.created", "booking.updated", "booking.cancelled", "booking.checked_in", "booking.checked_out", "folio.charge", "folio.payment"] as const;
type State = { keys: ApiKeyView[]; webhooks: WebhookView[] };

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/v1/rooms", "rooms.read"],
  ["GET", "/api/v1/availability?from=2026-07-01&to=2026-07-31", "availability.read"],
  ["GET", "/api/v1/bookings?from=…&to=…&status=confirmed | ?in_house=true", "bookings.read"],
  ["GET", "/api/v1/bookings/{reference | room code}", "bookings.read"],
  ["POST", "/api/v1/bookings/{reference | room code}/charges", "folio.write"],
  ["GET", "/api/v1/transactions?after={id}&from=YYYY-MM-DD", "accounting.read"],
  ["GET", "/api/v1/invoices?after={id}", "accounting.read"],
];

export function OpenApi({ lang, origin, canWrite }: { lang: PmsLang; origin: string; canWrite: boolean }) {
  const t = pmsT(lang);
  const [data, setData] = useState<State | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const [keyForm, setKeyForm] = useState<{ name: string; scopes: string[] }>({ name: "", scopes: ["bookings.read", "folio.write"] });
  const [hookForm, setHookForm] = useState<{ url: string; events: string[] }>({ url: "", events: [...EVENTS] });
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(pmsLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }) : t("api.never"));

  const load = useCallback(async () => { const r = await fetch("/api/pms/open-api", { cache: "no-store" }); const d = await r.json().catch(() => null); if (d?.ok) setData(d); }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function post(body: object) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/open-api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `api.err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("api.failed")); return null; }
      setData(d); setMsg(t("api.saved")); return d;
    } finally { setBusy(false); }
  }
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  if (!data) return <p className="muted">{t("api.loading")}</p>;
  return (
    <div className="apiPage">
      {msg && <p className="notice" role="status">{msg}</p>}
      {shown && (
        <div className="card apiSecret">
          <b>{shown.label}</b>
          <code>{shown.value}</code>
          <div className="apiRow"><button type="button" className="secondaryButton" onClick={() => void navigator.clipboard?.writeText(shown.value)}>📋 Copy</button><button type="button" className="secondaryButton" onClick={() => setShown(null)}>OK</button></div>
        </div>
      )}

      <section className="card">
        <h2>🔑 {t("api.keys")}</h2>
        <p className="muted">{t("api.keysHelp")}</p>
        {canWrite && (
          <form className="apiForm" onSubmit={async (e) => { e.preventDefault(); const d = await post({ action: "create_key", ...keyForm }); if (d?.key) { setShown({ label: t("api.newKey"), value: d.key }); setKeyForm({ name: "", scopes: keyForm.scopes }); } }}>
            <input required maxLength={80} placeholder={t("api.keyName")} value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} />
            <div className="apiChecks">{SCOPES.map((s) => <label key={s}><input type="checkbox" checked={keyForm.scopes.includes(s)} onChange={() => setKeyForm({ ...keyForm, scopes: toggle(keyForm.scopes, s) })} /> {t(`api.scope.${s}` as PmsKey)}</label>)}</div>
            <button className="primaryAction" disabled={busy || !keyForm.scopes.length}>{t("api.create")}</button>
          </form>
        )}
        {data.keys.length ? (
          <div className="apiList">{data.keys.map((k) => (
            <article key={k.id} className={`apiItem${k.revokedAt ? " off" : ""}`}>
              <div><b>{k.name}</b> <code>corali_{k.prefix}_…</code><small>{k.scopes.map((s) => t(`api.scope.${s}` as PmsKey)).join(" · ")}</small><small className="muted">{k.revokedAt ? `${t("api.revoked")} ${when(k.revokedAt)}` : `${t("api.lastUsed")}: ${when(k.lastUsedAt)}`}</small></div>
              {canWrite && !k.revokedAt && <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("api.revokeConfirm"))) void post({ action: "revoke_key", id: k.id }); }}>{t("api.revoke")}</button>}
            </article>
          ))}</div>
        ) : <p className="muted">{t("api.noKeys")}</p>}
      </section>

      <section className="card">
        <h2>📡 {t("api.webhooks")}</h2>
        <p className="muted">{t("api.webhooksHelp")}</p>
        {canWrite && (
          <form className="apiForm" onSubmit={async (e) => { e.preventDefault(); const d = await post({ action: "create_webhook", ...hookForm }); if (d?.secret) { setShown({ label: t("api.newSecret"), value: d.secret }); setHookForm({ url: "", events: [...EVENTS] }); } }}>
            <input required type="url" maxLength={500} placeholder={t("api.url")} value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} />
            <div className="apiChecks">{EVENTS.map((ev) => <label key={ev}><input type="checkbox" checked={hookForm.events.includes(ev)} onChange={() => setHookForm({ ...hookForm, events: toggle(hookForm.events, ev) })} /> {t(`api.ev.${ev}` as PmsKey)}</label>)}</div>
            <button className="primaryAction" disabled={busy || !hookForm.events.length}>{t("api.addWebhook")}</button>
          </form>
        )}
        {data.webhooks.length ? data.webhooks.map((h) => (
          <article key={h.id} className={`apiHook${h.active ? "" : " off"}`}>
            <div className="apiItem">
              <div><b>{h.url}</b><small>{h.events.map((ev) => t(`api.ev.${ev}` as PmsKey)).join(" · ")}</small><small className="muted">{h.active ? "" : `${t("api.paused")} · `}{t("api.lastOk")}: {when(h.lastOkAt)}{h.lastError ? ` · ⚠️ ${h.lastError}` : ""}</small></div>
              {canWrite && (
                <div className="apiRow">
                  <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { const d = await post({ action: "test_webhook", id: h.id }); if (d?.test) setMsg(d.test.ok ? t("api.testOk", { status: String(d.test.status) }) : t("api.testFail", { error: d.test.error ?? "" })); }}>{t("api.test")}</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "update_webhook", id: h.id, active: !h.active })}>{h.active ? t("api.pause") : t("api.resume")}</button>
                  <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { if (confirm(t("api.deleteConfirm"))) void post({ action: "delete_webhook", id: h.id }); }}>{t("api.delete")}</button>
                </div>
              )}
            </div>
            {h.deliveries.length > 0 && (
              <details><summary>{t("api.recent")} ({h.deliveries.length})</summary>
                <table className="apiTable"><tbody>{h.deliveries.map((d) => <tr key={d.id}><td>{when(d.createdAt)}</td><td><code>{d.event}</code></td><td className={`st-${d.status}`}>{d.status}{d.responseStatus ? ` · ${d.responseStatus}` : ""}</td><td>{d.attempts}×</td><td className="muted">{d.error ?? ""}</td></tr>)}</tbody></table>
              </details>
            )}
          </article>
        )) : <p className="muted">{t("api.noWebhooks")}</p>}
      </section>

      <section className="card apiDocs">
        <h2>📘 {t("api.docs")}</h2>
        <p>Base URL: <code>{origin}</code> · Header: <code>Authorization: Bearer corali_…</code> · JSON <code>{"{ ok, data }"}</code> · 120 requests / minute / key.</p>
        <table className="apiTable"><tbody>{ENDPOINTS.map(([m, p, s]) => <tr key={p}><td><b>{m}</b></td><td><code>{p}</code></td><td>{t(`api.scope.${s}` as PmsKey)}</td></tr>)}</tbody></table>
        <h3>POS: {lang === "el" ? "χρέωση στο δωμάτιο" : "charge to the room"}</h3>
        <pre>{`curl -X POST ${origin}/api/v1/bookings/102/charges \\
  -H "Authorization: Bearer corali_…" -H "Content-Type: application/json" \\
  -d '{"description":"Restaurant — table 4","amount":36.50,"external_id":"R-10293"}'`}</pre>
        <p className="muted">{lang === "el" ? "Δεκτός ο κωδικός κράτησης ή ο αριθμός δωματίου ενός πελάτη που μένει τώρα. Με το ίδιο external_id η χρέωση δεν γράφεται δεύτερη φορά." : "Use the booking reference, or the room number of a guest in house. The same external_id is never charged twice."}</p>
        <h3>Webhook</h3>
        <pre>{`POST https://your-system/…   Corali-Event: booking.created
Corali-Signature: t=1767225600,v1=<hex HMAC-SHA256(secret, t + "." + body)>
{"id":"evt_…","event":"booking.created","created_at":"…","data":{"reference":"…","status":"confirmed","check_in":"…",…}}`}</pre>
        <p className="muted">{lang === "el" ? "Απαντήστε με HTTP 2xx μέσα σε 10 δευτερόλεπτα. Ελέγξτε την υπογραφή και ότι το t είναι πρόσφατο (π.χ. 5 λεπτά)." : "Reply with HTTP 2xx within 10 seconds. Verify the signature and that t is recent (e.g. 5 minutes)."}</p>
      </section>
    </div>
  );
}
