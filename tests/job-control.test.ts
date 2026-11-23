import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { claimLease, createStepRunner, cronFinish, cronOverlap, cronStart, guardedPool, hardDeadline, heartbeatState, releaseLease, withLease } from "../scripts/job-control-core.mjs";

async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const pool = {
    query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Record<string, unknown>>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; },
    connect: async () => ({ query: async (sql: string, params: unknown[] = []) => ({ rows: (await db.query<Record<string, unknown>>(sql, params)).rows }), release: () => {} }),
  };
  return { db, pool };
}
const o = "hotel-corali";

test("v189 leases: one holder at a time, expiry frees a crashed holder, withLease runs once", async () => {
  const { db, pool } = await fresh();
  try {
    const t = 1_000_000;
    assert.equal(await claimLease(pool, o, "step:x", "A", 60_000, t), true);
    assert.equal(await claimLease(pool, o, "step:x", "B", 60_000, t + 1000), false, "held by A");
    assert.equal(await claimLease(pool, o, "step:x", "A", 60_000, t + 2000), true, "the holder may renew");
    assert.equal(await claimLease(pool, o, "step:x", "B", 60_000, t + 62_001), true, "expired: A crashed");
    await releaseLease(pool, o, "step:x", "A");
    assert.equal(await claimLease(pool, o, "step:x", "C", 60_000, t + 63_000), false, "A cannot release B's lease");
    await releaseLease(pool, o, "step:x", "B");
    // Two clicks at the same time: the work runs once.
    let runs = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => { runs++; r(1); }, 50));
    const [a, b] = await Promise.all([withLease(pool, o, "recover:retry_outbox:1", 60_000, slow), withLease(pool, o, "recover:retry_outbox:1", 60_000, slow)]);
    assert.equal(runs, 1);
    assert.deepEqual([a.ran, b.ran].sort(), [false, true]);
    assert.equal((await withLease(pool, o, "recover:retry_outbox:1", 60_000, slow)).ran, true, "released afterwards");
  } finally { await db.close(); }
});

test("v189 heartbeat: start / finish / overlap / killed and the dead-man switch states", async () => {
  const { db, pool } = await fresh();
  try {
    const t = Date.parse("2026-07-15T10:00:00Z");
    const id = await cronStart(pool, o, "automations", { now: t });
    let row = (await db.query<Record<string, unknown>>(`SELECT * FROM cron_heartbeat WHERE job='automations'`)).rows[0];
    assert.equal(Number(row.running_since), t);
    assert.equal(heartbeatState(row, t + 30_000).status, "ok");
    assert.equal(heartbeatState(row, t + 7 * 60_000).status, "stopped", "no new start for 7 minutes");
    await cronOverlap(pool, o, "automations");
    await cronFinish(pool, o, "automations", id, { status: "ok", steps: { ok: 12, failed: 0, skipped: 1 }, now: t + 40_000, startedAt: t });
    row = (await db.query<Record<string, unknown>>(`SELECT * FROM cron_heartbeat WHERE job='automations'`)).rows[0];
    assert.equal(row.running_since, null);
    assert.equal(Number(row.last_duration_ms), 40_000);
    assert.equal(Number(row.overlap_count), 1);
    assert.equal(heartbeatState(row, t + 4 * 60_000).status, "late");
    // A run that started and never ended: hung after 6 minutes even though starts continue.
    const stuck = await cronStart(pool, o, "automations", { now: t + 60_000 });
    await cronStart(pool, o, "automations", { now: t + 8 * 60_000 });
    row = (await db.query<Record<string, unknown>>(`SELECT * FROM cron_heartbeat WHERE job='automations'`)).rows[0];
    assert.equal(heartbeatState(row, t + 8 * 60_000 + 1000).status, "hung");
    await cronFinish(pool, o, "automations", stuck, { status: "killed", error: "hard deadline", now: t + 8 * 60_000 + 2000, startedAt: t + 60_000 });
    row = (await db.query<Record<string, unknown>>(`SELECT * FROM cron_heartbeat WHERE job='automations'`)).rows[0];
    assert.equal(Number(row.killed), 1);
    assert.equal(Number(row.running_since), t + 8 * 60_000, "the newer run is still open");
    assert.equal(heartbeatState(null).status, "never");
  } finally { await db.close(); }
});

test("v189 cancellable steps: after the time limit the step's fetch is aborted and its queries are refused", async () => {
  const { db, pool } = await fresh();
  const original = globalThis.fetch;
  let aborted = false;
  // A server that never answers: resolves only through the abort signal.
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_, reject) => { init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }); })) as typeof fetch;
  try {
    const gp = guardedPool(pool);
    const records: string[] = [];
    const runner = createStepRunner({ pool: gp, owner: o, record: async (n, s) => { records.push(`${n}:${s}`); } });
    let lateWrite: unknown = "not attempted";
    const step = async () => {
      await fetch("https://example.invalid/hang").catch(() => undefined);
      // The step carries on after its request failed — its write must be refused.
      try { await gp.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,created_at) VALUES('x','t','late','late',1)`); lateWrite = "written"; } catch (e) { lateWrite = (e as Error).message; }
    };
    await assert.rejects(runner.run("Hanging step", 100, step), /TIMEOUT/);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(aborted, true, "the hanging request was aborted");
    assert.match(String(lateWrite), /CANCELLED/);
    assert.equal((await db.query(`SELECT 1 FROM pms_notifications WHERE title_el='late'`)).rows.length, 0);
    // Outside a step nothing is blocked; a normal step works.
    assert.equal(await runner.run("Quick", 1000, async () => (await gp.query(`SELECT 1 AS one`)).rows[0].one), 1);
    // ROLLBACK passes after cancellation, so an open transaction is closed.
    const c = await gp.connect();
    const ctl = await runner.run("Tx", 1000, async () => { await c.query("BEGIN"); return "ok"; });
    assert.equal(ctl, "ok");
    await c.query("ROLLBACK");
    assert.deepEqual(records, ["Hanging step:timeout", "Quick:ok", "Tx:ok"]);
    assert.deepEqual(runner.counts, { ok: 2, failed: 1, skipped: 0 });
  } finally { globalThis.fetch = original; await db.close(); }
});

test("v189 step leases: a step still running from the previous run is skipped, not run twice", async () => {
  const { db, pool } = await fresh();
  try {
    const a = createStepRunner({ pool, owner: o, holder: "run-1" }), b = createStepRunner({ pool, owner: o, holder: "run-2" });
    let n = 0;
    const work = () => new Promise((r) => setTimeout(() => { n++; r(n); }, 80));
    const [x, y] = await Promise.all([a.run("Guest messages", 5000, work, { lease: "step:Guest messages" }), new Promise((r) => setTimeout(r, 10)).then(() => b.run("Guest messages", 5000, work, { lease: "step:Guest messages" }))]);
    assert.equal(n, 1);
    assert.equal(x, 1);
    assert.equal(y, undefined);
    assert.equal(b.counts.skipped, 1);
    assert.equal(await b.run("Guest messages", 5000, work, { lease: "step:Guest messages" }), 2, "free again after the first run");
  } finally { await db.close(); }
});

test("v189 hard deadline: records the kill, then exits", async () => {
  const events: string[] = [];
  const keep = setTimeout(() => {}, 2000);
  await new Promise<void>((done) => {
    hardDeadline(20, async () => { events.push("recorded"); }, (code) => { events.push(`exit ${code}`); done(); });
  });
  assert.deepEqual(events, ["recorded", "exit 3"]);
  const disarm = hardDeadline(20, () => events.push("never"), () => events.push("never exit"));
  disarm();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(events.length, 2);
  clearTimeout(keep);
});
