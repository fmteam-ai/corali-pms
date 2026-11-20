import assert from "node:assert/strict";
import test from "node:test";
import { alertText, edgeDecision, edgeExempt, edgeKeyMatches, edgeSecretHash, EDGE_STALE_MS, eventHour, newEdgeSecret, pickClientIp, securityAlerts } from "../scripts/security-core.mjs";
import { runSecurityCheck } from "../scripts/security-worker.mjs";

const headers = (h: Record<string, string>) => (n: string) => h[n] ?? null;

test("client address: Cloudflare's header wins, a forged X-Forwarded-For first entry is ignored", () => {
  assert.equal(pickClientIp(headers({ "cf-connecting-ip": "84.1.2.3", "x-forwarded-for": "1.1.1.1, 84.1.2.3" })), "84.1.2.3");
  // Without Cloudflare: the LAST entry (added by the hotel's own server), never the visitor's first one.
  assert.equal(pickClientIp(headers({ "x-forwarded-for": "6.6.6.6, 84.1.2.3" })), "84.1.2.3");
  assert.equal(pickClientIp(headers({ "x-real-ip": "10.0.0.5" })), "10.0.0.5");
  assert.equal(pickClientIp(headers({ "cf-connecting-ip": "<script>" })), "unknown");
  assert.equal(pickClientIp(headers({ "cf-connecting-ip": "2a02:587:abcd::1" })), "2a02:587:abcd::1");
});

test("origin key: only the exact key matches", () => {
  const key = newEdgeSecret();
  assert.match(key, /^ce_[A-Za-z0-9_-]{32}$/);
  const hash = edgeSecretHash(key);
  assert.equal(edgeKeyMatches(key, hash), true);
  assert.equal(edgeKeyMatches(`${key}x`, hash), false);
  assert.equal(edgeKeyMatches("", hash), false);
  assert.equal(edgeKeyMatches(key, ""), false);
});

test("origin lock: blocks requests without the key, but never locks the hotel out", () => {
  const now = 1_000_000_000;
  assert.equal(edgeDecision({ enforce: false, keyOk: false, lastSeenAt: null, now }), "allow");
  assert.equal(edgeDecision({ enforce: true, keyOk: true, lastSeenAt: now, now }), "allow");
  assert.equal(edgeDecision({ enforce: true, keyOk: false, lastSeenAt: now - 60_000, now }), "block");
  // The Cloudflare rule was removed (no key for 30 minutes): open again.
  assert.equal(edgeDecision({ enforce: true, keyOk: false, lastSeenAt: now - EDGE_STALE_MS - 1, now }), "open");
  assert.equal(edgeDecision({ enforce: true, keyOk: false, lastSeenAt: null, now }), "open");
  assert.equal(edgeExempt("/api/health"), true);
  assert.equal(edgeExempt("/api/health/key-consistency"), true);
  assert.equal(edgeExempt("/api/pms/rooms"), false);
});

test("alerts: thresholds per hour, admins without 2FA, stale lock", () => {
  const now = Date.UTC(2026, 10, 20, 21, 7);
  const a = securityAlerts({ counts: { login_failed: 20, rate_limited: 5, bad_tv_token: 60 }, admins: [{ username: "maria", role: "admin", totp: false }, { username: "hk", role: "housekeeping", totp: false }, { username: "owner", role: "owner", totp: true }], edge: { enforce: true, lastSeenAt: now - 2 * EDGE_STALE_MS }, now });
  assert.deepEqual(a.map((x) => x.kind).sort(), ["edge_stale", "login_failed", "no_2fa"]);
  assert.equal(a.find((x) => x.kind === "login_failed")?.key, `login_failed:${eventHour(now)}`);
  assert.match(alertText(a.find((x) => x.kind === "no_2fa")!).el, /maria/);
  assert.match(alertText(a.find((x) => x.kind === "login_failed")!).el, /20 αποτυχημένες/);
});

test("hourly check: tells each problem once, purges old counters", async () => {
  const sql: string[] = [];
  let alerted = "[]";
  const pool = {
    async query(text: string, params: unknown[] = []) {
      sql.push(text);
      if (text.includes("FROM security_events")) return { rows: [{ kind: "bad_api_key", n: 40 }] };
      if (text.includes("FROM audit_logs")) return { rows: [{ n: 0 }] };
      if (text.includes("FROM pms_staff_users")) return { rows: [{ username: "nikos", role: "manager", totp_confirmed_at: null }] };
      if (text.includes("FROM security_settings")) return { rows: [{ edge_enforce: 0, edge_last_seen_at: null, alerted_json: alerted }] };
      if (text.startsWith("INSERT INTO security_settings")) alerted = String(params[1]);
      return { rows: [] };
    },
  };
  const now = Date.UTC(2026, 10, 20, 21, 7);
  const first = await runSecurityCheck({ pool, owner: "o", now });
  assert.deepEqual(first, { alerts: 2, told: 2 });
  const second = await runSecurityCheck({ pool, owner: "o", now: now + 60_000 });
  assert.deepEqual(second, { alerts: 2, told: 0 });
  assert.ok(sql.some((s) => s.startsWith("DELETE FROM security_events")));
});
