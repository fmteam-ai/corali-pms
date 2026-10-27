"use client";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import type { CardView, publicCardConfig, recentEvents } from "@/lib/access-cards";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Config = Awaited<ReturnType<typeof publicCardConfig>>;
type State = { config: Config; cards: CardView[]; upcoming: { id: number; label: string }[]; rooms: { id: number; code: string }[]; events: Awaited<ReturnType<typeof recentEvents>> };
type Zone = Config["settings"]["zones"][number];

// datetime-local uses the browser's clock (the hotel's staff are in Greece).
const local = (ms: number) => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const fromLocal = (v: string) => new Date(v).getTime();
const readFile = (f: File, as: "base64" | "text") => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onerror = () => fail(r.error); r.onload = () => ok(as === "text" ? String(r.result) : String(r.result).replace(/^data:[^,]*,/, "")); if (as === "text") r.readAsText(f); else r.readAsDataURL(f); });

export function AccessCards({ lang, canIssue, canSetup }: { lang: PmsLang; canIssue: boolean; canSetup: boolean }) {
  const t = pmsT(lang);
  const [data, setData] = useState<State | null>(null);
  const [tab, setTab] = useState<"cards" | "settings" | "log">("cards");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ holder: string; email: string; lang: string; roomId: number; zones: string[]; from: string; until: string; send: boolean } | null>(null);
  const [edit, setEdit] = useState<{ id: number; until: string; zones: string[] } | null>(null);
  const [share, setShare] = useState<{ url: string; qr: string } | null>(null);
  const [readerKey, setReaderKey] = useState("");
  const [settings, setSettings] = useState<Config["settings"] | null>(null);
  const [wallet, setWallet] = useState<Config["wallet"] | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const when = (ms: number) => new Date(ms).toLocaleString(pmsLocale(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

  const apply = (d: State) => { setData(d); setSettings(d.config.settings); setWallet(d.config.wallet); };
  const load = useCallback(async () => { const r = await fetch("/api/pms/access-cards", { cache: "no-store" }); const d = await r.json().catch(() => null); if (d?.ok) apply(d); }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function post(body: object, ok: PmsKey = "ak.saved") {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/access-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `ak.err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("ak.failed")); return null; }
      apply(d); setMsg(t(ok)); return d;
    } finally { setBusy(false); }
  }
  async function showLink(url: string) { setShare({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 280, color: { dark: "#173e47", light: "#ffffff" } }) }); }

  if (!data || !settings || !wallet) return <p className="muted">{t("ak.loading")}</p>;
  const c = data.config, zoneName = (k: string) => { const z = c.settings.zones.find((x) => x.key === k); return z ? z.nameEl : k; };
  const setZone = (i: number, z: Partial<Zone>) => setSettings({ ...settings, zones: settings.zones.map((x, j) => (j === i ? { ...x, ...z } : x)) });
  const active = data.cards.filter((x) => x.state === "active" || x.state === "scheduled"), past = data.cards.filter((x) => x.state === "expired" || x.state === "revoked");
  const row = (x: CardView) => (
    <article key={x.id} className={`card akCard st-${x.state}`}>
      <div className="akMain">
        <b>🔑 {x.holder}{x.roomCode ? ` · ${t("hkb.room", { code: x.roomCode })}` : ""}</b>
        <span>{x.kind === "booking" ? `${t("ak.booking")} ${x.reference}` : t("ak.manualCard")} · {x.serial}</span>
        <span>{when(x.validFrom)} → <strong>{when(x.validUntil)}</strong>{x.untilLocked && x.kind === "booking" ? ` · ${t("ak.setByHand")}` : ""}</span>
        {x.zones.length > 0 && <span>{t("ak.access")}: {x.zones.map(zoneName).join(", ")}</span>}
        <small className="muted">{x.sentAt ? t("ak.sentAt", { time: when(x.sentAt) }) : x.sendError ? `${t("ak.notSent")}: ${x.sendError}` : t("ak.notSentYet")}{x.lastUsedAt ? ` · ${t("ak.lastUsed", { time: when(x.lastUsedAt) })}` : ""}{x.revokedReason ? ` · ${x.revokedReason}` : ""}</small>
      </div>
      <span className={`akState st-${x.state}`}>{t(`ak.st.${x.state}` as PmsKey)}</span>
      {canIssue && (x.state === "active" || x.state === "scheduled") && (
        <div className="akActions">
          <button type="button" className="secondaryButton" onClick={() => setEdit({ id: x.id, until: local(x.validUntil), zones: x.zones })}>{t("ak.edit")}</button>
          <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { const d = await post({ action: "link", id: x.id }, "ak.linkReady"); if (d?.url) await showLink(d.url); }}>{t("ak.link")}</button>
          <button type="button" className="secondaryButton" disabled={busy || !x.email} onClick={() => void post({ action: "resend", id: x.id }, "ak.sent")}>{t("ak.resend")}</button>
          <button type="button" className="secondaryButton danger" disabled={busy} onClick={() => { const reason = prompt(t("ak.revokeReason")); if (reason !== null) void post({ action: "revoke", id: x.id, reason }, "ak.revoked"); }}>{t("ak.revoke")}</button>
        </div>
      )}
      {edit?.id === x.id && (
        <div className="akEdit">
          <label>{t("ak.until")}<input type="datetime-local" value={edit.until} onChange={(e) => setEdit({ ...edit, until: e.target.value })} /></label>
          <div className="akZones">{c.settings.zones.map((z) => <label key={z.key} className="check"><input type="checkbox" checked={edit.zones.includes(z.key)} onChange={(e) => setEdit({ ...edit, zones: e.target.checked ? [...edit.zones, z.key] : edit.zones.filter((k) => k !== z.key) })} />{z.nameEl}</label>)}</div>
          <div className="actions">
            <button type="button" className="primaryAction" disabled={busy} onClick={async () => { if (await post({ action: "update", id: x.id, validUntil: fromLocal(edit.until), zones: edit.zones })) setEdit(null); }}>{t("ak.save")}</button>
            {x.kind === "booking" && x.untilLocked && <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { if (await post({ action: "update", id: x.id, zones: edit.zones, followBooking: true })) setEdit(null); }}>{t("ak.followBooking")}</button>}
            <button type="button" className="secondaryButton" onClick={() => setEdit(null)}>{t("ak.cancel")}</button>
          </div>
        </div>
      )}
    </article>
  );

  return (
    <div className="akPage">
      <nav className="prcNav" role="tablist">
        {(["cards", "settings", "log"] as const).map((k) => <button type="button" role="tab" key={k} aria-selected={tab === k} className={tab === k ? "current" : ""} onClick={() => setTab(k)}>{t(`ak.tab.${k}` as PmsKey)}</button>)}
      </nav>
      <div className={`akBanner ${c.settings.enabled ? "on" : "off"}`}>
        <b>{c.settings.enabled ? t("ak.enabledOn") : t("ak.enabledOff")}</b>
        <span>{c.appleReady ? "✓ Apple Wallet" : "✗ Apple Wallet"} · {c.googleReady ? "✓ Google Wallet" : "✗ Google Wallet"} · {c.has.readerKey ? `✓ ${t("ak.readers")}` : `✗ ${t("ak.readers")}`}</span>
        {canSetup && <button type="button" className={c.settings.enabled ? "secondaryButton danger" : "primaryAction"} disabled={busy} onClick={() => void post({ action: "save_settings", settings: { ...c.settings, enabled: !c.settings.enabled } })}>{c.settings.enabled ? t("ak.disable") : t("ak.enable")}</button>}
      </div>
      <p className="notice" role="status">{msg}</p>
      {share && <div className="card akShare"><img src={share.qr} alt="" /><div><b>{t("ak.shareTitle")}</b><p className="muted">{t("ak.shareHint")}</p><input readOnly value={share.url} onFocus={(e) => e.target.select()} /><div className="actions"><button type="button" className="secondaryButton" onClick={() => void navigator.clipboard?.writeText(share.url)}>{t("ak.copy")}</button><button type="button" className="secondaryButton" onClick={() => setShare(null)}>{t("ak.close")}</button></div></div></div>}

      {tab === "cards" && (
        <>
          {canIssue && c.settings.enabled && (
            <div className="akIssue">
              {data.upcoming.length > 0 && <label>{t("ak.issueBooking")}<span className="akInline"><select id="akBooking" defaultValue="">{[<option key="" value="">—</option>, ...data.upcoming.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)]}</select><button type="button" className="secondaryButton" disabled={busy} onClick={() => { const v = Number((document.getElementById("akBooking") as HTMLSelectElement).value); if (v) void post({ action: "issue_booking", bookingId: v, send: true }, "ak.issued"); }}>{t("ak.issueSend")}</button></span></label>}
              {!manual && <button type="button" className="primaryAction" onClick={() => setManual({ holder: "", email: "", lang: "el", roomId: 0, zones: c.settings.zones.map((z) => z.key), from: local(Date.now()), until: local(Date.now() + 8 * 3_600_000), send: false })}>+ {t("ak.manual")}</button>}
            </div>
          )}
          {manual && (
            <div className="card akForm">
              <h2>{t("ak.manual")}</h2>
              <p className="muted">{t("ak.manualHint")}</p>
              <div className="formGrid">
                <label>{t("ak.holder")}<input value={manual.holder} maxLength={120} onChange={(e) => setManual({ ...manual, holder: e.target.value })} /></label>
                <label>{t("ak.email")}<input type="email" value={manual.email} maxLength={200} onChange={(e) => setManual({ ...manual, email: e.target.value })} /></label>
                <label>{t("ak.room")}<select value={manual.roomId} onChange={(e) => setManual({ ...manual, roomId: Number(e.target.value) })}><option value={0}>{t("ak.noRoom")}</option>{data.rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label>
                <label>{t("ak.language")}<select value={manual.lang} onChange={(e) => setManual({ ...manual, lang: e.target.value })}>{["el", "en", "fr", "de", "it", "es"].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
                <label>{t("ak.from")}<input type="datetime-local" value={manual.from} onChange={(e) => setManual({ ...manual, from: e.target.value })} /></label>
                <label>{t("ak.until")}<input type="datetime-local" value={manual.until} onChange={(e) => setManual({ ...manual, until: e.target.value })} /></label>
              </div>
              <div className="akZones">{c.settings.zones.map((z) => <label key={z.key} className="check"><input type="checkbox" checked={manual.zones.includes(z.key)} onChange={(e) => setManual({ ...manual, zones: e.target.checked ? [...manual.zones, z.key] : manual.zones.filter((k) => k !== z.key) })} />{z.nameEl}</label>)}</div>
              <label className="check"><input type="checkbox" checked={manual.send} disabled={!manual.email} onChange={(e) => setManual({ ...manual, send: e.target.checked })} />{t("ak.sendEmail")}</label>
              <div className="actions"><button type="button" className="primaryAction" disabled={busy || !manual.holder.trim() || (!manual.roomId && !manual.zones.length)} onClick={async () => { const d = await post({ action: "issue_manual", holder: manual.holder, email: manual.email, lang: manual.lang, roomId: manual.roomId || null, zones: manual.zones, from: fromLocal(manual.from), until: fromLocal(manual.until), send: manual.send && Boolean(manual.email) }, "ak.issued"); if (d) { setManual(null); if (d.url) await showLink(d.url); } }}>{t("ak.issue")}</button><button type="button" className="secondaryButton" onClick={() => setManual(null)}>{t("ak.cancel")}</button></div>
            </div>
          )}
          <h2 className="akHeading">{t("ak.current")} ({active.length})</h2>
          {active.length === 0 && <p className="muted">{t(c.settings.enabled ? "ak.noCards" : "ak.offHint")}</p>}
          <div className="akList">{active.map(row)}</div>
          {past.length > 0 && <><h2 className="akHeading">{t("ak.past")}</h2><div className="akList">{past.map(row)}</div></>}
        </>
      )}

      {tab === "settings" && (
        <>
          <div className="card akForm">
            <h2>{t("ak.rules")}</h2>
            <div className="formGrid">
              <label>{t("ak.sendTime")}<input type="time" value={settings.sendTime} disabled={!canSetup} onChange={(e) => setSettings({ ...settings, sendTime: e.target.value })} /><small className="muted">{t("ak.sendTimeHint")}</small></label>
              <span />
              <label>{t("ak.checkInTime")}<input type="time" value={settings.checkInTime} disabled={!canSetup} onChange={(e) => setSettings({ ...settings, checkInTime: e.target.value })} /></label>
              <label>{t("ak.checkOutTime")}<input type="time" value={settings.checkOutTime} disabled={!canSetup} onChange={(e) => setSettings({ ...settings, checkOutTime: e.target.value })} /></label>
            </div>
            <h3>{t("ak.zones")}</h3>
            <p className="muted">{t("ak.zonesHint")}</p>
            <table className="akZoneTable"><thead><tr><th>{t("ak.zoneKey")}</th><th>{t("ak.zoneEl")}</th><th>{t("ak.zoneEn")}</th><th>{t("ak.zoneGuests")}</th><th /></tr></thead><tbody>
              {settings.zones.map((z, i) => <tr key={i}><td><input value={z.key} maxLength={24} disabled={!canSetup} onChange={(e) => setZone(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></td><td><input value={z.nameEl} maxLength={40} disabled={!canSetup} onChange={(e) => setZone(i, { nameEl: e.target.value })} /></td><td><input value={z.nameEn} maxLength={40} disabled={!canSetup} onChange={(e) => setZone(i, { nameEn: e.target.value })} /></td><td><input type="checkbox" checked={z.guests} disabled={!canSetup} onChange={(e) => setZone(i, { guests: e.target.checked })} /></td><td>{canSetup && <button type="button" className="secondaryButton danger" onClick={() => setSettings({ ...settings, zones: settings.zones.filter((_, j) => j !== i) })}>✕</button>}</td></tr>)}
            </tbody></table>
            {canSetup && <div className="actions"><button type="button" className="secondaryButton" onClick={() => setSettings({ ...settings, zones: [...settings.zones, { key: "", nameEl: "", nameEn: "", guests: true }] })}>+ {t("ak.addZone")}</button><button type="button" className="primaryAction" disabled={busy} onClick={() => void post({ action: "save_settings", settings })}>{t("ak.save")}</button></div>}
          </div>

          <div className="card akForm">
            <h2>{t("ak.photoTitle")}</h2>
            <p className="muted">{t("ak.photoHelp")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="akPhoto" src={c.photo ?? "/wallet/hero.png"} alt="" />
            {canSetup && <div className="actions">
              <label className="secondaryButton akFile">{t("ak.photoUpload")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.size > 12 * 1024 * 1024) { setMsg(t("ak.err.IMAGE_TOO_LARGE")); return; } await post({ action: "wallet_photo", image: await readFile(f, "base64") }, "ak.photoSaved"); }} /></label>
              {c.photo && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void post({ action: "wallet_photo", image: "" }, "ak.photoSaved")}>{t("ak.photoReset")}</button>}
            </div>}
          </div>

          <div className="card akForm">
            <h2>Apple Wallet</h2>
            <p className="muted">{t("ak.appleHelp")}</p>
            <div className="akCsr">
              <span>{c.has.appleKey ? `✓ ${t("ak.csrReady")}` : t("ak.csrNone")}</span>
              {c.appleCsr && <a className="secondaryButton" download="hotel-corali-wallet.certSigningRequest" href={`data:application/pkcs10;base64,${btoa(c.appleCsr)}`}>{t("ak.csrDownload")}</a>}
              {canSetup && <button type="button" className="secondaryButton" disabled={busy} onClick={() => { if (c.has.appleCert && !confirm(t("ak.csrReplace"))) return; void post({ action: "apple_csr", email: "" }, "ak.csrMade"); }}>{c.has.appleKey ? t("ak.csrNew") : t("ak.csrCreate")}</button>}
            </div>
            <div className="formGrid">
              <label>Pass Type ID<input value={wallet.applePassTypeId} placeholder="pass.gr.hotelcorali.key" disabled={!canSetup} onChange={(e) => setWallet({ ...wallet, applePassTypeId: e.target.value })} /></label>
              <label>Team ID<input value={wallet.appleTeamId} placeholder="ABCDE12345" disabled={!canSetup} onChange={(e) => setWallet({ ...wallet, appleTeamId: e.target.value })} /></label>
              <label>{t("ak.appleCert")} {c.has.appleCert && <small>✓</small>}<input type="file" accept=".cer,.pem,.crt" disabled={!canSetup || !c.has.appleKey} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const txt = await readFile(f, "text"); setSecrets({ ...secrets, appleCert: txt.includes("BEGIN CERTIFICATE") ? txt : await readFile(f, "base64") }); }} /></label>
              <label>{t("ak.appleNfc")}<input value={wallet.appleNfcPublicKey} placeholder={t("ak.optional")} disabled={!canSetup} onChange={(e) => setWallet({ ...wallet, appleNfcPublicKey: e.target.value })} /></label>
            </div>
            {c.apple && <p className="muted">✓ {c.apple.subject} · {t("ak.certExpires", { date: new Date(c.apple.expires).toLocaleDateString(pmsLocale(lang)) })}</p>}
            {c.appleError && <p className="error">{t("ak.err.APPLE_CERTIFICATE_INVALID")}</p>}
            <h2>Google Wallet</h2>
            <p className="muted">{t("ak.googleHelp")}</p>
            <div className="formGrid">
              <label>Issuer ID<input value={wallet.googleIssuerId} placeholder="3388000000012345678" disabled={!canSetup} onChange={(e) => setWallet({ ...wallet, googleIssuerId: e.target.value.replace(/\D/g, "") })} /></label>
              <label>{t("ak.googleKey")} {c.has.googleServiceAccount && <small>✓ {c.googleAccount}</small>}<input type="file" accept=".json,application/json" disabled={!canSetup} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSecrets({ ...secrets, googleServiceAccount: await readFile(f, "text") }); }} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={wallet.googleSmartTap} disabled={!canSetup} onChange={(e) => setWallet({ ...wallet, googleSmartTap: e.target.checked })} />{t("ak.smartTap")}</label>
            {canSetup && <div className="actions"><button type="button" className="primaryAction" disabled={busy} onClick={async () => { if (await post({ action: "save_wallet", config: wallet, secrets })) setSecrets({}); }}>{t("ak.saveWallet")}</button></div>}
          </div>

          <div className="card akForm">
            <h2>{t("ak.readersTitle")}</h2>
            <p className="muted">{t("ak.readersHelp")}</p>
            <pre className="akCode">{`POST /api/public/access/verify\nAuthorization: Bearer <${t("ak.readerKey")}>\n{ "credential": "<QR / NFC>", "zone": "room", "room": "102" }\n→ { "allow": true, "reason": "OK" }`}</pre>
            {readerKey && <p className="notice"><b>{t("ak.readerKeyOnce")}</b><br /><code>{readerKey}</code></p>}
            {canSetup && <button type="button" className="secondaryButton" disabled={busy} onClick={async () => { if (c.has.readerKey && !confirm(t("ak.readerKeyReplace"))) return; const d = await post({ action: "reader_key" }); if (d?.readerKey) setReaderKey(d.readerKey); }}>{c.has.readerKey ? t("ak.readerKeyNew") : t("ak.readerKeyCreate")}</button>}
          </div>
        </>
      )}

      {tab === "log" && (
        <div className="card">
          {data.events.length === 0 ? <p className="muted">{t("ak.noEvents")}</p> : (
            <div className="tableWrap"><table><tbody>{data.events.map((e) => <tr key={e.id}><td>{when(e.at)}</td><td>{e.allowed ? "✅" : "⛔"}</td><td>{e.zone === "room" ? t("hkb.room", { code: e.room }) : zoneName(e.zone)}</td><td>{e.holder || "—"}{e.serial ? <small className="muted"> · {e.serial}</small> : null}</td><td className="muted">{t(`ak.reason.${e.reason}` as PmsKey) !== `ak.reason.${e.reason}` ? t(`ak.reason.${e.reason}` as PmsKey) : e.reason}{e.reader ? ` · ${e.reader}` : ""}</td></tr>)}</tbody></table></div>
          )}
        </div>
      )}
    </div>
  );
}
