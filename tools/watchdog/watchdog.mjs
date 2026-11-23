#!/usr/bin/env node
// Corali external watchdog (Fly.io) — runs OUTSIDE the hotel's hosting, so it keeps watching and alerting when the
// PMS, its database, its cron or its email are down. No dependencies (Node 22+). Read-only towards the PMS.
//
// Every cycle (INTERVAL_S):
//   pms / booking   GET /api/health → 200 and ok:true within 10 s
//   heartbeat       GET /api/monitoring/heartbeat → HMAC signature valid (MONITORING_SECRET), timestamp fresh,
//                   database / Sentinel / cron statuses, and PROGRESS: the Sentinel and cron run counters must grow
// A check is an incident after FAIL_THRESHOLD consecutive failures (one alert), reminded every REMIND_MIN, and
// resolved after 2 consecutive successes (one recovery alert). Alerts go to every configured channel (Telegram, ntfy,
// webhook) with retries; undelivered alerts are retried next cycle. DEADMAN_URL (e.g. healthchecks.io) is pinged
// each cycle so the watchdog itself is watched too.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const MIN = 60_000;
export function configFromEnv(env = process.env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    pmsHealthUrl: env.PMS_HEALTH_URL ?? "", bookingHealthUrl: env.BOOKING_HEALTH_URL ?? "", heartbeatUrl: env.PMS_HEARTBEAT_URL ?? "",
    secret: env.MONITORING_SECRET ?? "", intervalS: n(env.INTERVAL_S, 60), failThreshold: n(env.FAIL_THRESHOLD, 3), remindMin: n(env.REMIND_MIN, 60),
    heartbeatMaxAgeS: n(env.HEARTBEAT_MAX_AGE_S, 300), progressStaleS: n(env.PROGRESS_STALE_S, 1200), timeoutMs: n(env.TIMEOUT_MS, 10_000),
    telegram: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID } : null,
    ntfyUrl: env.NTFY_URL ?? "", webhookUrl: env.ALERT_WEBHOOK_URL ?? "", deadmanUrl: env.DEADMAN_URL ?? "", stateFile: env.STATE_FILE ?? "", label: env.WATCHDOG_LABEL ?? "Hotel Corali",
  };
}

export function verifySignature(secret, header, body, now, maxAgeMs) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(header ?? ""));
  if (!m || !secret) return "missing";
  if (Math.abs(now - Number(m[1])) > maxAgeMs) return "stale";
  const a = Buffer.from(createHmac("sha256", secret).update(`${m[1]}.${body}`).digest("hex"), "hex"), b = Buffer.from(m[2], "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "invalid";
}

/** Only the exact "ok" is health; "warn" → warning; "fail" / "unknown" / anything else / missing → critical. */
export function componentResult(name, status, hb) {
  if (status === "ok") return { ok: true };
  const extra = name === "sentinel" ? ` (τελευταία εκτέλεση πριν ${hb?.progress?.sentinelLastRunAgoS ?? "?"}″)` : "";
  if (status === "warn") return { ok: false, severity: "warning", detail: `${name}: warn${extra}` };
  if (status === undefined || status === null) return { ok: false, severity: "critical", detail: `${name}: λείπει από το heartbeat` };
  return { ok: false, severity: "critical", detail: `${name}: ${String(status).slice(0, 20)}${extra}` };
}

/** Safe parse + schema check of the heartbeat body. */
const REQUIRED = ["database", "automations", "sentinel"];
export function parseHeartbeat(text) {
  let v;
  try { v = JSON.parse(text); } catch { return { error: "το σώμα δεν είναι έγκυρο JSON" }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "το σώμα δεν είναι αντικείμενο" };
  if (typeof v.service !== "string" || !Number.isFinite(Number(v.at))) return { error: "λείπουν service / at" };
  if (!v.components || typeof v.components !== "object" || Array.isArray(v.components)) return { error: "λείπουν τα components" };
  for (const k of REQUIRED) if (!(k in v.components)) return { error: `λείπει το component ${k}` };
  if (!v.progress || typeof v.progress !== "object" || !Number.isFinite(Number(v.progress.sentinelRuns)) || !Number.isFinite(Number(v.progress.automationsRuns))) return { error: "λείπουν οι μετρητές προόδου" };
  return { value: v };
}

export function createWatchdog(cfg, { fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (l) => console.log(l) } = {}) {
  let state = { checks: {}, outbox: [], progress: {} };
  if (cfg.stateFile) { try { state = { ...state, ...JSON.parse(readFileSync(cfg.stateFile, "utf8")) }; } catch { /* first start */ } }
  // Returns false when the state could not be saved — reported as the «state_storage» check, never silent.
  let storageError = null;
  const persist = () => {
    if (!cfg.stateFile) return true;
    try { writeFileSync(`${cfg.stateFile}.tmp`, JSON.stringify(state)); renameSync(`${cfg.stateFile}.tmp`, cfg.stateFile); storageError = null; return true; }
    catch (e) { storageError = String(e.message).slice(0, 120); log(JSON.stringify({ level: "error", event: "state_write_failed", error: storageError })); return false; }
  };
  const get = async (url) => {
    const ctl = AbortSignal.timeout(cfg.timeoutMs);
    const r = await fetchImpl(url, { headers: { "User-Agent": "corali-watchdog" }, signal: ctl, cache: "no-store" });
    return { status: r.status, text: await r.text(), headers: r.headers };
  };

  async function health(url) {
    try { const r = await get(url); let j = null; try { j = JSON.parse(r.text); } catch { /* not json */ } return r.status === 200 && j?.ok === true ? { ok: true } : { ok: false, detail: `HTTP ${r.status}${j?.reason ? ` (${j.reason})` : ""}` }; }
    catch (e) { return { ok: false, detail: e?.name === "TimeoutError" ? `καμία απάντηση σε ${cfg.timeoutMs / 1000}″` : `μη προσβάσιμο (${e?.cause?.code ?? e?.message ?? e})` }; }
  }

  /**
   * The heartbeat gives several checks. ONLY the exact status "ok" is health: "warn" is a warning, "fail",
   * "unknown", anything else or a missing component is critical. A body that is not valid JSON or does not match the
   * schema is HEARTBEAT_INVALID — never an exception that skips the cycle.
   */
  async function heartbeat(t) {
    const out = {};
    let r;
    try { r = await get(cfg.heartbeatUrl); } catch (e) { out.heartbeat = { ok: false, severity: "critical", detail: `μη προσβάσιμο (${e?.cause?.code ?? e?.message ?? e})` }; return out; }
    if (r.status !== 200) { out.heartbeat = { ok: false, severity: "critical", detail: `HTTP ${r.status}` }; return out; }
    const sig = verifySignature(cfg.secret, r.headers.get("x-corali-signature"), r.text, t, cfg.heartbeatMaxAgeS * 1000);
    if (sig !== "ok") { out.heartbeat = { ok: false, severity: "critical", detail: `υπογραφή ${sig} — το heartbeat δεν μπορεί να επαληθευτεί` }; return out; }
    const parsed = parseHeartbeat(r.text);
    if (parsed.error) { out.heartbeat = { ok: false, severity: "critical", detail: `HEARTBEAT_INVALID: ${parsed.error}` }; return out; }
    const hb = parsed.value;
    out.heartbeat = { ok: true };
    for (const [name, label] of [["database", "database"], ["automations", "cron"], ["sentinel", "sentinel"]]) out[label] = componentResult(name, hb.components[name], hb);
    // Every other component the PMS reports is watched too (OTA queue, alerts, backups, social …).
    for (const [name, status] of Object.entries(hb.components)) if (!["database", "automations", "sentinel"].includes(name)) out[`component:${name}`] = componentResult(name, status, hb);
    // Progress: a counter that stopped growing = a stalled worker, even if every status still says ok.
    for (const [k, label] of [["sentinelRuns", "sentinel_progress"], ["automationsRuns", "cron_progress"]]) {
      const v = Number(hb.progress[k]), p = state.progress[k];
      if (!p || v > p.value) state.progress[k] = { value: v, since: t };
      const stale = t - state.progress[k].since > cfg.progressStaleS * 1000;
      out[label] = stale ? { ok: false, severity: "critical", detail: `ο μετρητής ${k} = ${v} δεν αυξάνεται εδώ και ${Math.round((t - state.progress[k].since) / MIN)}′` } : { ok: true };
    }
    return out;
  }

  async function deliver(msg) {
    const targets = [];
    if (cfg.telegram) targets.push(["telegram", () => fetchImpl(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: cfg.telegram.chat, text: msg.text }), signal: AbortSignal.timeout(cfg.timeoutMs) })]);
    if (cfg.ntfyUrl) targets.push(["ntfy", () => fetchImpl(cfg.ntfyUrl, { method: "POST", headers: { Title: `${cfg.label} watchdog`, Priority: msg.kind === "open" ? "high" : "default" }, body: msg.text, signal: AbortSignal.timeout(cfg.timeoutMs) })]);
    if (cfg.webhookUrl) targets.push(["webhook", () => fetchImpl(cfg.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg), signal: AbortSignal.timeout(cfg.timeoutMs) })]);
    msg.delivered ??= [];
    for (const [name, send] of targets) {
      if (msg.delivered.includes(name)) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { const r = await send(); if (r.ok) { msg.delivered.push(name); break; } } catch { /* retry */ }
        await sleep(200 * 2 ** attempt);
      }
    }
    return targets.length > 0 && msg.delivered.length === targets.length;
  }

  async function cycle() {
    const t = now();
    const results = {};
    // Each check is isolated: an unexpected error is that check's failure, never the end of the cycle.
    const guard = async (fn, name) => { try { return await fn(); } catch (e) { return { [name]: { ok: false, severity: "critical", detail: `σφάλμα ελέγχου: ${String(e?.message ?? e).slice(0, 120)}` } }; } };
    if (cfg.pmsHealthUrl) Object.assign(results, await guard(async () => ({ pms: await health(cfg.pmsHealthUrl) }), "pms"));
    if (cfg.bookingHealthUrl) Object.assign(results, await guard(async () => ({ booking: await health(cfg.bookingHealthUrl) }), "booking"));
    if (cfg.heartbeatUrl) Object.assign(results, await guard(() => heartbeat(t), "heartbeat"));
    if (cfg.stateFile) results.state_storage = storageError ? { ok: false, severity: "warning", detail: `η κατάσταση του watchdog δεν αποθηκεύεται (${storageError}) — μετά από επανεκκίνηση χάνεται` } : { ok: true };
    for (const [name, r] of Object.entries(results)) {
      const c = (state.checks[name] ??= { fails: 0, oks: 0, open: false, openedAt: null, lastAlertAt: null });
      if (r.ok) {
        c.fails = 0; c.oks++;
        if (c.open && c.oks >= 2) { c.open = false; state.outbox.push({ kind: "resolved", check: name, at: t, text: `✅ ${cfg.label}: «${name}» αποκαταστάθηκε (διάρκεια ${Math.round((t - c.openedAt) / MIN)}′)` }); }
      } else {
        // Severity decides how soon and how often: critical after FAIL_THRESHOLD checks, reminded every REMIND_MIN;
        // a warning after 3 × FAIL_THRESHOLD checks, reminded every 6 × REMIND_MIN. A warning that becomes critical is
        // escalated at once.
        const sev = r.severity === "warning" ? "warning" : "critical";
        const icon = sev === "warning" ? "🟠" : "🔴";
        c.oks = 0; c.fails++; c.detail = r.detail;
        const threshold = sev === "warning" ? cfg.failThreshold * 3 : cfg.failThreshold, remind = (sev === "warning" ? 6 : 1) * cfg.remindMin * MIN;
        if (!c.open && c.fails >= threshold) { c.open = true; c.severity = sev; c.openedAt = t; c.lastAlertAt = t; state.outbox.push({ kind: "open", severity: sev, check: name, at: t, text: `${icon} ${cfg.label}: «${name}» — ${r.detail} (${c.fails} συνεχόμενοι έλεγχοι)` }); }
        else if (c.open && c.severity === "warning" && sev === "critical" && c.fails >= cfg.failThreshold) { c.severity = "critical"; c.lastAlertAt = t; state.outbox.push({ kind: "escalated", severity: sev, check: name, at: t, text: `🔴 ${cfg.label}: «${name}» έγινε κρίσιμο — ${r.detail}` }); }
        else if (c.open && t - c.lastAlertAt >= remind) { c.lastAlertAt = t; state.outbox.push({ kind: "reminder", severity: c.severity, check: name, at: t, text: `${c.severity === "warning" ? "🟠" : "🔴"} ${cfg.label}: «${name}» εξακολουθεί — ${r.detail} (από ${Math.round((t - c.openedAt) / MIN)}′)` }); }
      }
    }
    // Saved BEFORE delivering: an alert decided in this cycle survives a restart even if delivery never happened.
    persist();
    const pending = [];
    for (const msg of state.outbox) if (!(await deliver(msg))) pending.push(msg);
    state.outbox = pending.slice(-50);
    if (cfg.deadmanUrl) { try { await fetchImpl(cfg.deadmanUrl, { signal: AbortSignal.timeout(cfg.timeoutMs) }); } catch { /* the dead-man service alerts on missing pings */ } }
    persist();
    const line = JSON.stringify({ event: "watchdog_cycle", at: new Date(t).toISOString(), results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.ok ? "ok" : v.detail])), open: Object.entries(state.checks).filter(([, c]) => c.open).map(([k]) => k), undelivered: state.outbox.length });
    log(line);
    return { results, state };
  }
  return { cycle, state: () => state };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = configFromEnv();
  if (!cfg.pmsHealthUrl && !cfg.heartbeatUrl) { console.error("PMS_HEALTH_URL and/or PMS_HEARTBEAT_URL are required"); process.exit(2); }
  if (!cfg.telegram && !cfg.ntfyUrl && !cfg.webhookUrl) console.error("WARNING: no alert channel configured (TELEGRAM_*, NTFY_URL or ALERT_WEBHOOK_URL)");
  const wd = createWatchdog(cfg);
  for (;;) { await wd.cycle().catch((e) => console.error(JSON.stringify({ level: "error", event: "cycle_failed", error: String(e?.message ?? e) }))); await new Promise((r) => setTimeout(r, cfg.intervalS * 1000)); }
}
