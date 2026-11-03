"use client";
import { useMemo, useState } from "react";
import type { FailedRow, LoginRow } from "@/lib/login-history";
import type { DeviceInfo } from "@/lib/user-agent";

const T = {
  el: { sessions: "Συνδέσεις", failed: "Αποτυχημένες προσπάθειες", user: "Χρήστης", all: "Όλοι οι χρήστες", when: "Σύνδεση", last: "Τελευταία δραστηριότητα", end: "Λήξη", ip: "Διεύθυνση IP", device: "Συσκευή", status: "Κατάσταση", local: "τοπικό δίκτυο", revoke: "Τερματισμός", revokeQ: "Να τερματιστεί αυτή η σύνδεση; Ο χρήστης θα χρειαστεί να συνδεθεί ξανά.", you: "εσείς", none: "Καμία εγγραφή.", reason: "Αιτία", name: "Όνομα χρήστη", onlyActive: "Μόνο ενεργές",
    st: { active: "● Ενεργή", logout: "Αποσύνδεση", idle: "Αδράνεια 2 ωρών", revoked: "Τερματίστηκε", expired: "Έληξε (8 ώρες)" }, kind: { computer: "💻 Υπολογιστής", phone: "📱 Κινητό", tablet: "📱 Tablet", tv: "📺 Τηλεόραση", unknown: "❔ Άγνωστη" },
    fr: { credentials: "Λάθος όνομα ή κωδικός", second_factor: "Λάθος κωδικός 2FA", blocked: "Μπλοκαρίστηκε (πολλές προσπάθειες)" } },
  en: { sessions: "Sign-ins", failed: "Failed attempts", user: "User", all: "All users", when: "Signed in", last: "Last activity", end: "Ended", ip: "IP address", device: "Device", status: "Status", local: "local network", revoke: "End session", revokeQ: "End this session? The user will have to sign in again.", you: "you", none: "No records.", reason: "Reason", name: "User name", onlyActive: "Active only",
    st: { active: "● Active", logout: "Signed out", idle: "Idle 2 hours", revoked: "Ended by admin", expired: "Expired (8 hours)" }, kind: { computer: "💻 Computer", phone: "📱 Phone", tablet: "📱 Tablet", tv: "📺 TV", unknown: "❔ Unknown" },
    fr: { credentials: "Wrong user name or password", second_factor: "Wrong 2FA code", blocked: "Blocked (too many tries)" } },
};

const fmt = (ms: number | null, lang: string) => (ms ? new Intl.DateTimeFormat(lang === "el" ? "el-GR" : "en-GB", { timeZone: "Europe/Athens", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(ms) : "—");

function Device({ d, agent, t }: { d: DeviceInfo; agent: string; t: (typeof T)["el"] }) {
  return <span title={agent}>{t.kind[d.kind]}<small>{[d.os, d.browser].filter(Boolean).join(" · ") || "—"}</small></span>;
}

export function LoginHistory({ lang, sessions: initial, failed, currentSessionId, canRevoke }: { lang: string; sessions: LoginRow[]; failed: FailedRow[]; currentSessionId: number; canRevoke: boolean }) {
  const t = T[lang === "el" ? "el" : "en"];
  const [tab, setTab] = useState<"sessions" | "failed">("sessions");
  const [sessions, setSessions] = useState(initial);
  const [who, setWho] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const users = useMemo(() => [...new Map(initial.filter((s) => s.userId).map((s) => [String(s.userId), s.user])).entries()], [initial]);
  const rows = sessions.filter((s) => (!who || String(s.userId) === who) && (!onlyActive || s.status === "active"));
  async function revoke(id: number) {
    if (!confirm(t.revokeQ)) return;
    const r = await fetch("/api/pms/logins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke", sessionId: id }) });
    if ((await r.json().catch(() => ({}))).ok) setSessions((v) => v.map((s) => (s.id === id ? { ...s, status: "revoked", endedAt: Date.now() } : s)));
  }
  return (
    <div className="loginHistory">
      <div className="tvLangTabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "sessions"} className={tab === "sessions" ? "active" : ""} onClick={() => setTab("sessions")}>{t.sessions} ({sessions.length})</button>
        <button type="button" role="tab" aria-selected={tab === "failed"} className={tab === "failed" ? "active" : ""} onClick={() => setTab("failed")}>{t.failed} ({failed.length})</button>
      </div>
      {tab === "sessions" ? (
        <>
          <div className="loginFilters">
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t.user}><option value="">{t.all}</option>{users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <label className="inline"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> {t.onlyActive}</label>
          </div>
          <div className="tableWrap"><table className="loginTable"><thead><tr><th>{t.user}</th><th>{t.when}</th><th>{t.last}</th><th>{t.status}</th><th>{t.ip}</th><th>{t.device}</th><th /></tr></thead>
            <tbody>{rows.length ? rows.map((s) => (
              <tr key={s.id} className={s.status === "active" ? "isActive" : ""}>
                <td><b>{s.user}</b><small>{s.username} · {s.role}{s.id === currentSessionId ? ` · ${t.you}` : ""}</small></td>
                <td>{fmt(s.at, lang)}</td>
                <td>{fmt(s.lastSeen, lang)}</td>
                <td><span className={`loginStatus ${s.status}`}>{t.st[s.status]}</span>{s.endedAt && <small>{fmt(s.endedAt, lang)}</small>}</td>
                <td><span title={s.chain}>{s.ip || "—"}</span>{s.local && <small>{t.local}</small>}</td>
                <td><Device d={s.device} agent={s.agent} t={t} /></td>
                <td>{canRevoke && s.status === "active" && s.id !== currentSessionId && <button type="button" className="secondaryButton danger" onClick={() => void revoke(s.id)}>{t.revoke}</button>}</td>
              </tr>
            )) : <tr><td colSpan={7}>{t.none}</td></tr>}</tbody></table></div>
        </>
      ) : (
        <div className="tableWrap"><table className="loginTable"><thead><tr><th>{t.when}</th><th>{t.name}</th><th>{t.reason}</th><th>{t.ip}</th><th>{t.device}</th></tr></thead>
          <tbody>{failed.length ? failed.map((f, i) => (
            <tr key={i}><td>{fmt(f.at, lang)}</td><td><b>{f.username || "—"}</b></td><td><span className={`loginStatus ${f.reason === "blocked" ? "revoked" : "failed"}`}>{t.fr[f.reason as keyof typeof t.fr] ?? f.reason}</span></td><td>{f.ip || "—"}</td><td><Device d={f.device} agent={f.agent} t={t} /></td></tr>
          )) : <tr><td colSpan={5}>{t.none}</td></tr>}</tbody></table></div>
      )}
    </div>
  );
}
