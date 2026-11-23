// v189 job control for the cron and the PMS recovery buttons:
//  • leases — one holder per task at a time (two cron runs, or a double click, never do the same work in parallel);
//    a lease expires by itself, so a crashed holder never blocks the task for good;
//  • heartbeat — every cron run records its start and end (dead-man switch, see heartbeatState);
//  • cancellable steps — a step that passes its time limit is cancelled: its HTTP requests are aborted and its next
//    database queries are refused, so it does not keep working (and writing) in the background after the timeout.
import { AsyncLocalStorage } from "node:async_hooks";

const MIN = 60_000;

/** Takes the lease if it is free or expired. True when this holder has it. */
export async function claimLease(pool, owner, key, holder, ttlMs, now = Date.now()) {
  const r = await pool.query(
    `INSERT INTO job_leases(owner_id,lease_key,holder,acquired_at,expires_at) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(owner_id,lease_key) DO UPDATE SET holder=EXCLUDED.holder,acquired_at=EXCLUDED.acquired_at,expires_at=EXCLUDED.expires_at
     WHERE job_leases.expires_at<=$4 OR job_leases.holder=EXCLUDED.holder RETURNING holder`,
    [owner, key, holder, now, now + ttlMs],
  );
  return r.rows.length > 0 && r.rows[0].holder === holder;
}

export async function releaseLease(pool, owner, key, holder) {
  await pool.query(`DELETE FROM job_leases WHERE owner_id=$1 AND lease_key=$2 AND holder=$3`, [owner, key, holder]);
}

/** Runs fn only if the lease could be taken: { ran: false } when another holder is doing it. */
export async function withLease(pool, owner, key, ttlMs, fn, holder = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`) {
  if (!(await claimLease(pool, owner, key, holder, ttlMs))) return { ran: false };
  try { return { ran: true, value: await fn() }; } finally { await releaseLease(pool, owner, key, holder).catch(() => {}); }
}

/** Start of a cron run: heartbeat + history row. Returns the run id. */
export async function cronStart(pool, owner, job, { now = Date.now(), pid = process.pid, host = "" } = {}) {
  await pool.query(
    `INSERT INTO cron_heartbeat(owner_id,job,last_start_at,running_since,host,pid,runs) VALUES($1,$2,$3::bigint,$3::bigint,$4,$5::int,1)
     ON CONFLICT(owner_id,job) DO UPDATE SET last_start_at=$3::bigint,running_since=COALESCE(cron_heartbeat.running_since,$3::bigint),host=$4,pid=$5::int,runs=cron_heartbeat.runs+1`,
    [owner, job, now, host, pid],
  );
  const r = await pool.query(`INSERT INTO cron_runs(owner_id,job,started_at,pid) VALUES($1,$2,$3,$4) RETURNING id`, [owner, job, now, pid]);
  // History of two days is enough to see a pattern.
  if (new Date(now).getUTCMinutes() === 17) await pool.query(`DELETE FROM cron_runs WHERE owner_id=$1 AND started_at<$2`, [owner, now - 2 * 86_400_000]).catch(() => {});
  return Number(r.rows[0].id);
}

/** End of a cron run (status ok / failed / killed). */
export async function cronFinish(pool, owner, job, runId, { status, steps = {}, error = "", now = Date.now(), startedAt = now }) {
  const failed = status !== "ok";
  await pool.query(`UPDATE cron_runs SET finished_at=$2,status=$3,steps_ok=$4,steps_failed=$5,steps_skipped=$6,error=$7 WHERE id=$1`, [runId, now, status, steps.ok ?? 0, steps.failed ?? 0, steps.skipped ?? 0, String(error).slice(0, 500)]);
  // running_since is cleared only when no other run of the job is still open.
  await pool.query(
    `UPDATE cron_heartbeat SET last_finish_at=$3::bigint,last_status=$4,last_error=$5,last_duration_ms=$6::int,failures=failures+$7::int,killed=killed+$8::int,
       running_since=(SELECT min(started_at) FROM cron_runs WHERE owner_id=$1 AND job=$2 AND status='running' AND started_at>$3::bigint-600000)
     WHERE owner_id=$1 AND job=$2`,
    [owner, job, now, status, String(error).slice(0, 500), Math.max(0, now - startedAt), failed ? 1 : 0, status === "killed" ? 1 : 0],
  );
}

export async function cronOverlap(pool, owner, job) {
  await pool.query(`UPDATE cron_heartbeat SET overlap_count=overlap_count+1 WHERE owner_id=$1 AND job=$2`, [owner, job]);
}

/**
 * Dead-man switch: the state of a cron job from its heartbeat row. everyMs is how often it should start.
 * never → no run ever recorded; stopped → no start for 5 periods (at least 5 minutes); late → 3 periods; hung → a run
 * that started more than maxRunMs ago and never finished; failing → the last run failed.
 */
export function heartbeatState(row, now = Date.now(), { everyMs = MIN, maxRunMs = 6 * MIN } = {}) {
  if (!row || !row.last_start_at) return { status: "never", level: "warn" };
  const since = now - Number(row.last_start_at);
  if (since > Math.max(5 * everyMs, 5 * MIN)) return { status: "stopped", level: "fail", since };
  if (row.running_since && now - Number(row.running_since) > maxRunMs) return { status: "hung", level: "fail", since: now - Number(row.running_since) };
  if (since > Math.max(3 * everyMs, 3 * MIN)) return { status: "late", level: "warn", since };
  if (row.last_status && row.last_status !== "ok") return { status: row.last_status === "killed" ? "killed" : "failing", level: "warn", since };
  return { status: "ok", level: "ok", since };
}

const steps = new AsyncLocalStorage();
let fetchPatched = false;

/** Inside a step: its cancellation signal (undefined outside a step). */
export const currentSignal = () => steps.getStore()?.signal;

function cancelledError(name) {
  const e = new Error(`CANCELLED: ${name} passed its time limit`);
  e.name = "AbortError";
  return e;
}

/**
 * Every fetch made inside a step carries the step's signal (combined with its own), so a timed-out step's requests
 * are aborted. Installed once per process.
 */
export function installCancellableFetch() {
  if (fetchPatched || typeof globalThis.fetch !== "function") return;
  const original = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const store = steps.getStore();
    if (!store) return original(input, init);
    if (store.signal.aborted) return Promise.reject(cancelledError(store.name));
    const signal = init?.signal ? AbortSignal.any([init.signal, store.signal]) : store.signal;
    return original(input, { ...init, signal });
  };
  fetchPatched = true;
}

const PASS = /^\s*(ROLLBACK|RELEASE|COMMIT)/i;
const guard = (q) => function (...args) {
  const store = steps.getStore();
  const text = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
  // After the time limit: no new work. ROLLBACK still passes, so an open transaction is closed cleanly.
  if (store?.signal.aborted && !PASS.test(text)) return Promise.reject(cancelledError(store.name));
  return q.apply(this, args);
};

/** A pool whose queries (and those of its clients) are refused once the current step is cancelled. */
export function guardedPool(pool) {
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") return guard(target.query.bind(target));
      if (prop === "connect") return async (...a) => {
        const client = await target.connect(...a);
        return new Proxy(client, { get: (c, p) => (p === "query" ? guard(c.query.bind(c)) : typeof c[p] === "function" ? c[p].bind(c) : c[p]) });
      };
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * Cron step runner. run(name, ms, fn, { lease }) runs fn inside a cancellable scope with a time limit; with a lease
 * key the step is skipped (status «skipped») while another run still holds it. record(name, status, error, ms) keeps
 * the result. Returns fn's value; throws on failure / timeout.
 */
export function createStepRunner({ pool, owner, record = async () => {}, holder = `${process.pid}:${Date.now().toString(36)}` }) {
  installCancellableFetch();
  const counts = { ok: 0, failed: 0, skipped: 0 };
  async function run(name, ms, fn, { lease = null } = {}) {
    const t0 = Date.now();
    if (lease && !(await claimLease(pool, owner, lease, holder, ms + 30_000).catch(() => false))) {
      counts.skipped++;
      await record(name, "skipped", "previous run still working", 0).catch(() => {});
      return undefined;
    }
    const ctl = new AbortController();
    let timer;
    try {
      const value = await Promise.race([
        steps.run({ signal: ctl.signal, name }, () => Promise.resolve().then(fn)),
        new Promise((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(Error(`${name}: TIMEOUT ${ms / 1000}s`)); }, ms); timer.unref?.(); }),
      ]);
      counts.ok++;
      await record(name, "ok", "", Date.now() - t0).catch(() => {});
      return value;
    } catch (e) {
      ctl.abort();
      const m = e instanceof Error ? e.message : String(e);
      counts.failed++;
      await record(name, /TIMEOUT/.test(m) ? "timeout" : "failed", m, Date.now() - t0).catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
      if (lease) await releaseLease(pool, owner, lease, holder).catch(() => {});
    }
  }
  return { run, counts };
}

/**
 * Hard deadline for the whole process: after ms it records the run as killed (waiting at most 3 s) and exits, so a
 * cron run never overlaps the next ones indefinitely. Returns a function that disarms it.
 */
export function hardDeadline(ms, onKill, exit = (code) => process.exit(code)) {
  const t = setTimeout(async () => {
    await Promise.race([Promise.resolve().then(onKill).catch(() => {}), new Promise((r) => setTimeout(r, 3_000))]);
    exit(3);
  }, ms);
  t.unref?.();
  return () => clearTimeout(t);
}
