import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { EVIDENCE_TTL_DAYS, allowedOperations, assignUnit, deviceRegistry, importProbeReport, markHardwareChange, probeEvidence, recordAutomaticCommandTest, recordEvidence, revokeFunction, seedHotelModules, unitState, validateEvidence } from "../scripts/device-compat-core.mjs";

const o = "hotel-corali", DAY = 86_400_000;
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  return { db, pool: { query } };
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

test("v199 P2: MANUALLY_ATTESTED vs AUTOMATIC_READBACK_VERIFIED — only the PMS's own complete record authorises automatic control", async () => {
  const { db, pool } = await fresh();
  try {
    await importProbeReport({ pool, owner: o, report: report(), by: "M", now: now0 });
    const id = (await deviceRegistry({ pool, owner: o, includeRefs: true, now: now0 })).units.find((x) => x.refs!.ip === "192.168.10.21")!.id;
    await recordEvidence({ pool, owner: o, unitId: id, level: "STATUS_READ", result: "PASS", method: "manual-mapping", function: "setpoint", detail: "DP 2 = 24 και η οθόνη έδειχνε 24", functions: { mapping: { dp: "2", value: 24, observed: 24 } }, by: "N", now: now0 });
    // A person's command test: recorded, but MANUALLY_ATTESTED (the API cannot claim automatic).
    const m = await recordEvidence({ pool, owner: o, unitId: id, level: "COMMAND_CONFIRMED", result: "PASS", method: "manual-test", function: "setpoint", detail: "εντολή 22 από την εφαρμογή, η οθόνη έδειξε 22", functions: { command: { value: 22 }, before: { value: 24 }, after: { value: 22 } }, by: "N", now: now0 + 1000 });
    assert.equal(m.ok, true);
    let u = (await deviceRegistry({ pool, owner: o, now: now0 + 2000 })).units.find((x) => x.id === id)!;
    assert.equal(u.allowed.commands.setpoint, "MANUALLY_ATTESTED");
    assert.equal(u.allowed.automation.setpoint, false, "no Temperature Guard on a manual attestation");
    // The automatic path needs the full record in order: read before → request → device answer → new read.
    const t = now0 + 3000;
    const auto = (over: Row = {}) => recordAutomaticCommandTest({ pool, owner: o, unitId: id, function: "setpoint", value: 23, before: { value: 22, at: t }, request: { at: t + 10, payload: "dps 2=23" }, response: { at: t + 200, ok: true }, after: { value: 23, at: t + 3000 }, method: "tuya-local", now: t + 4000, ...over });
    assert.equal((await auto({ response: { at: t + 200, ok: false } })).error, "DEVICE_DID_NOT_ACCEPT");
    assert.equal((await auto({ after: { value: 23, at: t + 5 } })).error, "AUTOMATIC_RECORD_OUT_OF_ORDER");
    assert.equal((await auto({ after: { value: 22, at: t + 3000 } })).error, "READBACK_DOES_NOT_MATCH");
    assert.equal((await auto({ request: undefined })).error, "AUTOMATIC_RECORD_INCOMPLETE");
    assert.equal((await auto()).ok, true);
    u = (await deviceRegistry({ pool, owner: o, now: t + 5000 })).units.find((x) => x.id === id)!;
    assert.deepEqual([u.allowed.commands.setpoint, u.allowed.automation.setpoint, u.allowed.automation.power], ["AUTOMATIC_READBACK_VERIFIED", true, false]);
    // Revoke: the function stops at once (recorded, not deleted).
    assert.equal((await revokeFunction({ pool, owner: o, unitId: id, function: "setpoint", detail: "η μονάδα αγνόησε δεύτερη εντολή", by: "N", now: t + 6000 })).ok, true);
    u = (await deviceRegistry({ pool, owner: o, now: t + 7000 })).units.find((x) => x.id === id)!;
    assert.deepEqual([u.allowed.commands.setpoint, u.allowed.automation.setpoint], [null, false]);
    // The API route cannot reach the automatic path or set a verification.
    const route = readFileSync("app/api/pms/device-registry/route.ts", "utf8");
    assert.doesNotMatch(route, /recordAutomaticCommandTest|verification/);
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
