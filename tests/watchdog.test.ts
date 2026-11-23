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
