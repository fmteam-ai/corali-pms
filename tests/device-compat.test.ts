import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { CLOCK_SKEW_MS, EVIDENCE_TTL_DAYS, allowedOperations, assignUnit, deviceRegistry, importProbeReport, markHardwareChange, observeRemoteChange, probeEvidence, recordEvidence, registerAdapter, revokeFunction, runAdapterCommandTest, seedHotelModules, unitState, validateEvidence } from "../scripts/device-compat-core.mjs";

const o = "hotel-corali", DAY = 86_400_000;
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  // One PGlite connection: transactions from connect() run one after another (PostgreSQL connections are serialised
  // the same way by the row lock + the unique fingerprint index).
  let chain: Promise<void> = Promise.resolve();
  const connect = async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => { release = r; }); await prev; return { query, release }; };
  return { db, pool: { query, connect } };
}
// A full (protected) AC Probe v4 report, as tools/ac-probe/ac_probe.py writes it.
const report = (at = "2026-11-20T10:00:00+0200") => ({
  tool: "corali-ac-probe", version: 4, at,
  devices: [
    { ip: "192.168.10.21", mac: "10:d5:61:11:22:33", module_vendor: "Tuya Smart", tuya: { device_id: "bf1234567890abcdef", version: "3.3", product_key: "keyabc" }, tuya_read: { ok: true, version: "3.3", device_id: "bf1234567890abcdef", dps: { 1: true, 2: 24, 3: 27 }, candidates: { power: true, setpoint: 24, room_temperature: 27 } }, access: "AUTHENTICATED", access_reason: "Tuya v3.3: η κατάσταση διαβάστηκε τοπικά", level: "STATUS_READ" },
    { ip: "192.168.10.31", mac: "34:ea:34:01:02:03", module_vendor: "Hangzhou BroadLink", broadlink: { devtype: "0x4e2a", model: "AC", manufacturer: "AUX", locked: false }, access: "DISCOVERED_UNVERIFIED", access_reason: "BroadLink: απαντά στην ανακάλυψη", level: "DISCOVERED" },
    { ip: "192.168.10.33", mac: "78:0f:77:07:08:09", module_vendor: "Hangzhou BroadLink", broadlink: { devtype: "0x4e2a", model: "AC", manufacturer: "AUX", locked: false }, access: "NETWORK_ERROR", access_reason: "χωρίς απάντηση", level: "DISCOVERED" },
    { ip: "192.168.10.34", mac: "c8:f7:42:01:01:01", module_vendor: "Hangzhou BroadLink", broadlink: { devtype: "0x4e2a", model: "AC", manufacturer: "AUX", locked: false }, access: "AUTH_FAILED", access_reason: "απέρριψε", level: "DISCOVERED" },
  ],
});
const now0 = Date.parse("2026-11-21T10:00:00Z");
const ev = (level: string, at: number, extra: Row = {}) => ({ level, result: "PASS", at, verification: "PROBE", function: "", ...extra });
const statusRead = (at: number) => [ev("DISCOVERED", at), ev("AUTHENTICATED", at), ev("STATUS_READ", at, { functions: { raw: { 2: 24 } } })];
const mapping = (fn: string, at: number) => ({ level: "STATUS_READ", function: fn, result: "PASS", verification: "MANUALLY_ATTESTED", at });
const commandEv = (fn: string, at: number, verification = "MANUALLY_ATTESTED", result = "PASS") => ({ level: "COMMAND_CONFIRMED", function: fn, result, verification, at });

test("v199 P1: permissions per FUNCTION — a confirmed setpoint never unlocks power, mode or fan; a function can be revoked", () => {
  const s = unitState([...statusRead(now0), mapping("setpoint", now0), commandEv("setpoint", now0 + 1000)], { now: now0 + 2000 });
  assert.equal(s.level, "COMMAND_CONFIRMED");
  const a = allowedOperations(s);
  assert.equal(a.commands.setpoint, "MANUALLY_ATTESTED");
  assert.deepEqual([a.commands.power, a.commands.mode, a.commands.fan], [null, null, null], "only the tested function");
  assert.equal(a.read.setpoint, true);
  assert.equal(a.read.power, false, "power read not confirmed either");
  assert.equal(a.automation.setpoint, false, "a manual attestation never authorises automatic control");
  assert.ok(!("command" in a), "no device-wide «command» flag exists any more");
  const revoked = unitState([...statusRead(now0), mapping("setpoint", now0), commandEv("setpoint", now0 + 1000), commandEv("setpoint", now0 + 5000, "MANUALLY_ATTESTED", "REVOKED")], { now: now0 + 6000 });
  assert.equal(allowedOperations(revoked).commands.setpoint, null);
  assert.equal(revoked.functions.setpoint.command.state, "REVOKED");
  assert.equal(revoked.level, "STATUS_READ");
  // A command for a function whose read is not confirmed is refused by the rules.
  const base = unitState([...statusRead(now0)], { now: now0 });
  const cmd = { level: "COMMAND_CONFIRMED", function: "power", result: "PASS", method: "manual-test", verification: "MANUALLY_ATTESTED", detail: "δοκιμή on/off από το τοπικό API", functions: { command: { value: true }, before: { value: false }, after: { value: true } } };
  assert.equal(validateEvidence(cmd, base), "FUNCTION_READ_NOT_CONFIRMED");
  assert.equal(validateEvidence({ ...cmd, function: "room_temperature" }, base), "NOT_A_COMMAND_FUNCTION");
  assert.equal(validateEvidence({ ...cmd, function: "" }, base), "FUNCTION_REQUIRED");
});

test("v199 P1: one validation for every path — a probe report with empty datapoints never becomes STATUS_READ; candidates are never confirmed mappings", async () => {
  const empty = { ...report(), devices: [{ ...report().devices[0], tuya_read: { ok: true, version: "3.3", device_id: "bf1234567890abcdef", candidates: {}, dps: {} } }] };
  const proposed = probeEvidence(empty).devices![0].evidence.find((e: { level: string }) => e.level === "STATUS_READ");
  assert.equal(validateEvidence(proposed, unitState([ev("DISCOVERED", now0), ev("AUTHENTICATED", now0)], { now: now0 })), "VALUES_REQUIRED", "the same rule as a manual entry");
  const { db, pool } = await fresh();
  try {
    const r = await importProbeReport({ pool, owner: o, report: empty, by: "M", now: now0 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.rejected, [{ unitKey: "tuya:bf1234567890abcdef", level: "STATUS_READ", error: "VALUES_REQUIRED" }]);
    const reg = await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 });
    assert.equal(reg.units[0].level, "AUTHENTICATED", "rejected → not STATUS_READ");
    // With real datapoints: STATUS_READ = raw values; the probe's guesses stay candidates, no function is readable.
    await importProbeReport({ pool, owner: o, report: report("2026-11-20T11:00:00+0200"), by: "M", now: now0 });
    const u = (await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 })).units.find((x) => x.refs!.ip === "192.168.10.21")!;
    assert.equal(u.level, "STATUS_READ");
    assert.deepEqual(u.candidates, { power: true, setpoint: 24, room_temperature: 27 });
    assert.ok(Object.values(u.allowed.read).every((v) => v === false), "no mapping is confirmed by the probe");
    // A probe record can never confirm a function.
    assert.equal(validateEvidence({ level: "STATUS_READ", function: "setpoint", result: "PASS", method: "ac-probe v4", verification: "PROBE", functions: { mapping: { value: 24, observed: 24 } } }, unitState(statusRead(now0), { now: now0 })), "PROBE_CANNOT_CONFIRM_FUNCTIONS");
    // A person confirms the mapping: what the module read vs what the unit itself showed.
    const bad = await recordEvidence({ pool, owner: o, unitId: u.id, level: "STATUS_READ", result: "PASS", method: "manual-mapping", function: "setpoint", detail: "η οθόνη της μονάδας έδειχνε 25", functions: { mapping: { dp: "2", value: 24, observed: 25 } }, by: "N", now: now0 });
    assert.equal(bad.error, "MAPPING_DOES_NOT_MATCH");
    assert.equal((await recordEvidence({ pool, owner: o, unitId: u.id, level: "STATUS_READ", result: "PASS", method: "manual-mapping", function: "setpoint", detail: "DP 2 = 24 και η οθόνη έδειχνε 24", functions: { mapping: { dp: "2", value: 24, observed: 24 } }, by: "N", now: now0 })).ok, true);
    const u2 = (await deviceRegistry({ pool, owner: o, now: now0 })).units.find((x) => x.id === u.id)!;
    assert.equal(u2.allowed.read.setpoint, true);
    assert.equal(u2.allowed.read.power, false);
  } finally { await db.close(); }
});

test("v199 P2: evidence expires and a firmware / hardware change forces revalidation — the history stays", async () => {
  const at = now0;
  assert.equal(unitState(statusRead(at), { now: at + 10 * DAY }).level, "STATUS_READ");
  const old = unitState(statusRead(at), { now: at + (EVIDENCE_TTL_DAYS.DISCOVERED + 1) * DAY });
  assert.equal(old.level, "NONE", "an old success does not allow today's use");
  assert.equal(old.levels.DISCOVERED.state, "EXPIRED");
  assert.equal(old.levels.DISCOVERED.lastVerifiedAt, at);
  const changed = unitState(statusRead(at), { now: at + DAY, revalidateAfter: at + 1000 });
  assert.equal(changed.level, "NONE");
  assert.equal(changed.levels.STATUS_READ.state, "REVALIDATION_REQUIRED");
  const { db, pool } = await fresh();
  try {
    await importProbeReport({ pool, owner: o, report: report(), by: "M", now: now0 });
    let reg = await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 });
    const id = reg.units.find((x) => x.refs!.ip === "192.168.10.21")!.id;
    await assignUnit({ pool, owner: o, unitId: id, model: { acBrand: "Inventor", acModel: "Comfort", wifiModule: "EU-ODZ104", app: "Inventor Control", firmware: "1.0" }, now: now0 });
    // New firmware = another model → revalidation required automatically.
    const r = await assignUnit({ pool, owner: o, unitId: id, model: { acBrand: "Inventor", acModel: "Comfort", wifiModule: "EU-ODZ104", app: "Inventor Control", firmware: "1.1" }, now: now0 + 1000 });
    assert.equal(r.revalidationRequired, true);
    reg = await deviceRegistry({ pool, owner: o, now: now0 + 2000 });
    const u = reg.units.find((x) => x.id === id)!;
    assert.equal(u.level, "NONE");
    assert.ok(u.evidence.length >= 3, "the evidence stays in the history");
    assert.equal((await markHardwareChange({ pool, owner: o, unitId: id, reason: "x", now: now0 })).error, "DETAIL_REQUIRED");
    assert.equal((await markHardwareChange({ pool, owner: o, unitId: id, reason: "αντικατάσταση Wi-Fi module", now: now0 + 3000 })).ok, true);
  } finally { await db.close(); }
});

const KEY = "k".repeat(32);
// A fake device behind a certified-adapter interface: the only way automatic evidence is produced.
function fakeDevice(deviceId: string, state: Record<string, unknown>, opts: { obey?: boolean; echoId?: boolean } = {}) {
  let t = now0 + 10_000;
  return {
    state,
    impl: {
      read: async () => ({ deviceId, values: { ...state }, at: (t += 10) }),
      send: async (_refs: unknown, fn: string, value: unknown, commandId: string) => { if (opts.obey !== false) state[fn] = value; return { ok: true, commandId: opts.echoId === false ? "other" : commandId, at: (t += 10) }; },
    },
  };
}

test("v200 P2: automatic evidence only from a certified adapter — same physical unit, command id, new read, signed; Temperature Guard order", async () => {
  const { db, pool } = await fresh();
  try {
    await importProbeReport({ pool, owner: o, report: report(), by: "M", now: now0 });
    const id = (await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 })).units.find((x) => x.refs!.ip === "192.168.10.21")!.id;
    await recordEvidence({ pool, owner: o, unitId: id, level: "STATUS_READ", result: "PASS", method: "manual-mapping", function: "setpoint", detail: "DP 2 = 24 και η οθόνη έδειχνε 24", functions: { mapping: { dp: "2", value: 24, observed: 24 } }, by: "N", now: now0 });
    let n = now0 + 20_000;
    const clock = () => (n += 1000);
    const run = (adapter: string, value = 22) => runAdapterCommandTest({ pool, owner: o, unitId: id, adapter, function: "setpoint", value, signingKey: KEY, now: clock });
    assert.equal((await run("not-registered")).error, "NO_CERTIFIED_ADAPTER", "no adapter, no automatic evidence");
    assert.equal((await runAdapterCommandTest({ pool, owner: o, unitId: id, adapter: "x", function: "setpoint", value: 22, signingKey: null, now: clock })).error, "SIGNING_KEY_REQUIRED");
    registerAdapter("fake-other-unit", fakeDevice("bfOTHER", { setpoint: 24 }).impl);
    assert.equal((await run("fake-other-unit")).error, "DEVICE_IDENTITY_MISMATCH", "a read from another physical unit is refused");
    registerAdapter("fake-wrong-id", fakeDevice("bf1234567890abcdef", { setpoint: 24 }, { echoId: false }).impl);
    assert.equal((await run("fake-wrong-id")).error, "COMMAND_ID_MISMATCH");
    registerAdapter("fake-ignores", fakeDevice("bf1234567890abcdef", { setpoint: 24 }, { obey: false }).impl);
    const ignored = await run("fake-ignores");
    assert.deepEqual([ignored.error, ignored.recorded], ["READBACK_DOES_NOT_MATCH", true], "a failed read-back is recorded as a signed FAIL");
    const dev = fakeDevice("bf1234567890abcdef", { setpoint: 24 });
    registerAdapter("fake-good", dev.impl);
    { const g = await run("fake-good"); assert.equal(g.ok, true, JSON.stringify(g)); }
    let u = (await deviceRegistry({ pool, owner: o, now: n + 1000, signingKey: KEY })).units.find((x) => x.id === id)!;
    assert.equal(u.allowed.commands.setpoint, "AUTOMATIC_READBACK_VERIFIED");
    assert.equal(u.allowed.automation.setpoint, false, "the remote-change step is still missing");
    assert.deepEqual(u.allowed.guard.setpoint.map((g) => [g.step, g.ok]), [["read", true], ["remote_change_detected", false], ["test_command_readback", true]]);
    // Step 2: a person changes the remote; the PMS detects it through the adapter (no change → refused).
    assert.equal((await observeRemoteChange({ pool, owner: o, unitId: id, adapter: "fake-good", function: "setpoint", signingKey: KEY, waitForChange: async () => {}, now: clock })).error, "NO_CHANGE_OBSERVED");
    assert.equal((await observeRemoteChange({ pool, owner: o, unitId: id, adapter: "fake-good", function: "setpoint", signingKey: KEY, waitForChange: async () => { dev.state.setpoint = 25; }, now: clock })).ok, true);
    u = (await deviceRegistry({ pool, owner: o, now: n + 1000, signingKey: KEY })).units.find((x) => x.id === id)!;
    assert.equal(u.allowed.automation.setpoint, true);
    assert.equal(u.allowed.automation.power, false);
    // Revoking the function stops automatic control at once (recorded, not deleted).
    const before = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM device_compat_evidence`)).rows[0].n;
    assert.equal((await revokeFunction({ pool, owner: o, unitId: id, function: "setpoint", detail: "η μονάδα αγνόησε δεύτερη εντολή", by: "N", now: n + 500 })).ok, true);
    const revoked = (await deviceRegistry({ pool, owner: o, now: n + 1000, signingKey: KEY })).units.find((x) => x.id === id)!;
    assert.deepEqual([revoked.allowed.commands.setpoint, revoked.allowed.automation.setpoint], [null, false]);
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int n FROM device_compat_evidence`)).rows[0].n, before + 1);
    await db.query(`DELETE FROM device_compat_evidence WHERE result='REVOKED'`);
    // Without the server key (or with a tampered record) the automatic records do not count.
    assert.equal((await deviceRegistry({ pool, owner: o, now: n + 1000, signingKey: null })).units.find((x) => x.id === id)!.allowed.automation.setpoint, false);
    await db.query(`UPDATE device_compat_evidence SET functions_json=replace(functions_json,'"value":22','"value":21') WHERE verification='AUTOMATIC_READBACK_VERIFIED' AND result='PASS' AND level='COMMAND_CONFIRMED'`);
    u = (await deviceRegistry({ pool, owner: o, now: n + 1000, signingKey: KEY })).units.find((x) => x.id === id)!;
    assert.equal(u.functions.setpoint.command.state, "SIGNATURE_INVALID");
    assert.equal(u.allowed.automation.setpoint, false);
    // A person cannot record a remote change or an automatic verification through the manual path.
    assert.equal((await recordEvidence({ pool, owner: o, unitId: id, level: "STATUS_READ", result: "PASS", method: "manual", function: "setpoint", detail: "άλλαξα το τηλεχειριστήριο σε 26", functions: { remoteChange: { before: { value: 24, at: 1 }, after: { value: 26, at: 2 } } }, by: "N", now: n })).error, "REMOTE_CHANGE_NEEDS_ADAPTER");
    const route = readFileSync("app/api/pms/device-registry/route.ts", "utf8");
    assert.doesNotMatch(route, /runAdapterCommandTest|observeRemoteChange|registerAdapter|verification|signature/);
  } finally { await db.close(); }
});

test("v200 P2: a record dated after the PMS clock is CLOCK_SKEW, never VERIFIED; an accepted skew is time-uncertain and never automates", async () => {
  const future = now0 + 3 * 60_000;
  const s = unitState(statusRead(future), { now: now0 });
  assert.equal(s.level, "NONE", "the reported case: three records 3′ in the future → not STATUS_READ");
  assert.equal(s.levels.DISCOVERED.state, "CLOCK_SKEW");
  assert.equal(s.levels.DISCOVERED.skewMs, 3 * 60_000);
  const skewed = statusRead(now0).map((e) => ({ ...e, clockSkewMs: 60_000 }));
  const s2 = unitState(skewed, { now: now0 + 1000 });
  assert.equal(s2.level, "STATUS_READ");
  assert.equal(s2.timeUncertain, true);
  assert.equal(s2.levels.DISCOVERED.timeUncertain, true);
  const { db, pool } = await fresh();
  try {
    const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+0000");
    const tooFar = await importProbeReport({ pool, owner: o, report: report(at(now0 + CLOCK_SKEW_MS + 60_000)), by: "M", now: now0 });
    assert.equal(tooFar.error, "REPORT_IN_THE_FUTURE");
    const near = await importProbeReport({ pool, owner: o, report: report(at(now0 + 60_000)), by: "M", now: now0 });
    assert.deepEqual([near.ok, near.clockSkewMs], [true, 60_000], "the skew is recorded");
    let u = (await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 })).units.find((x) => x.refs!.ip === "192.168.10.21")!;
    assert.equal(u.level, "NONE", "still ahead of the PMS clock");
    u = (await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 + 5 * 60_000 })).units.find((x) => x.refs!.ip === "192.168.10.21")!;
    assert.deepEqual([u.level, u.timeUncertain], ["STATUS_READ", true]);
    assert.ok(Object.values(u.allowed.automation).every((v) => v === false));
  } finally { await db.close(); }
});

test("v200 P2: room temperature needs a calibration — unit, scale, documented method and a tolerance of at most 1.5 °C", () => {
  const st = unitState(statusRead(now0), { now: now0 });
  const v = (fn: string, mapping: Row) => validateEvidence({ level: "STATUS_READ", function: fn, result: "PASS", method: "manual-mapping", verification: "MANUALLY_ATTESTED", detail: "σύγκριση με θερμόμετρο αναφοράς", functions: { mapping } }, st);
  assert.equal(v("room_temperature", { value: 27, observed: 26.4 }), "CALIBRATION_METHOD_REQUIRED", "the v199 gap: no rule at all");
  assert.equal(v("room_temperature", { value: 27, observed: 26.4, method: "reference_thermometer" }), "TOLERANCE_REQUIRED");
  assert.equal(v("room_temperature", { value: 27, observed: 26.4, method: "reference_thermometer", tolerance: 3 }), "TOLERANCE_TOO_WIDE");
  assert.equal(v("room_temperature", { value: 27, observed: 26.4, method: "reference_thermometer", tolerance: 1 }), null, "a plausible sensor deviation");
  assert.equal(v("room_temperature", { value: 27, observed: 24, method: "reference_thermometer", tolerance: 1 }), "TEMPERATURE_OUTSIDE_TOLERANCE", "a wrong datapoint");
  assert.equal(v("room_temperature", { value: 270, observed: 27, method: "reference_thermometer", tolerance: 1 }), "TEMPERATURE_OUT_OF_RANGE", "a missing ×0.1 scale is caught");
  assert.equal(v("room_temperature", { value: 270, scale: 0.1, observed: 27, method: "reference_thermometer", tolerance: 1 }), null);
  assert.equal(v("room_temperature", { value: 80, unit: "F", observed: 26.8, method: "wall_thermostat", tolerance: 1 }), null, "°F converted (80 °F = 26.7 °C)");
  assert.equal(v("setpoint", { value: 240, scale: 0.1, observed: 24 }), null, "setpoint with a documented scale");
  assert.equal(v("setpoint", { value: 240, observed: 24 }), "TEMPERATURE_OUT_OF_RANGE");
  assert.equal(v("mode", { value: "cold", observed: "heat" }), "MAPPING_DOES_NOT_MATCH");
});

test("v200 P2: two imports of the same report at the same time store every record once (fingerprint + transaction)", async () => {
  const { db, pool } = await fresh();
  try {
    const results = await Promise.all([1, 2, 3].map(() => importProbeReport({ pool, owner: o, report: report(), by: "M", now: now0 })));
    assert.ok(results.every((r) => r.ok));
    const total = results.reduce((s2, r) => s2 + (r.evidence ?? 0), 0);
    const rows = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM device_compat_evidence`)).rows[0].n;
    assert.equal(rows, total, "only what was actually inserted");
    assert.equal(rows, results[0].evidence! || results.find((r) => r.evidence)!.evidence, "one import's worth");
    const dup = await db.query<{ n: number }>(`SELECT count(*)::int n FROM (SELECT unit_id,level,function,method,at FROM device_compat_evidence GROUP BY 1,2,3,4,5 HAVING count(*)>1) x`);
    assert.equal(dup.rows[0].n, 0);
    // The database itself refuses a second copy, even without the code's checks.
    const fp = (await db.query<{ fingerprint: string; unit_id: number }>(`SELECT fingerprint,unit_id FROM device_compat_evidence LIMIT 1`)).rows[0];
    await assert.rejects(db.query(`INSERT INTO device_compat_evidence(owner_id,unit_id,level,result,method,recorded_by,at,fingerprint) VALUES($1,$2,'DISCOVERED','PASS','x','x',1,$3)`, [o, fp.unit_id, fp.fingerprint]), /duplicate key|unique/i);
  } finally { await db.close(); }
});

test("v199 registry: import (idempotent, shareable copy refused), protected identifiers, models split by firmware, Hotel Corali test plan", async () => {
  const { db, pool } = await fresh();
  try {
    const r1 = await importProbeReport({ pool, owner: o, report: report(), by: "Maria", now: now0 });
    assert.deepEqual([r1.ok, r1.units], [true, 4]);
    assert.equal((await importProbeReport({ pool, owner: o, report: report(), by: "Maria", now: now0 })).evidence, 0, "re-import adds nothing");
    const share = { ...report(), devices: report().devices.map((d, i) => ({ label: `dev-${i + 1}`, level: d.level, access: d.access })) };
    assert.equal((await importProbeReport({ pool, owner: o, report: share, by: "Maria", now: now0 })).error, "SHAREABLE_REPORT_HAS_NO_IDENTIFIERS");
    const reg = await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 });
    const by = (ip: string) => reg.units.find((u) => u.refs!.ip === ip)!;
    assert.equal(by("192.168.10.31").level, "DISCOVERED", "discovery is not a local session");
    assert.equal(by("192.168.10.33").level, "DISCOVERED", "a timeout lowers nothing and proves nothing");
    const ro = await deviceRegistry({ pool, owner: o, includeRefs: false, now: now0 });
    assert.ok(!JSON.stringify(ro).includes("192.168.10."), "no IP in the read-only view");
    await assignUnit({ pool, owner: o, unitId: by("192.168.10.31").id, model: { acBrand: "AUX", acModel: "ASW-H12", wifiModule: "CTTG-40X24-WIFI-AKS2", app: "AC Freedom", firmware: "1.0.1" }, now: now0 });
    await assignUnit({ pool, owner: o, unitId: by("192.168.10.34").id, model: { acBrand: "AUX", acModel: "ASW-H12", wifiModule: "CTTG-40X24-WIFI-AKS2", app: "AC Freedom", firmware: "1.2.0" }, now: now0 });
    assert.equal((await seedHotelModules({ pool, owner: o, now: now0 })).models, 4);
    assert.equal((await seedHotelModules({ pool, owner: o, now: now0 })).models, 4, "idempotent");
    const all = await deviceRegistry({ pool, owner: o, now: now0 });
    assert.equal(all.models.filter((m) => m.wifiModule === "CTTG-40X24-WIFI-AKS2").length, 3, "two firmwares + the plan row are separate models");
    const plan = Object.fromEntries(all.models.filter((m) => m.plan).map((m) => [m.wifiModule, [m.targetLevel, m.installed]]));
    assert.deepEqual(plan, { "CTTG-40X24-WIFI-AKS2": ["STATUS_READ", true], "EU-ODZ104": ["STATUS_READ", true], "CTT-WIFI-BL3353-P": ["DISCOVERED", false], MDWBRCU1: ["DISCOVERED", false] });
  } finally { await db.close(); }
});
