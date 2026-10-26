"use client";
import { useEffect, useRef, useState } from "react";
import { checklistFor } from "@/lib/housekeeping";
import type { PmsKey, PmsLang, pmsT } from "@/lib/pms-i18n";
import type { ResolvedAction } from "@/lib/staff-voice";

type T = ReturnType<typeof pmsT>;
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
type Row = ResolvedAction & { on: boolean; state?: "ok" | "fail" | "skip"; error?: string };

const recognitionCtor = () => (typeof window === "undefined" ? null : ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition ?? null));

let lastError = "";
async function call(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) lastError = String((await r.json().catch(() => ({}))).error ?? "");
  return r.ok;
}

/** 🎤 Say (or type) what was done; the app lists the actions it understood and runs them after "Run". */
export function VoiceCommand({ lang, t, toast, onDone }: { lang: PmsLang; t: T; toast: (s: string) => void; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  useEffect(() => () => rec.current?.stop(), []);

  async function parse(sentence: string) {
    if (sentence.trim().length < 2) return;
    setBusy(true); setRows(null);
    try {
      const r = await fetch("/api/pms/staff-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: sentence }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(t("vc.failed")); return; }
      setAi(Boolean(d.ai));
      setRows((d.actions as ResolvedAction[]).map((a) => ({ ...a, on: runnable(a) })));
    } finally { setBusy(false); }
  }

  function listen() {
    const Ctor = recognitionCtor();
    setOpen(true); setRows(null);
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang === "el" ? "el-GR" : "en-GB";
    r.interimResults = true;
    r.continuous = false;
    finalText.current = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) finalText.current += `${res[0].transcript} `; else interim += res[0].transcript; }
      setText(`${finalText.current}${interim}`.trim());
    };
    r.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") toast(t("vc.micError")); };
    r.onend = () => { setListening(false); const said = finalText.current.trim(); if (said) { setText(said); void parse(said); } };
    rec.current = r;
    setText("");
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

  const runnable = (a: ResolvedAction) => {
    if (a.type === "complete_clean") return Boolean(a.task && (a.task.status === "todo" || a.task.status === "in_progress"));
    if (a.type === "start_clean") return a.task?.status === "todo";
    if (a.type === "linen") return Boolean(a.bookingId);
    return true;
  };

  async function runOne(a: Row): Promise<boolean> {
    if (a.type === "complete_clean" && a.task) {
      if (a.task.status === "todo" && !(await call(`/api/pms/housekeeping/${a.task.id}`, "PATCH", { action: "start" }))) return false;
      const checklist = Object.fromEntries(checklistFor(a.task.type).map((k) => [k, true]));
      return call(`/api/pms/housekeeping/${a.task.id}`, "PATCH", { action: "complete", checklist });
    }
    if (a.type === "start_clean" && a.task) return call(`/api/pms/housekeeping/${a.task.id}`, "PATCH", { action: "start" });
    // A defect is logged on the room (not on the cleaning task), so "ready, but the lamp is broken" works in any order.
    if (a.type === "report_issue") return call("/api/pms/maintenance", "POST", { roomId: a.roomId, severity: a.severity ?? "minor", description: a.description });
    if (a.type === "linen" && a.bookingId) return call("/api/pms/housekeeping/services", "POST", { action: "done", bookingId: a.bookingId, service: a.service, done: true });
    if (a.type === "message") return call("/api/pms/staff-messages", "POST", { action: "message", body: a.body, roomId: a.roomId });
    return false;
  }

  async function run() {
    if (!rows) return;
    setBusy(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].on) { next[i] = { ...next[i], state: "skip" }; continue; }
      lastError = "";
      const ok = await runOne(next[i]).catch(() => false);
      next[i] = { ...next[i], state: ok ? "ok" : "fail", error: ok ? undefined : lastError };
      setRows([...next]);
    }
    setBusy(false);
    const failed = next.filter((x) => x.state === "fail").length;
    toast(failed ? t("vc.someFailed", { n: failed }) : t("vc.allDone"));
    onDone();
  }

  const label = (a: Row) => {
    const room = a.room ? `${a.room}: ` : "";
    if (a.type === "complete_clean") return `✓ ${room}${t("vc.complete")}${!runnable(a) ? ` (${t("vc.noTask")})` : ""}`;
    if (a.type === "start_clean") return `▶ ${room}${t("vc.start")}${!runnable(a) ? ` (${t("vc.noTask")})` : ""}`;
    if (a.type === "report_issue") return `⚠ ${room}${t(`mnt.sev.${a.severity ?? "minor"}` as PmsKey)} — ${a.description}`;
    if (a.type === "linen") return `🛏 ${room}${t(a.service === "sheets" ? "hkm.sheetsChanged" : "hkm.towelsChanged")}${!runnable(a) ? ` (${t("vc.noStay")})` : ""}`;
    return `💬 ${t("hkm.toReception")}: ${a.body}`;
  };

  return (
    <>
      <button type="button" className={`stMic${listening ? " on" : ""}`} aria-label={t("vc.title")} onClick={() => (listening ? rec.current?.stop() : listen())}>🎤</button>
      {open && (
        <div className="hkSheet" role="dialog" aria-modal="true" aria-label={t("vc.title")}>
          <div className="hkSheetCard">
            <h2>🎤 {t("vc.title")}</h2>
            {!recognitionCtor() && <p className="hkNote">{t("vc.typeHint")}</p>}
            {listening && <p className="hkNote listening">● {t("vc.listening")}</p>}
            <textarea value={text} placeholder={t("vc.example")} onChange={(e) => setText(e.target.value)} />
            <div className="hkActions">
              {recognitionCtor() && <button type="button" onClick={() => (listening ? rec.current?.stop() : listen())}>{listening ? `■ ${t("vc.stop")}` : `🎤 ${t("vc.again")}`}</button>}
              <button type="button" disabled={busy || text.trim().length < 2} onClick={() => void parse(text)}>{t("vc.understand")}</button>
            </div>
            {busy && !rows && <p className="hkEmpty sm">…</p>}
            {rows && (rows.length === 0 ? <p className="hkNote warn">{t("vc.nothing")}</p> : (
              <>
                <p className="hkEmpty sm">{t(ai ? "vc.understoodAi" : "vc.understood")}</p>
                <ul className="hkChecklist vcList">
                  {rows.map((a, i) => <li key={i} className={a.state ? `st-${a.state}` : ""}><label><input type="checkbox" checked={a.on} disabled={!runnable(a) || Boolean(a.state)} onChange={() => setRows(rows.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} /> {label(a)}{a.state === "ok" ? " ✅" : a.state === "fail" ? " ❌" : ""}</label>{a.state === "fail" && a.error && <small className="vcErr">{t(`err.${a.error}` as PmsKey) !== `err.${a.error}` ? t(`err.${a.error}` as PmsKey) : a.error}</small>}</li>)}
                </ul>
              </>
            ))}
            <div className="hkActions">
              <button type="button" onClick={() => { rec.current?.stop(); setOpen(false); setRows(null); setText(""); }}>{t("hkb.cancel")}</button>
              <button type="button" className="primary" disabled={busy || !rows?.some((x) => x.on && !x.state)} onClick={() => void run()}>{t("vc.run")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
