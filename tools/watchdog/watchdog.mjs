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
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

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

export const BATCH_MAX = 5, QUEUE_WARN = 50, QUEUE_MAX = 100;
/**
 * Telegram accepts at most 4096 characters, ntfy 4096 BYTES as a message (Greek = 2 bytes, emoji = 4): a text is
 * kept within TEXT_MAX bytes, which satisfies both.
 */
export const TEXT_MAX = 3500, ITEMS_MAX = 1000;
const bytes = (t) => Buffer.byteLength(t, "utf8");
/** A message text from lines, within TEXT_MAX bytes: the head, the lines that fit, then «… και N ακόμη». */
export function listText(head, lines) {
  let text = head, shown = 0;
  const tail = (n) => `\n… και ${n} ακόμη — όλες στο log του watchdog (fly logs)`;
  for (const l of lines) {
    const next = `${text}\n• ${l}`;
    if (bytes(next) + bytes(tail(lines.length)) > TEXT_MAX) break;
    text = next; shown++;
  }
  return shown < lines.length ? text + tail(lines.length - shown) : text;
}
/** A single text within TEXT_MAX bytes (cut on a character boundary). */
export function clipText(t) {
  const text = String(t ?? "");
  if (bytes(text) <= TEXT_MAX) return text;
  const suffix = "… (περικομμένο — πλήρες στο log)", room = TEXT_MAX - bytes(suffix);
  let out = "", size = 0;
  for (const ch of text) { const b = bytes(ch); if (size + b > room) break; out += ch; size += b; }
  return out + suffix;
}
const priorityOf = (m) => ((m.kind === "open" || m.kind === "escalated" || m.kind === "batch" || m.kind === "digest") && m.severity === "critical" ? 1 : m.kind === "open" || m.kind === "batch" || m.kind === "escalated" ? 2 : m.kind === "resolved" ? 3 : 4);
const itemsOf = (m) => (m.kind === "batch" || m.kind === "digest" ? m.items ?? [] : [{ kind: m.kind, severity: m.severity, check: m.check, at: m.at, text: m.text }]);
/** Bounded state without loss: beyond ITEMS_MAX, items of the same check and kind are counted together. */
function collapseItems(items) {
  if (items.length <= ITEMS_MAX) return items;
  const by = new Map();
  for (const x of items) {
    const k = `${x.check}|${x.kind}`, g = by.get(k);
    if (!g) by.set(k, { ...x, count: Number(x.count) || 1, firstAt: x.firstAt ?? x.at });
    else { g.count += Number(x.count) || 1; if ((Number(x.at) || 0) >= (Number(g.at) || 0)) { g.at = x.at; g.text = x.text; } if (x.severity === "critical") g.severity = "critical"; }
  }
  return [...by.values()];
}
/** Has this channel finished with the message? (accepted, given up after refusals, or merged into its digest) */
export const doneFor = (m, name) => Boolean(m?.delivered?.includes(name) || m?.gaveUp?.[name] || m?.merged?.includes(name));

/**
 * v204 (review 6) — bounded WITHOUT loss and WITHOUT reordering, per channel: every channel reads the queue in
 * arrival order. When more than QUEUE_MAX messages wait for one channel, ALL of them are merged, in order, into one
 * digest for THAT channel only (the other channels are not sent it); since nothing else waits for that channel, the
 * digest is its next message and newer ones follow it. A message is removed once every channel is done with it.
 */
export function compactOutbox(outbox, label = "", targets = ["telegram", "ntfy", "webhook"]) {
  let box = outbox;
  for (const t of targets) {
    const pending = box.filter((m) => !doneFor(m, t));
    if (pending.length <= QUEUE_MAX) continue;
    const items = collapseItems(pending.flatMap(itemsOf));
    const total = items.reduce((n, x) => n + (Number(x.count) || 1), 0);
    for (const m of pending) m.merged = [...new Set([...(m.merged ?? []), t])];
    // Text: critical first, then the newest — what matters most is never hidden behind «… και N ακόμη».
    const shown = items.map((x, i) => ({ x, i })).sort((a, b) => (b.x.severity === "critical") - (a.x.severity === "critical") || b.i - a.i).map(({ x }) => `${x.text}${Number(x.count) > 1 ? ` (×${x.count})` : ""}`);
    box = [...box, { kind: "digest", severity: items.some((x) => x.severity === "critical") ? "critical" : "warning", check: "*", at: Math.max(0, ...items.map((x) => Number(x.at) || 0)), items,
      delivered: targets.filter((o) => o !== t), gaveUp: {}, errors: {}, text: listText(`📋 ${label}: ${total} ειδοποιήσεις συγκεντρώθηκαν (η ουρά του καναλιού ${t} ξεπέρασε τις ${QUEUE_MAX})`, shown) }];
  }
  return box.filter((m) => !targets.every((t) => doneFor(m, t)));
}

export function createWatchdog(cfg, { fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (l) => console.log(l) } = {}) {
  let state = { checks: {}, outbox: [], progress: {} };
  if (cfg.stateFile && existsSync(cfg.stateFile)) {
    try { state = { ...state, ...JSON.parse(readFileSync(cfg.stateFile, "utf8")) }; }
    catch (e) {
      // Unreadable state: kept aside (not overwritten silently) and reported in the log.
      try { renameSync(cfg.stateFile, `${cfg.stateFile}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      log(JSON.stringify({ level: "error", event: "state_unreadable", error: String(e?.message ?? e).slice(0, 120) }));
    }
  }
  // A damaged state file must not stop the watchdog: anything but the expected shapes is reset (and reported in the log).
  if (!Array.isArray(state.outbox)) { log(JSON.stringify({ level: "error", event: "state_outbox_invalid" })); state.outbox = []; }
  const obj = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (!obj(state.checks)) state.checks = {};
  for (const [k, c] of Object.entries(state.checks)) if (!obj(c)) delete state.checks[k];
  if (!obj(state.progress)) state.progress = {};
  state.outbox = state.outbox.filter((m) => obj(m) && typeof m.text === "string");
  for (const m of state.outbox) {
    for (const f of ["delivered", "merged"]) if (m[f] !== undefined && !Array.isArray(m[f])) m[f] = [];
    for (const f of ["errors", "refused", "gaveUp"]) if (m[f] !== undefined && !obj(m[f])) m[f] = {};
    if (m.refused) for (const [k, v] of Object.entries(m.refused)) if (!Number.isFinite(Number(v))) m.refused[k] = 0;
    if (m.items !== undefined) m.items = Array.isArray(m.items) ? m.items.filter((x) => obj(x) && typeof x.text === "string") : [];
  }
  for (const [k, v] of Object.entries(state.progress)) if (!obj(v)) delete state.progress[k];
  // Messages saved by an older version may be longer than the channels accept.
  for (const m of state.outbox) m.text = clipText(m.text);
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

  /**
   * v203: delivered = the provider ACCEPTED the message at application level, not just «HTTP 2xx»:
   *   Telegram → HTTP 2xx and JSON { ok: true } (the Bot API answers HTTP 200 with { ok: false } on some refusals);
   *   ntfy     → HTTP 2xx and JSON with the message id;
   *   webhook  → HTTP 2xx (our own receiver: its status is its answer).
   * Anything else keeps the message in the queue (retried in the next cycle, also after a restart).
   */
  async function accepted(name, r) {
    // v204: { reason, messageSpecific }. Message-specific = the channel works but refuses THIS message (too large /
    // unreadable): 413, Telegram 400 «message is too long / can't parse / text is empty», webhook 413 / 422. Every
    // other refusal — 401 / 403 (token, blocked bot), 404, 400 «chat not found», 408 / 429, 5xx, network — is the
    // CHANNEL failing: the message stays queued for it until the channel is fixed.
    if (!r?.ok) {
      const body = name === "telegram" ? await r?.json?.().catch(() => null) : null;
      const desc = String(body?.description ?? "");
      const specific = r?.status === 413 || (name === "telegram" && r?.status === 400 && /too long|can't parse|text is empty|entities/i.test(desc)) || (name === "webhook" && r?.status === 422);
      return { reason: `HTTP ${r?.status ?? "—"}${desc ? ` ${desc.slice(0, 100)}` : ""}`, messageSpecific: specific };
    }
    if (name === "webhook") return true;
    const body = await r.json().catch(() => null);
    if (name === "telegram") return body?.ok === true ? true : { reason: `Telegram: ${String(body?.description ?? "ok≠true").slice(0, 120)}`, messageSpecific: /too long|can't parse|text is empty|entities/i.test(String(body?.description ?? "")) };
    if (name === "ntfy") return body && typeof body.id === "string" && body.id ? true : { reason: "ntfy: απάντηση χωρίς id μηνύματος", messageSpecific: false };
    return { reason: `άγνωστος πάροχος ${name}`, messageSpecific: false };
  }

  const targetNames = () => [cfg.telegram && "telegram", cfg.ntfyUrl && "ntfy", cfg.webhookUrl && "webhook"].filter(Boolean);
  function sender(name, msg) {
    const urgent = msg.severity === "critical" && ["open", "escalated", "batch", "digest"].includes(msg.kind);
    if (name === "telegram") return () => fetchImpl(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: cfg.telegram.chat, text: msg.text }), signal: AbortSignal.timeout(cfg.timeoutMs) });
    if (name === "ntfy") return () => fetchImpl(cfg.ntfyUrl, { method: "POST", headers: { Title: `${cfg.label} watchdog`, Priority: urgent ? "high" : "default" }, body: msg.text, signal: AbortSignal.timeout(cfg.timeoutMs) });
    return () => fetchImpl(cfg.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg), signal: AbortSignal.timeout(cfg.timeoutMs) });
  }
  /**
   * v204 (review 6): one channel reads the queue STRICTLY in arrival order and stops at the first message it cannot
   * deliver now — the order is kept per channel by construction (no message overtakes an older one, batches and
   * digests included). Channel failure (network, 5xx, 401 / 403 / 404, 429…): stop, retry next cycle. Refusal of the
   * message itself (413, «too long / can't parse»): stop too; after 3 cycles that message is given up for this
   * channel (logged in full, reported as alert_undeliverable) and the channel continues with the next one.
   */
  async function deliverChannel(name, deadline) {
    for (const msg of state.outbox) {
      if (doneFor(msg, name)) continue;
      if (now() > deadline) return;
      msg.delivered ??= []; msg.errors ??= {}; msg.refused ??= {}; msg.gaveUp ??= {};
      const send = sender(name, msg);
      let verdict = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { verdict = await accepted(name, await send()); } catch (e) { verdict = { reason: `σύνδεση: ${String(e?.message ?? e).slice(0, 120)}`, messageSpecific: false }; }
        if (verdict === true || verdict.messageSpecific) break;
        if (attempt < 2 && now() <= deadline) await sleep(200 * 2 ** attempt); else break;
      }
      if (verdict === true) { msg.delivered.push(name); delete msg.errors[name]; persist(); continue; } // saved at once
      msg.errors[name] = verdict.reason;
      if (!verdict.messageSpecific) return; // the channel is down: the rest waits, in order
      msg.refused[name] = (Number(msg.refused[name]) || 0) + 1;
      if (msg.refused[name] < 3) return; // hold the line: newer messages must not overtake it
      msg.gaveUp[name] = msg.errors[name];
      state.undeliverable = { count: (state.undeliverable?.count ?? 0) + 1, at: now(), last: `${name}: ${msg.errors[name]}` };
      log(JSON.stringify({ level: "error", event: "alert_undeliverable", target: name, reason: msg.errors[name], kind: msg.kind, check: msg.check, text: msg.text }));
      persist();
    }
  }

  async function cycle() {
    const t = now();
    const results = {};
    // Each check is isolated: an unexpected error is that check's failure, never the end of the cycle.
    const guard = async (fn, name) => { try { return await fn(); } catch (e) { return { [name]: { ok: false, severity: "critical", detail: `σφάλμα ελέγχου: ${String(e?.message ?? e).slice(0, 120)}` } }; } };
    if (cfg.pmsHealthUrl) Object.assign(results, await guard(async () => ({ pms: await health(cfg.pmsHealthUrl) }), "pms"));
    if (cfg.bookingHealthUrl) Object.assign(results, await guard(async () => ({ booking: await health(cfg.bookingHealthUrl) }), "booking"));
    if (cfg.heartbeatUrl) Object.assign(results, await guard(() => heartbeat(t), "heartbeat"));
    // v204: a queue that grows (no channel accepts the alerts) is reported before it reaches the merge limit.
    const sizeOf = (m) => (m.kind === "batch" || m.kind === "digest" ? (m.items ?? []).reduce((k, x) => k + (Number(x?.count) || 1), 0) : 1);
    const queuedItems = Math.max(0, ...targetNames().map((n) => state.outbox.filter((m) => !doneFor(m, n)).reduce((k, m) => k + sizeOf(m), 0)), targetNames().length ? 0 : state.outbox.length);
    if (queuedItems >= QUEUE_WARN) results.alert_queue = { ok: false, severity: "warning", detail: `${queuedItems} ειδοποιήσεις δεν έχουν παραδοθεί σε όλα τα κανάλια (στο πιο καθυστερημένο κανάλι) — ελέγξτε ntfy / Telegram / webhook` };
    else if (state.outbox.length || state.checks.alert_queue) results.alert_queue = { ok: true };
    if (state.undeliverable && now() - state.undeliverable.at < 24 * 60 * MIN) results.alert_undeliverable = { ok: false, severity: "warning", detail: `${state.undeliverable.count} ειδοποίηση(εις) απορρίφθηκαν από κανάλι (${state.undeliverable.last}) — πλήρες κείμενο στο log (fly logs)` };
    else if (state.checks.alert_undeliverable) results.alert_undeliverable = { ok: true };
    if (cfg.stateFile) results.state_storage = storageError ? { ok: false, severity: "warning", detail: `η κατάσταση του watchdog δεν αποθηκεύεται (${storageError}) — μετά από επανεκκίνηση χάνεται` } : { ok: true };
    const fresh = [];
    for (const [name, r] of Object.entries(results)) {
      const c = (state.checks[name] ??= { fails: 0, oks: 0, open: false, openedAt: null, lastAlertAt: null });
      if (r.ok) {
        c.fails = 0; c.oks++;
        if (c.open && c.oks >= 2) { c.open = false; fresh.push({ kind: "resolved", check: name, at: t, text: `✅ ${cfg.label}: «${name}» αποκαταστάθηκε (διάρκεια ${Math.round((t - c.openedAt) / MIN)}′)` }); }
      } else {
        // Severity decides how soon and how often: critical after FAIL_THRESHOLD checks, reminded every REMIND_MIN;
        // a warning after 3 × FAIL_THRESHOLD checks, reminded every 6 × REMIND_MIN. A warning that becomes critical is
        // escalated at once.
        const sev = r.severity === "warning" ? "warning" : "critical";
        const icon = sev === "warning" ? "🟠" : "🔴";
        c.oks = 0; c.fails++; c.detail = r.detail;
        const threshold = sev === "warning" ? cfg.failThreshold * 3 : cfg.failThreshold, remind = (sev === "warning" ? 6 : 1) * cfg.remindMin * MIN;
        if (!c.open && c.fails >= threshold) { c.open = true; c.severity = sev; c.openedAt = t; c.lastAlertAt = t; fresh.push({ kind: "open", severity: sev, check: name, at: t, text: `${icon} ${cfg.label}: «${name}» — ${r.detail} (${c.fails} συνεχόμενοι έλεγχοι)` }); }
        else if (c.open && c.severity === "warning" && sev === "critical" && c.fails >= cfg.failThreshold) { c.severity = "critical"; c.lastAlertAt = t; fresh.push({ kind: "escalated", severity: sev, check: name, at: t, text: `🔴 ${cfg.label}: «${name}» έγινε κρίσιμο — ${r.detail}` }); }
        else if (c.open && t - c.lastAlertAt >= remind) { c.lastAlertAt = t; fresh.push({ kind: "reminder", severity: c.severity, check: name, at: t, text: `${c.severity === "warning" ? "🟠" : "🔴"} ${cfg.label}: «${name}» εξακολουθεί — ${r.detail} (από ${Math.round((t - c.openedAt) / MIN)}′)` }); }
      }
    }
    // Every alert is written to the log when it is decided, with its COMPLETE text (fly logs) — then every text is
    // kept within TEXT_MAX bytes for the channels (a detail from the PMS can be long; a too-long message is refused).
    for (const m of fresh) log(JSON.stringify({ event: "alert", at: new Date(m.at).toISOString(), kind: m.kind, severity: m.severity ?? null, check: m.check, text: m.text }));
    for (const m of fresh) m.text = clipText(m.text);
    // v204 aggregation: many alerts in one cycle (e.g. a provider outage that fails 20 subsystems) → ONE message that
    // lists them all (each kept in items), not 20 messages.
    if (fresh.length > BATCH_MAX) {
      const crit = fresh.some((m) => m.severity === "critical");
      state.outbox.push({ kind: "batch", severity: crit ? "critical" : "warning", check: "*", at: t, items: fresh.map(({ kind, severity, check, at, text }) => ({ kind, severity, check, at, text })),
        text: listText(`${crit ? "🔴" : "🟠"} ${cfg.label}: ${fresh.length} ειδοποιήσεις ταυτόχρονα`, fresh.slice().sort((a, b) => priorityOf(a) - priorityOf(b)).map((m) => m.text)) });
    } else state.outbox.push(...fresh);
    // Saved BEFORE delivering: an alert decided in this cycle survives a restart even if delivery never happened.
    persist();
    // v204: delivery has a time budget per cycle (a slow channel cannot stretch one cycle to an hour); what is left
    // waits for the next cycle, in order.
    // Time budget from the cycle's start, but always at least 10 s for delivery (even when every check timed out).
    const deadline = Math.max(t + cfg.intervalS * 1000 * 0.8, now() + 10_000);
    const targets = targetNames();
    for (const name of targets) await deliverChannel(name, deadline);
    // Nothing is dropped: a message leaves the queue only when every channel is done with it; above QUEUE_MAX
    // waiting for one channel, that channel's backlog is merged (in order) into one digest.
    if (targets.length) state.outbox = compactOutbox(state.outbox, cfg.label, targets);
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
