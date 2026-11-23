import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { assertCurrentLease, claimLease, createStepRunner, cronFinish, cronOverlap, cronStart, guardedPool, hardDeadline, heartbeatState, holdsLease, releaseLease, renewLease, withLease } from "../scripts/job-control-core.mjs";

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
    const fA = await claimLease(pool, o, "step:x", "A", 60_000, t);
    assert.equal(fA, 1, "first holder: fencing token 1");
    assert.equal(await claimLease(pool, o, "step:x", "B", 60_000, t + 1000), 0, "held by A");
    assert.equal(await claimLease(pool, o, "step:x", "A", 60_000, t + 2000), 1, "the holder may renew, same token");
    const fB = await claimLease(pool, o, "step:x", "B", 60_000, t + 62_001);
    assert.equal(fB, 2, "expired: A crashed, B takes over with a higher token");
    assert.equal(await holdsLease(pool, o, "step:x", "A", fA, t + 62_002), false, "A's token is stale (fencing)");
    assert.equal(await holdsLease(pool, o, "step:x", "B", fB, t + 62_002), true);
    assert.equal(await renewLease(pool, o, "step:x", "A", 60_000, t + 63_000), false, "A cannot extend B's lease");
    await releaseLease(pool, o, "step:x", "A");
    assert.equal(await claimLease(pool, o, "step:x", "C", 60_000, t + 63_000), 0, "A cannot release B's lease");
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
    await runner.drain(1000);
    assert.deepEqual([...records].sort(), ["Hanging step:late_ok", "Hanging step:timeout", "Quick:ok", "Tx:ok"]);
    assert.deepEqual(runner.counts, { ok: 2, failed: 1, skipped: 0, late: 1 });
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

test("v190 a timed-out step keeps its lease until it really ends; a lost lease cancels it (fencing)", async () => {
  const { db, pool } = await fresh();
  try {
    const records: string[] = [];
    const a = createStepRunner({ pool, owner: o, holder: "run-1", record: async (n, st) => { records.push(st); } });
    let release!: () => void;
    const slowSmtp = new Promise<void>((r) => { release = r; }); // e.g. an SMTP session that ignores abort signals
    let finished = false;
    await assert.rejects(a.run("Guest messages", 50, async () => { await slowSmtp; finished = true; }, { lease: "step:Guest messages" }), /TIMEOUT/);
    // The next minute's run: the work may still be sending, so it must NOT start the same step.
    const b = createStepRunner({ pool, owner: o, holder: "run-2" });
    let ran = false;
    assert.equal(await b.run("Guest messages", 1000, async () => { ran = true; }, { lease: "step:Guest messages" }), undefined);
    assert.equal(ran, false);
    assert.equal(b.counts.skipped, 1);
    release();
    assert.equal(await a.drain(1000), true);
    assert.equal(finished, true);
    assert.deepEqual(records, ["timeout", "late_ok"]);
    assert.equal((await db.query(`SELECT 1 FROM job_leases WHERE lease_key='step:Guest messages'`)).rows.length, 0, "released only after the real end");
    assert.notEqual(await b.run("Guest messages", 1000, async () => { ran = true; return 1; }, { lease: "step:Guest messages" }), undefined);

    // Lease lost while running (taken over after expiry): the step is cancelled and its writes refused.
    const gp = guardedPool(pool);
    const c = createStepRunner({ pool: gp, owner: o, holder: "run-3", renewEveryMs: 20 });
    let write = "";
    const p = c.run("Room climate", 2000, async () => {
      await db.query(`UPDATE job_leases SET holder='intruder',fence=fence+1 WHERE lease_key='step:Room climate'`);
      await new Promise((r) => setTimeout(r, 80));
      try { await gp.query(`SELECT 1`); write = "done"; } catch (e) { write = (e as Error).message; }
    }, { lease: "step:Room climate" });
    await p;
    assert.match(write, /CANCELLED: Room climate lost its lease/);
  } finally { await db.close(); }
});

test("v191 lease expiry is a hard limit: no revival, no fencing pass, no send after the lease is lost", async () => {
  const { db, pool } = await fresh();
  try {
    const t = 5_000_000;
    const f = await claimLease(pool, o, "step:y", "A", 10_000, t);
    assert.equal(await holdsLease(pool, o, "step:y", "A", f, t + 5_000), true);
    assert.equal(await holdsLease(pool, o, "step:y", "A", f, t + 10_001), false, "expired, even though nobody took it");
    assert.equal(await renewLease(pool, o, "step:y", "A", 10_000, t + 10_001), false, "an expired lease is not revived");
    assert.equal(await renewLease(pool, o, "step:y", "A", 10_000, t + 9_000, f + 1), false, "wrong token");
    assert.equal(await renewLease(pool, o, "step:y", "A", 10_000, t + 9_000, f), true);
    // Inside a leased step: allowed while held; LEASE_LOST once taken over.
    const runner = createStepRunner({ pool, owner: o, holder: "run-9", renewEveryMs: 1_000_000 });
    const seen: string[] = [];
    await runner.run("Send", 2000, async () => {
      await assertCurrentLease(pool, o); seen.push("send 1");
      await db.query(`UPDATE job_leases SET holder='other',fence=fence+1 WHERE lease_key='step:Send'`);
      try { await assertCurrentLease(pool, o); seen.push("send 2"); } catch (e) { seen.push((e as Error).message); }
    }, { lease: "step:Send" });
    assert.deepEqual(seen, ["send 1", "LEASE_LOST"]);
    await assertCurrentLease(pool, o); // outside a step: nothing to check
  } finally { await db.close(); }
});
