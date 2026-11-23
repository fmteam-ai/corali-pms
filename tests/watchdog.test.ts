import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createWatchdog } from "../tools/watchdog/watchdog.mjs";
import { signHeartbeat } from "../scripts/health-core.mjs";

const SECRET = "m".repeat(40), MIN = 60_000;
type Mode = { health: "ok" | "500" | "down"; db: "ok" | "fail"; sentinel: "ok" | "fail"; sentinelRuns: number; autoRuns: number; sign: "ok" | "bad" | "old" };

/** A fake PMS (health + signed heartbeat) and a fake alert receiver (webhook) on local ports. */
async function rig() {
  const mode: Mode = { health: "ok", db: "ok", sentinel: "ok", sentinelRuns: 1, autoRuns: 1, sign: "ok" };
  let clock = Date.parse("2026-11-23T10:00:00Z");
  const alerts: { kind: string; check: string; text: string }[] = [];
  let receiverFailures = 0;
  const pms: Server = createServer((req, res) => {
    if (mode.health === "down") { req.socket.destroy(); return; }
    if (req.url === "/api/health") { res.writeHead(mode.health === "ok" ? 200 : 503, { "Content-Type": "application/json" }); res.end(JSON.stringify(mode.health === "ok" ? { ok: true } : { ok: false, reason: "database_unavailable" })); return; }
    const body = JSON.stringify({ service: "corali-pms", version: "v201", at: clock, status: "ok", components: { database: mode.db, sentinel: mode.sentinel, automations: "ok" }, progress: { sentinelRuns: mode.sentinelRuns, automationsRuns: mode.autoRuns, sentinelLastRunAgoS: 60 } });
    const t = mode.sign === "old" ? clock - 10 * MIN : clock;
    const sig = mode.sign === "bad" ? "0".repeat(64) : signHeartbeat(SECRET, t, body);
    res.writeHead(200, { "Content-Type": "application/json", "X-Corali-Signature": `t=${t},v1=${sig}` }); res.end(body);
  });
  const receiver: Server = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      if (receiverFailures > 0) { receiverFailures--; res.writeHead(500); res.end(); return; }
      alerts.push(JSON.parse(b)); res.writeHead(200); res.end();
    });
  });
  await Promise.all([new Promise<void>((r) => pms.listen(0, "127.0.0.1", r)), new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r))]);
  const port = (s: Server) => (s.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port(pms)}`;
  const wd = createWatchdog({ pmsHealthUrl: `${base}/api/health`, bookingHealthUrl: "", heartbeatUrl: `${base}/api/monitoring/heartbeat`, secret: SECRET, intervalS: 60, failThreshold: 3, remindMin: 60, heartbeatMaxAgeS: 300, progressStaleS: 1200, timeoutMs: 2000, telegram: null, ntfyUrl: "", webhookUrl: `http://127.0.0.1:${port(receiver)}/alert`, deadmanUrl: "", stateFile: "", label: "QA" }, { now: () => clock, sleep: async () => {}, log: () => {} });
  const tick = async (n = 1, stepMs = MIN) => { for (let i = 0; i < n; i++) { clock += stepMs; await wd.cycle(); } };
  return { mode, alerts, tick, wd, failReceiver: (n: number) => { receiverFailures = n; }, close: () => { pms.close(); receiver.close(); } };
}

test("v201 watchdog: PMS outage → one alert after 3 failed checks, reminder, one recovery alert", async () => {
  const r = await rig();
  try {
    await r.tick(2);
    assert.equal(r.alerts.length, 0, "healthy: silence");
    r.mode.health = "down";
    await r.tick(2);
    assert.equal(r.alerts.length, 0, "below the threshold: no alert yet");
    await r.tick(1);
    const opened = r.alerts.filter((a) => a.kind === "open").map((a) => a.check);
    assert.ok(opened.includes("pms") && opened.includes("heartbeat"), `outage reported: ${opened}`);
    const n = r.alerts.length;
    await r.tick(3);
    assert.equal(r.alerts.length, n, "no repeated alerts every minute");
    await r.tick(1, 61 * MIN);
    assert.ok(r.alerts.some((a) => a.kind === "reminder"), "reminded after REMIND_MIN");
    r.mode.health = "ok";
    await r.tick(1);
    assert.ok(!r.alerts.some((a) => a.kind === "resolved"), "one good check is not yet a recovery");
    await r.tick(1);
    assert.ok(r.alerts.some((a) => a.kind === "resolved" && a.check === "pms"), "recovery alert");
  } finally { r.close(); }
});

test("v201 watchdog: database failure, stalled Sentinel, stale / invalid heartbeat, and alert delivery retries", async () => {
  const r = await rig();
  try {
    // The PMS answers, but its database is down (seen through the signed heartbeat).
    r.mode.db = "fail";
    await r.tick(3);
    assert.ok(r.alerts.some((a) => a.kind === "open" && a.check === "database"));
    r.mode.db = "ok"; await r.tick(2);
    // The Sentinel reports ok but its run counter stopped growing → stalled (20′ window).
    await r.tick(25);
    assert.ok(r.alerts.some((a) => a.kind === "open" && a.check === "sentinel_progress"), "a stalled Sentinel is detected");
    r.mode.sentinelRuns = 5; r.mode.autoRuns = 5; await r.tick(2);
    assert.ok(r.alerts.some((a) => a.kind === "resolved" && a.check === "sentinel_progress"));
    // A replayed (old) or forged heartbeat is not trusted.
    r.mode.sign = "old"; r.mode.sentinelRuns = 6; r.mode.autoRuns = 6; await r.tick(3);
    assert.ok(r.alerts.some((a) => a.kind === "open" && a.check === "heartbeat" && /stale/.test(a.text)));
    r.mode.sign = "bad"; await r.tick(1);
    assert.match(String((r.wd.state().checks as Record<string, { detail: string }>).heartbeat.detail), /invalid/);
    r.mode.sign = "ok"; r.mode.sentinelRuns = 8; r.mode.autoRuns = 8; await r.tick(2);
    // Alert delivery: the receiver fails 4 times (more than one cycle's 3 retries) → delivered on the next cycle.
    r.failReceiver(4);
    r.mode.sentinel = "fail";
    const before = r.alerts.length;
    await r.tick(3);
    assert.equal(r.alerts.length, before, "not delivered yet: the receiver is failing");
    assert.ok(r.wd.state().outbox.length > 0, "kept for the next cycle, not lost");
    r.mode.sentinelRuns = 9; r.mode.autoRuns = 9; await r.tick(1);
    assert.ok(r.alerts.some((a) => a.kind === "open" && a.check === "sentinel"), "delivered once the receiver works");
    assert.equal(r.wd.state().outbox.length, 0);
  } finally { r.close(); }
});

// v202: a fake PMS through fetchImpl — exact control of the signed heartbeat body.
function fakeFetch(state: { body: string | (() => string); now: () => number; alerts: { kind: string; check: string; severity?: string; text: string }[]; receiverDown?: boolean }) {
  return (async (url: string, init?: { body?: string }) => {
    if (url.includes("/alert")) { if (state.receiverDown) return new Response("down", { status: 500 }); state.alerts.push(JSON.parse(String(init?.body))); return new Response("ok"); }
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const body = typeof state.body === "function" ? state.body() : state.body, t = state.now();
    return new Response(body, { status: 200, headers: { "X-Corali-Signature": `t=${t},v1=${signHeartbeat(SECRET, t, body)}` } });
  }) as unknown as typeof fetch;
}
const cfgFor = (extra: Record<string, unknown> = {}) => ({ pmsHealthUrl: "http://pms/api/health", bookingHealthUrl: "", heartbeatUrl: "http://pms/api/monitoring/heartbeat", secret: SECRET, intervalS: 60, failThreshold: 3, remindMin: 60, heartbeatMaxAgeS: 300, progressStaleS: 1200, timeoutMs: 2000, telegram: null, ntfyUrl: "", webhookUrl: "http://hook/alert", deadmanUrl: "", stateFile: "", label: "QA", ...extra });
const hbBody = (components: Record<string, unknown>, runs = { s: 1, a: 1 }) => JSON.stringify({ service: "corali-pms", version: "v202", at: 1, status: "ok", components, progress: { sentinelRuns: runs.s, automationsRuns: runs.a, sentinelLastRunAgoS: 60 } });

test("v202 P1 watchdog: only an exact «ok» is health — unknown / warn / missing are failures, by severity", async () => {
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const st = { body: hbBody({ database: "unknown", sentinel: "warn", automations: "unknown" }), now: () => clock, alerts: [] as { kind: string; check: string; severity?: string; text: string }[] };
  const wd = createWatchdog(cfgFor(), { fetchImpl: fakeFetch(st), now: () => clock, sleep: async () => {}, log: () => {} });
  // The reported case: a valid signed heartbeat that knows nothing is NOT healthy.
  const r = (await wd.cycle()).results;
  assert.equal(r.heartbeat.ok, true, "the heartbeat itself is valid");
  assert.deepEqual([r.database.ok, r.cron.ok, r.sentinel.ok], [false, false, false]);
  assert.deepEqual([r.database.severity, r.cron.severity, r.sentinel.severity], ["critical", "critical", "warning"]);
  for (let i = 0; i < 2; i++) { clock += 60_000; await wd.cycle(); }
  assert.deepEqual(st.alerts.filter((a) => a.kind === "open").map((a) => [a.check, a.severity]).sort(), [["cron", "critical"], ["database", "critical"]], "critical after 3 checks; the warning later");
  for (let i = 0; i < 6; i++) { clock += 60_000; await wd.cycle(); }
  assert.ok(st.alerts.some((a) => a.kind === "open" && a.check === "sentinel" && a.severity === "warning" && a.text.startsWith("🟠")), "warning after 9 checks");
  // A warning that turns critical is escalated at once.
  st.body = hbBody({ database: "unknown", sentinel: "fail", automations: "unknown" });
  for (let i = 0; i < 3; i++) { clock += 60_000; await wd.cycle(); }
  assert.ok(st.alerts.some((a) => a.kind === "escalated" && a.check === "sentinel"));
  // A component missing altogether = invalid heartbeat; any other component is watched too.
  st.body = hbBody({ database: "ok", automations: "ok" });
  assert.match((await wd.cycle()).results.heartbeat.detail!, /HEARTBEAT_INVALID: λείπει το component sentinel/);
  st.body = hbBody({ database: "ok", automations: "ok", sentinel: "ok", otaQueue: "fail" }, { s: 2, a: 2 });
  assert.equal((await wd.cycle()).results["component:otaQueue"].severity, "critical");
});

test("v202 P2 watchdog: a signed but malformed heartbeat is HEARTBEAT_INVALID (counted), never an exception that skips the cycle", async () => {
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const st = { body: "{not json", now: () => clock, alerts: [] as { kind: string; check: string; text: string }[] };
  const wd = createWatchdog(cfgFor(), { fetchImpl: fakeFetch(st), now: () => clock, sleep: async () => {}, log: () => {} });
  for (const body of ["{not json", "[]", "null", JSON.stringify({ service: "x", at: 1, components: { database: "ok", automations: "ok", sentinel: "ok" } })]) {
    st.body = body;
    const r = await wd.cycle();
    assert.equal(r.results.pms.ok, true, "the other checks still ran");
    assert.match(r.results.heartbeat.detail!, /^HEARTBEAT_INVALID/, body);
    clock += 60_000;
  }
  assert.ok(st.alerts.some((a) => a.kind === "open" && a.check === "heartbeat"), "the failures were counted → alert after 3");
});

test("v202 P2 watchdog: state survives a restart — open incidents are not re-alerted, undelivered alerts are delivered after the restart", async () => {
  const { mkdtempSync, readFileSync: rf } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const stateFile = join(mkdtempSync(join(tmpdir(), "wd-")), "state.json");
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const st = { body: hbBody({ database: "fail", sentinel: "ok", automations: "ok" }), now: () => clock, alerts: [] as { kind: string; check: string; text: string }[], receiverDown: true };
  const deps = { fetchImpl: fakeFetch(st), now: () => clock, sleep: async () => {}, log: () => {} };
  const a = createWatchdog(cfgFor({ stateFile }), deps);
  for (let i = 0; i < 3; i++) { await a.cycle(); clock += 60_000; }
  assert.equal(st.alerts.length, 0, "the receiver is down: nothing delivered yet");
  assert.ok(JSON.parse(rf(stateFile, "utf8")).outbox.length > 0, "the undelivered alert is on disk");
  // The machine restarts (a new process reading the same volume); the receiver works again.
  st.receiverDown = false;
  const b = createWatchdog(cfgFor({ stateFile }), deps);
  await b.cycle();
  assert.equal(st.alerts.filter((x) => x.kind === "open" && x.check === "database").length, 1, "delivered after the restart, exactly once");
  clock += 60_000; await b.cycle();
  assert.equal(st.alerts.filter((x) => x.check === "database").length, 1, "the open incident is remembered: no new «open» alert");
  // A state file that cannot be written is itself reported.
  const c = createWatchdog(cfgFor({ stateFile: "/proc/no-such-dir/state.json" }), deps);
  await c.cycle();
  assert.equal((await c.cycle()).results.state_storage.ok, false);
});

test("v203 P2 watchdog: a provider that answers HTTP 200 but does not accept the message keeps it queued (Telegram ok:false, ntfy without id)", async () => {
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const st = { body: hbBody({ database: "fail", sentinel: "ok", automations: "ok" }), now: () => clock, alerts: [] };
  const answers: Record<string, () => Response> = {
    telegram: () => new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 200 }),
    ntfy: () => new Response("", { status: 200 }),
  };
  const calls: string[] = [];
  const base = fakeFetch(st);
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.includes("api.telegram.org")) { calls.push("telegram"); return answers.telegram(); }
    if (url.includes("ntfy.example")) { calls.push("ntfy"); return answers.ntfy(); }
    return base(url, init as RequestInit);
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ webhookUrl: "", telegram: { token: "T", chat: "C" }, ntfyUrl: "https://ntfy.example/topic" }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 3; i++) { await wd.cycle(); clock += 60_000; }
  let box = wd.state().outbox;
  assert.equal(box.length, 1, "the «open» alert is NOT removed: neither provider accepted it");
  assert.deepEqual(box[0].delivered, []);
  assert.match(box[0].errors?.telegram ?? "", /chat not found/);
  assert.match(box[0].errors?.ntfy ?? "", /χωρίς id/);
  // Telegram accepts, ntfy still not → only ntfy is retried; then ntfy accepts → delivered, out of the queue.
  answers.telegram = () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
  await wd.cycle(); clock += 60_000;
  box = wd.state().outbox;
  assert.deepEqual(box[0].delivered, ["telegram"]);
  const telegramCalls = calls.filter((c) => c === "telegram").length;
  answers.ntfy = () => new Response(JSON.stringify({ id: "abc123", event: "message" }), { status: 200 });
  await wd.cycle();
  assert.equal(wd.state().outbox.length, 0, "delivered once both accepted");
  assert.equal(calls.filter((c) => c === "telegram").length, telegramCalls, "Telegram not sent a second time");
});

test("v204 P1 watchdog: 65 failing subsystems with no working channel — nothing is dropped (one aggregated alert; merge, never truncate)", async () => {
  const { compactOutbox, QUEUE_MAX, QUEUE_WARN } = await import("../tools/watchdog/watchdog.mjs");
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const comps: Record<string, string> = { database: "ok", sentinel: "ok", automations: "ok" };
  for (let i = 1; i <= 65; i++) comps[`sub${i}`] = "fail";
  const st = { body: hbBody(comps), now: () => clock, alerts: [] as { kind: string; check: string; text: string }[], receiverDown: true };
  const wd = createWatchdog(cfgFor(), { fetchImpl: fakeFetch(st), now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 3; i++) { await wd.cycle(); clock += 60_000; }
  let box = wd.state().outbox;
  const all = box.flatMap((m) => (m.items ? m.items : [m]));
  assert.equal(new Set(all.filter((m) => m.kind === "open").map((m) => m.check)).size, 65, "all 65 incidents are in the queue");
  assert.equal(box.length, 1, "aggregated into one message");
  // The channel comes back: one message delivered, carrying all 65.
  st.receiverDown = false;
  await wd.cycle();
  assert.equal(st.alerts.length, 1);
  assert.equal((st.alerts[0] as unknown as { items: unknown[] }).items.length, 65);
  const { TEXT_MAX } = await import("../tools/watchdog/watchdog.mjs");
  assert.ok(Buffer.byteLength(st.alerts[0].text) <= TEXT_MAX, `the text fits Telegram / ntfy in BYTES (${Buffer.byteLength(st.alerts[0].text)})`);
  assert.match(st.alerts[0].text, /… και \d+ ακόμη/, "what does not fit is counted, and kept in items");
  // The queue itself above its limit: merged into a digest, every item kept.
  const many = Array.from({ length: 150 }, (_, i) => ({ kind: i % 3 ? "reminder" : "open", severity: i % 2 ? "critical" : "warning", check: `c${i}`, at: i, text: `m${i}` }));
  const c = compactOutbox(many, "QA", ["webhook"]);
  assert.ok(c.length <= QUEUE_MAX);
  const kept = c.flatMap((m) => (m.kind === "digest" ? m.items ?? [] : [m]));
  assert.equal(kept.length, 150, "no message lost");
  assert.ok(c.filter((m) => m.kind !== "digest").every((m) => !(m.kind === "reminder" && c.some((x) => x.kind === "digest" && x.items?.some((y) => y.kind === "open" && y.severity === "critical")))), "critical «open» kept individually before reminders");
  // Earlier digests are merged into one (never a pile of digests), still keeping every item.
  const again = compactOutbox([...c, ...Array.from({ length: 30 }, (_, i) => ({ kind: "reminder", severity: "warning", check: `n${i}`, at: 200 + i, text: `n${i}` }))], "QA", ["webhook"]);
  assert.equal(again.filter((m) => m.kind === "digest").length, 1);
  assert.equal(again.flatMap((m) => (m.kind === "digest" ? m.items ?? [] : [m])).length, 180);
  assert.ok(again.every((m) => Buffer.byteLength(m.text) <= TEXT_MAX));
  // A growing queue is reported before the merge limit.
  st.receiverDown = true;
  for (let i = 1; i <= QUEUE_WARN; i++) comps[`late${i}`] = "warn";
  const wd2 = createWatchdog(cfgFor(), { fetchImpl: fakeFetch({ ...st, body: hbBody(comps) }), now: () => clock, sleep: async () => {}, log: () => {} });
  (wd2.state() as { outbox: unknown[] }).outbox.push(...Array.from({ length: QUEUE_WARN }, (_, i) => ({ kind: "reminder", severity: "warning", check: `q${i}`, at: i, text: "q" })));
  const r = await wd2.cycle();
  assert.equal(r.results.alert_queue.ok, false);
  assert.match(r.results.alert_queue.detail!, /δεν έχουν παραδοθεί/);
  box = wd2.state().outbox;
  assert.ok(box.length <= QUEUE_MAX);
});

test("v204 review: no duplicate digests to a channel that already accepted, ntfy byte limit, high priority, slow channel bounded, bounded state", async () => {
  const { compactOutbox, listText, QUEUE_MAX, TEXT_MAX, ITEMS_MAX } = await import("../tools/watchdog/watchdog.mjs");
  // Greek + emoji lines: the limit is in bytes (ntfy), not characters.
  const greek = Array.from({ length: 80 }, (_, i) => `🔴 Ξενοδοχείο: «υποσύστημα_${i}» — η υπηρεσία δεν απαντά εδώ και πολλή ώρα`);
  const t = listText("🔴 Πολλές ειδοποιήσεις", greek);
  assert.ok(Buffer.byteLength(t) <= TEXT_MAX, `${Buffer.byteLength(t)} bytes`);
  const { clipText } = await import("../tools/watchdog/watchdog.mjs");
  for (const long of ["Χ".repeat(5000), "🔴".repeat(3000), "a".repeat(9000)]) assert.ok(Buffer.byteLength(clipText(long)) <= TEXT_MAX, "clipText within the byte limit");
  assert.match(t, /… και \d+ ακόμη — όλες στο log του watchdog/);
  // Telegram accepts, ntfy always fails: 120 messages already on Telegram are merged into a digest that Telegram
  // never receives again; only ntfy is retried.
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const calls: { target: string; text: string; priority?: string }[] = [];
  const st = { body: hbBody({ database: "ok", sentinel: "ok", automations: "ok" }), now: () => clock, alerts: [] };
  const base = fakeFetch(st);
  const fetchImpl = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    if (url.includes("api.telegram.org")) { calls.push({ target: "telegram", text: JSON.parse(String(init?.body)).text }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (url.includes("ntfy.example")) { calls.push({ target: "ntfy", text: String(init?.body), priority: init?.headers?.Priority }); return new Response("down", { status: 500 }); }
    return base(url, init as RequestInit);
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ webhookUrl: "", telegram: { token: "T", chat: "C" }, ntfyUrl: "https://ntfy.example/t" }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  const box = wd.state().outbox as { kind: string; severity?: string; check: string; at?: number; text: string; delivered?: string[] }[];
  for (let i = 0; i < 120; i++) box.push({ kind: "open", severity: "critical", check: `x${i}`, at: i, text: `x${i}`, delivered: ["telegram"] });
  for (let i = 0; i < 5; i++) { await wd.cycle(); clock += 60_000; }
  assert.equal(calls.filter((c) => c.target === "telegram").length, 0, "Telegram is never sent what it already accepted");
  const after = wd.state().outbox;
  assert.ok(after.length <= QUEUE_MAX);
  assert.equal(after.flatMap((m) => (m.kind === "digest" ? m.items ?? [] : [m])).length, 120, "nothing lost");
  assert.ok(after.filter((m) => m.kind === "digest").every((m) => m.delivered?.includes("telegram")));
  // A slow / failing channel is tried once per cycle (3 attempts), not once per queued message.
  calls.length = 0; await wd.cycle();
  assert.equal(calls.filter((c) => c.target === "ntfy").length, 3, "one message × 3 attempts, then skipped for this cycle");
  // Critical aggregated messages go to ntfy with high priority.
  assert.ok(calls.filter((c) => c.target === "ntfy").every((c) => c.priority === "high"));
  // State stays bounded without loss: more than ITEMS_MAX items are counted per check.
  const huge = Array.from({ length: QUEUE_MAX + ITEMS_MAX + 500 }, (_, i) => ({ kind: "reminder", severity: "warning", check: `c${i % 20}`, at: i, text: `r${i}` }));
  const compacted = compactOutbox(huge, "QA", ["webhook"]);
  const items = compacted.flatMap((m) => (m.kind === "digest" ? m.items ?? [] : [m]));
  assert.ok(items.length <= QUEUE_MAX + ITEMS_MAX);
  assert.equal(items.reduce((n, x) => n + (Number((x as { count?: number }).count) || 1), 0), huge.length, "every reminder still counted");
});

test("v204 review 2 watchdog: a long detail is clipped; a message refused by a channel does not block the others and is reported; delivery saved at once; time budget", async () => {
  const { mkdtempSync, readFileSync: rf } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { TEXT_MAX } = await import("../tools/watchdog/watchdog.mjs");
  const stateFile = join(mkdtempSync(join(tmpdir(), "wd2-")), "state.json");
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const sentTelegram: string[] = [];
  let savedBeforeNtfy: boolean | null = null;
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: false, reason: "Χ".repeat(5000) }), { status: 503 });
    if (url.includes("booking")) return new Response(JSON.stringify({ ok: false, reason: "down" }), { status: 503 });
    if (url.includes("api.telegram.org")) {
      const text = JSON.parse(String(init?.body)).text as string;
      if (text.length > 4096) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message is too long" }), { status: 400 });
      if (text.includes("FORBIDDEN-WORD")) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse" }), { status: 400 });
      sentTelegram.push(text); return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("ntfy.example")) {
      try { savedBeforeNtfy = JSON.parse(rf(stateFile, "utf8")).outbox.some((m: { delivered?: string[] }) => m.delivered?.includes("telegram")); } catch { savedBeforeNtfy = false; }
      return new Response(JSON.stringify({ id: "n1" }), { status: 200 });
    }
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
  const cfg = cfgFor({ pmsHealthUrl: "http://pms/api/health", bookingHealthUrl: "http://booking/api/health", heartbeatUrl: "", webhookUrl: "", telegram: { token: "T", chat: "C" }, ntfyUrl: "https://ntfy.example/t", stateFile });
  const wd = createWatchdog(cfg, { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 3; i++) { await wd.cycle(); clock += 60_000; }
  // (6) the 5000-character detail was clipped: delivered to Telegram, and the booking alert too.
  assert.ok(sentTelegram.some((t) => t.includes("«pms»") && Buffer.byteLength(t) <= TEXT_MAX), "pms alert delivered, clipped");
  assert.ok(sentTelegram.some((t) => t.includes("«booking»")), "the other alert is not blocked");
  // (7) the Telegram acceptance was on disk before the next channel was tried.
  assert.equal(savedBeforeNtfy, true);
  // A message that Telegram refuses by content: other messages still go; after 3 cycles it is given up for Telegram,
  // logged and reported — not retried forever.
  (wd.state().outbox as { kind: string; check: string; text: string; severity?: string }[]).push({ kind: "open", severity: "critical", check: "x", text: "FORBIDDEN-WORD alert" });
  for (let i = 0; i < 4; i++) { await wd.cycle(); clock += 60_000; }
  const r = await wd.cycle();
  assert.equal(r.results.alert_undeliverable?.ok, false);
  assert.equal(wd.state().outbox.filter((m) => m.text.includes("FORBIDDEN-WORD")).length, 0, "no longer retried (given up for Telegram, delivered to ntfy)");
  // (8) time budget: a slow channel (each call takes 20 s of clock) stops the delivery loop for this cycle.
  let calls = 0;
  const slow = (async (url: string) => { if (url.includes("ntfy.example")) { calls++; clock += 20_000; return new Response(JSON.stringify({ id: "s" }), { status: 200 }); } return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  const w3 = createWatchdog(cfgFor({ pmsHealthUrl: "", bookingHealthUrl: "", heartbeatUrl: "", webhookUrl: "", ntfyUrl: "https://ntfy.example/t", intervalS: 60 }), { fetchImpl: slow, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 10; i++) (w3.state().outbox as { kind: string; check: string; text: string }[]).push({ kind: "reminder", check: `s${i}`, text: `s${i}` });
  await w3.cycle();
  assert.ok(calls <= 3, `delivery stopped by the time budget (${calls} calls)`);
  assert.equal(w3.state().outbox.length, 10 - calls, "the rest wait, in order");
});

test("v204 review 3 watchdog: a broken channel (401 / chat not found) never gives up an alert; strict arrival order; complete text in the log", async () => {
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const lines: string[] = [];
  const order: string[] = [];
  let telegramStatus = 401;
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: false, reason: "Ω".repeat(3000) }), { status: 503 });
    if (url.includes("api.telegram.org")) {
      order.push(JSON.parse(String(init?.body)).text.slice(0, 20));
      if (telegramStatus === 401) return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
      if (telegramStatus === 400) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ heartbeatUrl: "", webhookUrl: "", telegram: { token: "T", chat: "C" } }), { fetchImpl, now: () => clock, sleep: async () => {}, log: (l: string) => lines.push(l) });
  for (let i = 0; i < 8; i++) { await wd.cycle(); clock += 60_000; }
  assert.equal(wd.state().outbox.filter((m) => m.kind === "open" && m.check === "pms").length, 1, "401: still queued after 8 cycles");
  telegramStatus = 400;
  for (let i = 0; i < 5; i++) { await wd.cycle(); clock += 60_000; }
  assert.equal(wd.state().outbox.filter((m) => m.kind === "open" && m.check === "pms").length, 1, "«chat not found»: still queued");
  // The full 3000-character detail is in the log line of the alert.
  assert.ok(lines.some((l) => l.includes('"event":"alert"') && l.includes("Ω".repeat(3000))), "complete text logged");
  // Channel fixed: delivered strictly in arrival order (review 5: no reordering).
  (wd.state().outbox as { kind: string; check: string; text: string; severity?: string }[]).unshift({ kind: "reminder", severity: "warning", check: "old", text: "REMINDER-old" });
  telegramStatus = 200; order.length = 0;
  await wd.cycle();
  assert.ok(order[0].startsWith("REMINDER") && order.some((t) => t.includes("«pms»")), `arrival order: ${order.join(" | ")}`);
  assert.equal(wd.state().outbox.length, 0);
});

test("v204 review 4/5 watchdog: strict arrival order; a damaged state file does not stop the watchdog", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const clock = Date.parse("2026-11-24T10:00:00Z");
  const order: string[] = [];
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.includes("hook")) { order.push((JSON.parse(String(init?.body)) as { text: string }).text); return new Response("ok"); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ pmsHealthUrl: "", heartbeatUrl: "" }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  (wd.state().outbox as { kind: string; check: string; text: string; severity?: string }[]).push(
    { kind: "open", severity: "critical", check: "pms", text: "pms-open-1" },
    { kind: "reminder", severity: "warning", check: "db", text: "db-reminder" },
    { kind: "resolved", check: "pms", text: "pms-resolved" },
    { kind: "resolved", check: "db", text: "db-resolved" },
    { kind: "open", severity: "critical", check: "pms", text: "pms-open-2" });
  await wd.cycle();
  assert.deepEqual(order, ["pms-open-1", "db-reminder", "pms-resolved", "db-resolved", "pms-open-2"], "arrival order");
  const dir = mkdtempSync(join(tmpdir(), "wd3-"));
  writeFileSync(join(dir, "state.json"), JSON.stringify({ outbox: { broken: true }, checks: null }));
  const w2 = createWatchdog(cfgFor({ pmsHealthUrl: "", heartbeatUrl: "", stateFile: join(dir, "state.json") }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  assert.deepEqual(w2.state().outbox, []);
  await w2.cycle();
  // Deeper damage (review 5): non-object check, items / delivered of the wrong type — still runs.
  writeFileSync(join(dir, "state.json"), JSON.stringify({ checks: { pms: 5 }, outbox: [{ kind: "batch", check: "*", text: "b", items: { x: 1 }, delivered: { y: 1 } }] }));
  const w3 = createWatchdog(cfgFor({ heartbeatUrl: "", stateFile: join(dir, "state.json") }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  await w3.cycle();
  // An unreadable file is kept aside, not silently overwritten.
  writeFileSync(join(dir, "state.json"), "{not json");
  const logs: string[] = [];
  createWatchdog(cfgFor({ heartbeatUrl: "", stateFile: join(dir, "state.json") }), { fetchImpl, now: () => clock, sleep: async () => {}, log: (l: string) => logs.push(l) });
  const { readdirSync } = await import("node:fs");
  assert.ok(readdirSync(dir).some((f) => f.startsWith("state.json.corrupt-")));
  assert.ok(logs.some((l) => l.includes("state_unreadable")));
});

test("v204 review 5/6 watchdog: per-channel compaction keeps order; a refused message holds its channel in order, at most 3 cycles", async () => {
  const { compactOutbox, QUEUE_MAX } = await import("../tools/watchdog/watchdog.mjs");
  // 120 messages: pms resolved early (low priority), pms open later (critical) and other checks' reminders.
  const box = [{ kind: "resolved", check: "pms", at: 1, text: "pms-resolved" }, ...Array.from({ length: 118 }, (_, i) => ({ kind: "reminder", severity: "warning", check: `r${i}`, at: 2 + i, text: `r${i}` })), { kind: "open", severity: "critical", check: "pms", at: 500, text: "pms-open" }];
  const c = compactOutbox(box, "QA", ["webhook"]);
  assert.ok(c.length <= QUEUE_MAX);
  const flat = c.flatMap((m) => (m.kind === "digest" ? (m.items ?? []).map((x) => x.text) : [m.text]));
  const pmsOrder = flat.filter((t) => t.startsWith("pms"));
  assert.deepEqual(pmsOrder, ["pms-resolved", "pms-open"], "pms messages stay in order after compaction");
  assert.equal(flat.length, 120, "nothing lost");
  // Refused by content on Telegram → a newer message of the same check is not sent to Telegram before it.
  const clock = Date.parse("2026-11-24T10:00:00Z");
  const tg: string[] = [];
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.includes("api.telegram.org")) {
      const text = JSON.parse(String(init?.body)).text as string;
      if (text.includes("BAD")) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }), { status: 400 });
      tg.push(text); return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ pmsHealthUrl: "", heartbeatUrl: "", webhookUrl: "", telegram: { token: "T", chat: "C" } }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  (wd.state().outbox as { kind: string; check: string; text: string }[]).push({ kind: "open", check: "db", text: "db-open BAD" }, { kind: "resolved", check: "db", text: "db-resolved" }, { kind: "open", check: "tv", text: "tv-open" });
  // Review 6: the channel reads its queue strictly in order — nothing overtakes the refused message …
  await wd.cycle();
  assert.deepEqual(tg, [], "held behind the refused message");
  // … for at most 3 cycles: then it is given up for Telegram (logged, reported) and the rest follows IN ORDER.
  await wd.cycle(); await wd.cycle();
  assert.deepEqual(tg, ["db-resolved", "tv-open"]);
});

test("v204 review 6 watchdog: per-channel order through batches and compaction; Telegram never re-sent; damaged items repaired", async () => {
  const { compactOutbox, doneFor, QUEUE_MAX } = await import("../tools/watchdog/watchdog.mjs");
  // X-open (standalone) → batch containing X-resolved → 110 newer opens; Telegram took everything, ntfy is down.
  const box = [
    { kind: "open", severity: "critical", check: "X", at: 1, text: "X-open", delivered: ["telegram"] },
    { kind: "batch", severity: "warning", check: "*", at: 2, text: "batch", delivered: ["telegram"], items: [{ kind: "resolved", check: "X", at: 2, text: "X-resolved" }] },
    ...Array.from({ length: 110 }, (_, i) => ({ kind: "open", severity: "warning", check: `w${i}`, at: 3 + i, text: `w${i}`, delivered: ["telegram"] })),
  ];
  const c = compactOutbox(box, "QA", ["telegram", "ntfy"]);
  assert.ok(c.length <= QUEUE_MAX);
  const forNtfy = c.filter((m) => !doneFor(m, "ntfy")).flatMap((m) => (m.kind === "digest" || m.kind === "batch" ? (m.items ?? []).map((x) => x.text) : [m.text]));
  assert.deepEqual(forNtfy.slice(0, 2), ["X-open", "X-resolved"], "order kept for ntfy");
  assert.equal(forNtfy.length, 112, "nothing lost");
  assert.ok(c.every((m) => doneFor(m, "telegram")), "nothing new for Telegram (it already has all of it)");
  // Damaged items in a saved state file do not stop the cycle.
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "wd6-"));
  writeFileSync(join(dir, "state.json"), JSON.stringify({ outbox: [{ kind: "batch", check: "*", text: "b", items: [null, { text: 5 }, { kind: "open", check: "a", text: "ok" }], refused: { webhook: "x" } }], progress: { sentinelRuns: 5 } }));
  const clock = Date.parse("2026-11-24T10:00:00Z");
  const wd = createWatchdog(cfgFor({ pmsHealthUrl: "", heartbeatUrl: "", stateFile: join(dir, "state.json") }), { fetchImpl: (async () => new Response("ok")) as unknown as typeof fetch, now: () => clock, sleep: async () => {}, log: () => {} });
  await wd.cycle();
  assert.equal(wd.state().outbox.length, 0, "delivered after repair");
});

test("v204 review 7 watchdog: a hanging channel does not starve the others; damaged checks still alert; no channel; a channel added later; webhook size", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const got: Record<string, number> = { ntfy: 0, webhook: 0, telegram: 0 };
  // Telegram «hangs»: each call consumes 10 s of clock and times out.
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: false, reason: "down" }), { status: 503 });
    if (url.includes("api.telegram.org")) { got.telegram++; clock += 10_000; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }
    if (url.includes("ntfy.example")) { got.ntfy++; return new Response(JSON.stringify({ id: "n" }), { status: 200 }); }
    if (url.includes("hook")) { got.webhook++; const b = JSON.parse(String(init?.body)); if (b.items) assert.ok(b.items.length <= 200); return new Response("ok"); }
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ heartbeatUrl: "", telegram: { token: "T", chat: "C" }, ntfyUrl: "https://ntfy.example/t", webhookUrl: "http://hook/alert" }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 3; i++) { await wd.cycle(); clock += 60_000; }
  assert.ok(got.ntfy >= 1 && got.webhook >= 1, `the working channels got the alert while Telegram hangs: ${JSON.stringify(got)}`);
  // A damaged check (fails missing / not a number) still opens an incident.
  const dir = mkdtempSync(join(tmpdir(), "wd7-"));
  writeFileSync(join(dir, "state.json"), JSON.stringify({ checks: { pms: {}, booking: { fails: "x", open: "yes" } }, progress: { sentinelRuns: { value: "x", since: 1 } }, undeliverable: "bad", outbox: [] }));
  const alerts: string[] = [];
  const f2 = (async (url: string, init?: { body?: string }) => { if (url.includes("hook")) { alerts.push(JSON.parse(String(init?.body)).check); return new Response("ok"); } return new Response(JSON.stringify({ ok: false }), { status: 503 }); }) as unknown as typeof fetch;
  const w2 = createWatchdog(cfgFor({ heartbeatUrl: "", bookingHealthUrl: "", stateFile: join(dir, "state.json") }), { fetchImpl: f2, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 3; i++) { await w2.cycle(); clock += 60_000; }
  assert.ok(alerts.includes("pms"), "the repaired check opened");
  // No channel configured: the queue does not grow (every alert is in the log).
  const w3 = createWatchdog(cfgFor({ heartbeatUrl: "", webhookUrl: "" }), { fetchImpl: f2, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 6; i++) { await w3.cycle(); clock += 60_000; }
  assert.equal(w3.state().outbox.length, 0);
  // A channel added after a restart starts with new alerts only.
  const d2 = mkdtempSync(join(tmpdir(), "wd7b-"));
  writeFileSync(join(d2, "state.json"), JSON.stringify({ targets: ["webhook"], checks: {}, progress: {}, outbox: [{ kind: "reminder", check: "old", text: "old", delivered: [] }] }));
  const sent: string[] = [];
  const f3 = (async (url: string, init?: { body?: string }) => { if (url.includes("ntfy.example")) { sent.push(String(init?.body)); return new Response(JSON.stringify({ id: "n" }), { status: 200 }); } if (url.includes("hook")) return new Response("down", { status: 503 }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  const w4 = createWatchdog(cfgFor({ pmsHealthUrl: "", heartbeatUrl: "", ntfyUrl: "https://ntfy.example/t", stateFile: join(d2, "state.json") }), { fetchImpl: f3, now: () => clock, sleep: async () => {}, log: () => {} });
  await w4.cycle();
  assert.deepEqual(sent, [], "ntfy (new) does not get the old backlog");
  assert.equal(w4.state().outbox.length, 1, "the webhook still owes it");
});

test("v204 review 8 watchdog: digest text newest first even after collapsing; webhook body carries only the alert; no channel → no dead-man ping", async () => {
  const { compactOutbox, ITEMS_MAX } = await import("../tools/watchdog/watchdog.mjs");
  const box = [
    { kind: "open", severity: "critical", check: "pms", at: 1, text: "OPEN pms #1" },
    { kind: "resolved", check: "pms", at: 2, text: "RESOLVED pms #1" },
    ...Array.from({ length: ITEMS_MAX }, (_, i) => ({ kind: "reminder", severity: "warning", check: `c${i}`, at: 3 + i, text: `r${i}` })),
    { kind: "open", severity: "critical", check: "pms", at: 5000, text: "OPEN pms #2" },
  ];
  const d = compactOutbox(box, "QA", ["webhook"]).find((m) => m.kind === "digest")!;
  assert.ok(d.text.indexOf("OPEN pms #2") >= 0 && (d.text.indexOf("RESOLVED pms #1") < 0 || d.text.indexOf("OPEN pms #2") < d.text.indexOf("RESOLVED pms #1")), "the current state is listed first");
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const bodies: Record<string, unknown>[] = [];
  let deadman = 0;
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    if (url.includes("deadman")) { deadman++; return new Response("ok"); }
    if (url.includes("hook")) { bodies.push(JSON.parse(String(init?.body))); return new Response("ok"); }
    return new Response(JSON.stringify({ ok: false }), { status: 503 });
  }) as unknown as typeof fetch;
  const wd = createWatchdog(cfgFor({ heartbeatUrl: "", deadmanUrl: "http://deadman/ping" }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  for (let i = 0; i < 3; i++) { await wd.cycle(); clock += 60_000; }
  assert.ok(bodies.length && bodies.every((b) => !("delivered" in b) && !("errors" in b) && !("refused" in b)), "only the alert, no bookkeeping");
  assert.equal(deadman, 3);
  const w2 = createWatchdog(cfgFor({ heartbeatUrl: "", webhookUrl: "", deadmanUrl: "http://deadman/ping" }), { fetchImpl, now: () => clock, sleep: async () => {}, log: () => {} });
  await w2.cycle();
  assert.equal(deadman, 3, "no channel configured → the dead-man is not pinged (misconfiguration visible)");
});
