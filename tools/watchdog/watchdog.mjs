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
/**
 * Bounded WITHOUT loss: at most QUEUE_MAX messages. Above it, the lowest-priority, oldest messages are merged into
 * digests — ONE per set of channels that already accepted them (v204: a channel that accepted the merged messages
 * is never sent them again; digests of the same set are merged together). Critical «open» / «escalated» messages are
 * the last to be merged.
 */
export function compactOutbox(outbox, label = "") {
  // Signature = channels that accepted + channels that gave up (both are «done» for that channel).
  const sig = (m) => `${[...(m.delivered ?? [])].sort().join(",")}|${Object.keys(m.gaveUp ?? {}).sort().join(",")}`;
  const digests = outbox.filter((m) => m.kind === "digest"), rest = outbox.filter((m) => m.kind !== "digest");
  const sigs = new Set(digests.map(sig));
  if (rest.length + digests.length <= QUEUE_MAX && sigs.size === digests.length) return outbox;
  const room = Math.max(1, QUEUE_MAX - Math.max(1, new Set([...digests, ...rest].map(sig)).size));
  const order = rest.map((m, i) => ({ m, i })).sort((a, b) => priorityOf(a.m) - priorityOf(b.m) || a.i - b.i);
  const keep = new Set(rest.length + digests.length <= QUEUE_MAX ? rest.map((_, i) => i) : order.slice(0, room).map((x) => x.i));
  const merged = [...digests, ...rest.filter((_, i) => !keep.has(i))];
  const groups = new Map();
  for (const m of merged) { const k = sig(m); (groups.get(k) ?? groups.set(k, []).get(k)).push(m); }
  const out = rest.filter((_, i) => keep.has(i));
  for (const [k, ms] of groups) {
    const items = collapseItems(ms.flatMap(itemsOf));
    if (!items.length) continue;
    const total = items.reduce((n, x) => n + (Number(x.count) || 1), 0);
    const [dk, gk] = k.split("|");
    const gaveUp = Object.fromEntries((gk ? gk.split(",") : []).map((c) => [c, "εγκαταλείφθηκε για το κανάλι πριν τη συγχώνευση"]));
    out.push({ kind: "digest", severity: items.some((x) => x.severity === "critical") ? "critical" : "warning", check: "*", at: Math.max(...items.map((x) => Number(x.at) || 0)), items, delivered: dk ? dk.split(",") : [], gaveUp, errors: {},
      text: listText(`📋 ${label}: ${total} ειδοποιήσεις συγκεντρώθηκαν (η ουρά ξεπέρασε τις ${QUEUE_MAX})`, items.slice().sort((a, b) => priorityOf(a) - priorityOf(b) || (Number(b.at) || 0) - (Number(a.at) || 0)).map((x) => `${x.text}${Number(x.count) > 1 ? ` (×${x.count})` : ""}`)) });
  }
  return out;
}

export function createWatchdog(cfg, { fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (l) => console.log(l) } = {}) {
  let state = { checks: {}, outbox: [], progress: {} };
  if (cfg.stateFile) { try { state = { ...state, ...JSON.parse(readFileSync(cfg.stateFile, "utf8")) }; } catch { /* first start */ } }
  // A damaged state file must not stop the watchdog: anything but the expected shapes is reset (and reported in the log).
  if (!Array.isArray(state.outbox)) { log(JSON.stringify({ level: "error", event: "state_outbox_invalid" })); state.outbox = []; }
  if (!state.checks || typeof state.checks !== "object") state.checks = {};
  if (!state.progress || typeof state.progress !== "object") state.progress = {};
  state.outbox = state.outbox.filter((m) => m && typeof m === "object" && typeof m.text === "string");
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

  /**
   * Delivers one message to every target that has not accepted it yet. v204: `down` = targets that already failed in
   * THIS cycle — skipped for the remaining messages (a channel that times out cannot block the cycle for an hour);
   * they are retried in the next cycle. Critical alerts go to ntfy with high priority whatever their kind.
   */
  async function deliver(msg, down = new Set(), deadline = Infinity) {
    const urgent = msg.severity === "critical" && ["open", "escalated", "batch", "digest"].includes(msg.kind);
    const targets = [];
    if (cfg.telegram) targets.push(["telegram", () => fetchImpl(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: cfg.telegram.chat, text: msg.text }), signal: AbortSignal.timeout(cfg.timeoutMs) })]);
    if (cfg.ntfyUrl) targets.push(["ntfy", () => fetchImpl(cfg.ntfyUrl, { method: "POST", headers: { Title: `${cfg.label} watchdog`, Priority: urgent ? "high" : "default" }, body: msg.text, signal: AbortSignal.timeout(cfg.timeoutMs) })]);
    if (cfg.webhookUrl) targets.push(["webhook", () => fetchImpl(cfg.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg), signal: AbortSignal.timeout(cfg.timeoutMs) })]);
    msg.delivered ??= [];
    msg.errors ??= {};
    msg.refused ??= {};
    msg.gaveUp ??= {};
    for (const [name, send] of targets) {
      if (msg.delivered.includes(name) || msg.gaveUp[name] || down.has(name)) continue;
      if (now() > deadline) continue; // out of time for this cycle: retried next cycle
      let refusedNow = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let verdict;
        try { verdict = await accepted(name, await send()); } catch (e) { verdict = { reason: `σύνδεση: ${String(e?.message ?? e).slice(0, 120)}`, messageSpecific: false }; }
        if (verdict === true) {
          msg.delivered.push(name); delete msg.errors[name];
          persist(); // v204: saved at once — a restart now cannot send it to this channel again
          break;
        }
        msg.errors[name] = verdict.reason;
        if (verdict.messageSpecific) { refusedNow = true; break; } // the same message would be refused again
        if (attempt < 2 && now() <= deadline) await sleep(200 * 2 ** attempt); else break;
      }
      if (msg.delivered.includes(name)) continue;
      if (refusedNow) {
        // The channel works but refuses this message: other messages still go through it. After 3 cycles of refusal
        // the message is given up FOR THIS CHANNEL — logged in full and reported (alert_undeliverable), never silent.
        msg.refused[name] = (msg.refused[name] ?? 0) + 1;
        if (msg.refused[name] >= 3) {
          msg.gaveUp[name] = msg.errors[name];
          state.undeliverable = { count: (state.undeliverable?.count ?? 0) + 1, at: now(), last: `${name}: ${msg.errors[name]}` };
          log(JSON.stringify({ level: "error", event: "alert_undeliverable", target: name, reason: msg.errors[name], kind: msg.kind, check: msg.check, text: msg.text }));
        }
      } else down.add(name);
    }
    return targets.length > 0 && targets.every(([name]) => msg.delivered.includes(name) || msg.gaveUp[name]);
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
    const queuedItems = state.outbox.reduce((n, m) => n + (m.kind === "batch" || m.kind === "digest" ? (m.items ?? []).reduce((k, x) => k + (Number(x.count) || 1), 0) : 1), 0);
    if (queuedItems >= QUEUE_WARN) results.alert_queue = { ok: false, severity: "warning", detail: `${queuedItems} ειδοποιήσεις δεν έχουν παραδοθεί σε όλα τα κανάλια (${state.outbox.length} μηνύματα) — ελέγξτε ntfy / Telegram / webhook` };
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
    const pending = [], down = new Set(), deadline = t + Math.max(10_000, cfg.intervalS * 1000 * 0.8); // from the cycle's start
    // Most important CHECKS first, but the messages of one check always in their own order (an «open» is never
    // overtaken by its «resolved», a «warning» by its «escalated»): each check's group is ranked by its most urgent
    // message and its first position; batches / digests are groups of their own.
    const groupOf = (m, i) => (m.check && m.check !== "*" ? m.check : `#${i}`);
    const rank = new Map(), first = new Map();
    state.outbox.forEach((m, i) => { const g = groupOf(m, i); rank.set(g, Math.min(rank.get(g) ?? 9, priorityOf(m))); if (!first.has(g)) first.set(g, i); });
    const ordered = state.outbox.map((m, i) => ({ m, i, g: groupOf(m, i) })).sort((a, b) => rank.get(a.g) - rank.get(b.g) || first.get(a.g) - first.get(b.g) || a.i - b.i).map((x) => x.m);
    for (const msg of ordered) {
      if (now() > deadline) { pending.push(msg); continue; }
      if (!(await deliver(msg, down, deadline))) pending.push(msg);
    }
    // v204: nothing is dropped. Above QUEUE_MAX the least important messages are MERGED into one digest (their items
    // kept); critical «open» / «escalated» messages are kept individually first.
    state.outbox = compactOutbox(pending, cfg.label);
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
