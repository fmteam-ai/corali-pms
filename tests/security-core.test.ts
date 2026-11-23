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
  // v183: public files are never locked (the image optimizer fetches them from the server itself, without the key).
  assert.equal(edgeExempt("/hotel-corali-logo.png"), true);
  assert.equal(edgeExempt("/downloads/corali-tv-pilot.apk"), true);
  assert.equal(edgeExempt("/pms"), false);
  assert.equal(edgeExempt("/api/public/room-photos/3.jpg"), false);
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

test("SQL: column labels use AS (the hotel's older PostgreSQL rejects a bare «role» label, v181)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/security-center.ts", "scripts/security-worker.mjs"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\)(::int)? (role|n|last_at|detail)[,\s]/, f);
  }
});

test("v184: only the installer's one-time smoke key passes the origin lock, and only when that process has it", async () => {
  const { smokeBypass } = await import("../scripts/security-core.mjs");
  const token = "a".repeat(64);
  assert.equal(smokeBypass(token, token), true);
  assert.equal(smokeBypass(token, "b".repeat(64)), false);
  assert.equal(smokeBypass(undefined, token), false, "live applications have no token: nothing passes");
  assert.equal(smokeBypass("", ""), false);
  assert.equal(smokeBypass("short", "short"), false);
  assert.equal(smokeBypass(token, null), false);
  const smoke = (await import("node:fs")).readFileSync(new URL("../scripts/smoke-runtime.sh", import.meta.url), "utf8");
  assert.match(smoke, /CORALI_SMOKE_TOKEN="\$smoke_token" PORT=/);
  assert.equal((smoke.match(/"x-corali-smoke"/g) ?? []).length, 3, "health, diagnostics and availability checks send it");
  const proxy = (await import("node:fs")).readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /smokeBypass\(process\.env\.CORALI_SMOKE_TOKEN/);
  assert.match(proxy, /headers\.delete\(SMOKE_HEADER\)/);
});

test("v198 origin lock when the key stops arriving: documented policy — open_all opens everything, protect_admin keeps the administration locked", async () => {
  const { isAdminPath, EDGE_STALE_POLICIES } = await import("../scripts/security-core.mjs");
  const now = Date.parse("2026-11-23T12:00:00Z"), stale = now - EDGE_STALE_MS - 1;
  const d = (path: string, policy: string, lastSeenAt = stale) => edgeDecision({ enforce: true, keyOk: false, lastSeenAt, now, path, policy });
  assert.deepEqual(EDGE_STALE_POLICIES, ["open_all", "protect_admin"]);
  assert.equal(d("/api/pms/reservations", "open_all"), "open", "default stays fail-open (documented, alerted at once)");
  assert.equal(d("/api/public/availability", "protect_admin"), "open");
  for (const p of ["/pms", "/pms/reservations", "/api/pms/security", "/login", "/api/auth/login", "/hk", "/staff"]) assert.equal(d(p, "protect_admin"), "block", p);
  assert.equal(isAdminPath("/pmsx"), false);
  assert.equal(d("/api/pms/x", "protect_admin", now - 60_000), "block", "not stale: locked as always");
  assert.equal(edgeDecision({ enforce: true, keyOk: true, lastSeenAt: stale, now, path: "/pms", policy: "protect_admin" }), "allow", "the right key always passes");
  // The PMS tells the owner at once (not only at the hourly check) and the recovery command exists in the package.
  const fs = await import("node:fs");
  const proxy = fs.readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /void notifyEdgeOpen\(edge\)/);
  assert.match(proxy, /policy: edge\.policy/);
  const pkg = fs.readFileSync(new URL("../scripts/package-cpanel.sh", import.meta.url), "utf8");
  assert.match(pkg, /scripts\/edge-lock\.mjs/);
});
