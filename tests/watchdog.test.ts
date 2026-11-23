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
